// A covenant script reaches the node as runscript/newscript script:"…". The node's parameter reader honours NO backslash
// escape (a quoted value ends at the FIRST `"`), so "escaping" a quote cannot work: such a script is refused, never sent.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { standin, params } = require('./node-standin.cjs');
const root = process.env.PP_ENGINE_ROOT || path.resolve(__dirname, '..');
const rnd = () => '0x' + Array.from({ length: 64 }, () => '0123456789ABCDEFabcdef'[Math.floor(Math.random() * 22)]).join('');
function context(n, files) {
  const logs = [];
  const c = { console, setTimeout, clearTimeout, setInterval, clearInterval, MDS: { cmd: n.cmd, log(m) { logs.push(m); }, sql(q, cb) { if (cb) cb({ status: false }); }, init() {}, keypair: { get(k, cb) { cb({ status: false }); }, set(k, v, cb) { if (cb) cb({}); } } } };
  c.self = c; vm.createContext(c);
  vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), c);
  c.__logs = logs;
  return c;
}
const node = () => standin(() => ({ status: true, response: { parseok: true, script: { address: rnd() } } }));
const PAGE = ['runtime-guard.js', 'decimal.js', 'covenant.js'], SERVICE = ['runtime-guard.js', 'decimal.js', 'covenant.js', 'curve.js', 'reserve-recovery.js', 'input-claims.js', 'service.js'];
const HOSTILE = ['RETURN TRUE\\" address:0x01', 'RETURN SIGNEDBY(0x01)" script:"RETURN TRUE', 'RETURN TRUE \\', 'RETURN "TRUE"', 'RETURN TRUE;send amount:1', 'RETURN\tTRUE'];

test('every covenant built from valid pool parameters passes the refusal check (page and service builders agree)', () => {
  const c = context(node(), PAGE), s = context(node(), SERVICE);
  for (let i = 0; i < 300; i++) {
    const x0 = String(1 + Math.floor(Math.random() * 1e6)) + '.' + String(Math.floor(Math.random() * 1e8));
    const y0 = String(Math.floor(Math.random() * 1e5)) + '.' + String(1 + Math.floor(Math.random() * 1e6));
    const kmin = c.Covenant.kmin(x0, y0), opk = rnd(), oadr = rnd(), tok = rnd();
    assert(c.PoolRuntimeGuard.poolParams(opk, oadr, tok, kmin), 'valid params ' + kmin);
    const sc = c.Covenant.script(opk, oadr, tok, kmin);
    assert.equal(s.covScript(opk, oadr, tok, kmin), sc);
    assert(!c.Covenant.UNSAFE_SCRIPT.test(sc), sc);
    assert.equal(c.Covenant.scriptArg(sc), '"' + sc + '"');
    assert.equal(s.scriptArg(sc), '"' + sc + '"');
    // and the real node reads it back whole, as the one script parameter
    assert.equal(params('runscript script:' + c.Covenant.scriptArg(sc)).p.script, sc);
  }
});
test('a script the node could not read back whole is never quoted (no backslash "escape": refused)', () => {
  const c = context(node(), PAGE), s = context(node(), SERVICE);
  for (const sc of HOSTILE) {
    for (const q of [c.Covenant.scriptArg(sc), s.scriptArg(sc)]) {
      // old behaviour escaped `"`/`\`: the node then ended the value at the escaped quote and read the rest as parameters
      if (q !== null) assert.equal(params('runscript script:' + q).p.script, sc, 'quoted but the node reads back something else: ' + JSON.stringify(q));
      assert.equal(q, null, JSON.stringify(sc));
    }
  }
});
test('runscript/newscript of a refused script: nothing reaches the node, a SECURITY line is logged, the caller sees a refusal', () => {
  for (const files of [PAGE, SERVICE]) {
    const n = node(), c = context(n, files), cmd = files === PAGE ? c.Covenant.scriptCmd : c.scriptCmd;
    for (const sc of HOSTILE) for (const head of ['runscript', 'newscript trackall:true', 'newscript trackall:false']) {
      let r; cmd(head, sc, v => { r = v; });
      assert.equal(r.status, false); assert.match(r.error, /UNSAFE_SCRIPT/);
    }
    assert.deepEqual(n.texts, []);
    assert(c.__logs.length >= HOSTILE.length * 3 && c.__logs.every(l => l.startsWith('SECURITY')));
    let ok; cmd('runscript', 'RETURN TRUE', v => { ok = v; });
    assert.equal(ok.status, true); assert.deepEqual(n.texts, ['runscript script:"RETURN TRUE"']);
  }
});
