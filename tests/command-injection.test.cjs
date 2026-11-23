// A stranger's dust coin at the public PANDAPOOLS sentinel carries a ";" in a state port: through the REAL scans
// (book.js and the headless service) nothing reaches the node, the beacon is skipped, an honest beacon still derives.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { standin } = require('./node-standin.cjs');
const root = process.env.PP_ENGINE_ROOT || path.resolve(__dirname, '..');
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(64, '0');
const SENTINEL = '0x50414E4441504F4F4C53', ATTACKER = hex(666), BLOCK = '0x3FFDB1A06A2DCA90BEE0D7C0F5BA62B9AF23BF5D73A23D63555492F88D1E3828';
const SEND = 'send amount:1000 address:' + ATTACKER + ' tokenid:0x00';
const beacon = (p2, p3, p4, p5) => ({ coinid: hex(9), address: SENTINEL, amount: '0.000000001', tokenid: '0x00', created: '100', state: [{ port: 2, data: p2 }, { port: 3, data: p3 }, { port: 4, data: p4 }, { port: 5, data: p5 }] });
const HONEST = beacon(hex(3), hex(2), hex(1), '50');
const POISON = [beacon('0x00;' + SEND + ';', hex(2), hex(1), '50'), beacon(hex(3), hex(2), '[x;' + SEND + ';]', '50'),
  beacon(hex(3), hex(2) + ';' + SEND, hex(1), '50'), beacon(hex(3), hex(2), hex(1), '50;' + SEND), beacon(hex(3), hex(2), hex(1) + '\n' + SEND, '50'),
  beacon(hex(3), hex(2) + ' amount:1000', hex(1), '50')];
function node() {
  return standin((p, v) => {
    if (p === 'checkmode') return { status: true, response: { writemode: true, dblocked: false } };
    if (v === 'keys') return { status: true, response: { publickey: BLOCK } };
    if (p === 'scripts') return { status: true, response: [] };
    if (p.startsWith('coins simplestate:true')) return { status: true, response: POISON.concat([HONEST]) };
    if (v === 'runscript') return { status: true, response: { parseok: true, script: { address: hex(77) } } };
    return { status: true, response: [] };
  });
}
function context(n, files, extra) {
  const c = { ...(extra || {}), console, setTimeout, clearTimeout, setInterval, clearInterval, MDS: { cmd: n.cmd, log() {}, sql(q, cb) { if (cb) cb({ status: false }); }, init() {}, keypair: { get(k, cb) { cb({ status: false }); }, set(k, v, cb) { if (cb) cb({}); } } } };
  c.self = c; vm.createContext(c);
  vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), c);
  return c;
}
function check(n) {
  assert.deepEqual(n.sends(), [], 'an injected send ran');
  const scripts = n.ran.filter(p => p.startsWith('runscript'));
  assert.equal(scripts.length, 1, 'only the honest beacon is derived: ' + JSON.stringify(scripts));
  assert(!n.texts.some(t => /[;\r\n]/.test(t) || t.includes(ATTACKER) || t.includes('amount:1000')), 'no stranger text reached the node');
}
test('book.js scan: poisoned sentinel beacons are skipped, nothing is sent, the honest pool still derives', () => {
  const n = node(), c = context(n, ['runtime-guard.js', 'decimal.js', 'covenant.js', 'curve.js', 'router.js', 'book.js', 'store.js', 'poolmgr.js', 'reserve-recovery.js']);
  c.PoolRuntimeGuard.install(); let done = false;
  c.Book.scan(() => { done = true; });
  check(n); assert(n.texts.some(t => t.startsWith('runscript') && t.includes(hex(3))));
});
test('headless service scan (the packaged bundle): poisoned beacons skipped, nothing sent', () => {
  const n = node(), c = context(n, ['runtime-guard.js', 'decimal.js', 'covenant.js', 'curve.js', 'reserve-recovery.js', 'input-claims.js', 'service.js']);   // the MDS bundle: no poolmgr.js, no store.js
  c.scan(); check(n);
});
test('the choke point: any command holding ";" or a control character (tab included) is refused, logged and never sent', () => {
  const n = node(), c = context(n, ['runtime-guard.js']); const logs = [], blocked = [];
  c.MDS.log = m => logs.push(m); c.PoolRuntimeGuard.install(); c.PoolRuntimeGuard.onBlocked(e => blocked.push(e));
  // 0.6.47: a TAB starts a new parameter in the node's splitter (a state value "<hex>\taddress:<stranger>" adds one)
  const bad = ['runscript script:"RETURN TRUE;' + SEND + '"', 'coins address:0x01\n' + SEND, 'balance\r', 'scripts\u0000x', 'txnpost id:a;txndelete id:a',
    'txnstate id:a port:3 value:' + hex(2) + '\taddress:' + ATTACKER, 'coins address:0x01\u001f', 'scripts\u007f', 'checkmode\u000b'];
  for (const q of bad) {
    let r; c.MDS.cmd(q, v => { r = v; });
    assert.equal(r.status, false, JSON.stringify(q)); assert.match(r.error, /UNSAFE_COMMAND/);
  }
  assert.deepEqual(n.ran, []); assert.equal(logs.length, bad.length); assert(logs.every(l => l.startsWith('SECURITY'))); assert.equal(blocked.length, bad.length);
  assert.equal(c.PoolRuntimeGuard.unsafe('coins address:' + hex(1) + ' tokenid:0x00'), false);
  let ok; c.MDS.cmd('scripts', v => { ok = v; }); assert.equal(ok.status, true);
});
test('pool parameters: strict 32-byte hex and a plain positive decimal', () => {
  const c = context(node(), ['runtime-guard.js']), P = c.PoolRuntimeGuard.poolParams;
  assert(P(hex(1), hex(2), hex(3), '50')); assert(P(hex(1).toLowerCase(), hex(2), hex(3), '0.125'));
  for (const bad of [[hex(1) + ';', hex(2), hex(3), '50'], ['0x01', hex(2), hex(3), '50'], [hex(1), hex(2), '0x00', '50'], [hex(1), hex(2), hex(3), '0'],
    [hex(1), hex(2), hex(3), '5e3'], [hex(1), hex(2), hex(3), '1'.repeat(81)], [hex(1), 'Mx' + 'A'.repeat(60), hex(3), '50'], [{}, hex(2), hex(3), '50'], [hex(1), hex(2), hex(3), '-1'],
    // 0.6.48: the all-zero (MINIMA) token at full length, and KMIN at or above 2^64-1 (validRecipe's bound)
    [hex(1), hex(2), hex(0), '50'], [hex(1), hex(2), hex(3), '18446744073709551615'], [hex(1), hex(2), hex(3), '18446744073709551615.5'],
    [hex(1), hex(2), hex(3), '99999999999999999999'], [hex(1), hex(2), hex(3), '1' + '0'.repeat(40)]])
    assert.equal(P(...bad), false, JSON.stringify(bad));
  for (const ok of ['18446744073709551614.999', '0018446744073709551614', '0.000000001', hex(1).slice(2).replace(/^0+/, '')])
    assert(P(hex(1), hex(2), hex(3), ok), ok);
});
