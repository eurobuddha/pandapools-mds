// 0.6.49: the MDS service bundle (the exact file list build.sh concatenates) runs a whole headless scan — discovery,
// reserves, re-announce check and the keep-fresh pass over an own pool — to its end. service.js named PoolMgr (and,
// in the stranding watch, PoolMgr + Store), which the bundle does not hold: every scan ended in a ReferenceError and
// the keep-fresh pass died before it could note, let alone refresh, an own pool.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { standin } = require('./node-standin.cjs');
const root = process.env.PP_ENGINE_ROOT || path.resolve(__dirname, '..');
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(64, '0');
const SENTINEL = '0x50414E4441504F4F4C53', BLOCK = '0x3FFDB1A06A2DCA90BEE0D7C0F5BA62B9AF23BF5D73A23D63555492F88D1E3828';
const OPK = hex(3), OADR = hex(2), TOK = hex(1), KMIN = '50', POOL = hex(77), TIP = 5000;
function bundleFiles() {
  const line = fs.readFileSync(path.join(root, 'build.sh'), 'utf8').split('\n').find(l => /^cat .*service\.js\s*>/.test(l));
  assert(line, 'build.sh bundles service.js');
  return line.replace(/^cat\s+/, '').split('>')[0].trim().split(/\s+/);
}
test('the packaged service bundle runs a headless scan to completion (no PoolMgr, no Store)', () => {
  const files = bundleFiles();
  assert(!files.includes('poolmgr.js') && !files.includes('store.js'), 'this test is about the bundle without them');
  const coin = (n, tokenid, amount, created) => ({ coinid: hex(n), address: POOL, tokenid, amount, tokenamount: amount, spent: false, state: {}, created: String(created) });
  const reserves = [coin(10, '0x00', '1000', TIP - 100), coin(11, TOK, '500', TIP - 100)];
  const n = standin((p, v) => {
    if (p === 'checkmode') return { status: true, response: { writemode: true, dblocked: false } };
    if (v === 'keys') return { status: true, response: p.startsWith('keys action:genkey') ? { publickey: BLOCK } : [] };
    if (p === 'scripts') return { status: true, response: [] };
    if (p === 'block') return { status: true, response: { block: String(TIP) } };
    if (p.startsWith('coins simplestate:true')) return { status: true, response: [{ coinid: hex(9), address: SENTINEL, amount: '0.000000001', tokenid: '0x00', created: String(TIP - 10),
      state: [{ port: 2, data: TOK }, { port: 3, data: OADR }, { port: 4, data: OPK }, { port: 5, data: KMIN }] }] };
    if (v === 'runscript') return { status: true, response: { parseok: true, script: { address: POOL } } };
    if (p === 'balance address:' + POOL) return { status: true, response: [{ coins: String(reserves.length) }] };
    if (p === 'coins address:' + POOL) return { status: true, response: reserves };
    return { status: true, response: [] };
  });
  const sqls = [];
  const own = { ADDRESS: POOL, OPK, OADR, TOK, KMIN, TDEC: 8, SIGNING_UNVERIFIED: 1, LASTCOINM: '', LASTCOINT: '' };   // held: watched, never refreshed
  const MDS = { cmd: n.cmd, log() {}, init() {}, notify() {}, sql(q, cb) { sqls.push(q); const r = /^SELECT \* FROM pp_ownpools/.test(q) ? { status: true, rows: [own] } : { status: true, rows: [] }; if (cb) cb(r); } };
  const c = { MDS, console };   // the MDS service runtime: MDS only (no setTimeout, no page modules)
  vm.createContext(c);
  vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), c, { filename: 'service-bundle.js' });
  assert.equal(typeof c.PoolMgr, 'undefined'); assert.equal(typeof c.Store, 'undefined');
  c.scan();
  assert.equal(c.SCANNING, false, 'the scan reached its end');
  assert(n.ran.includes('coins address:' + POOL), 'reserves were read');
  assert(sqls.some(q => q.startsWith("UPDATE pp_ownpools SET lastcoinm='" + hex(10) + "',lastcoint='" + hex(11) + "'")), 'the keep-fresh pass finished its own-pool read');
  assert.deepEqual(n.sends(), []);
});
