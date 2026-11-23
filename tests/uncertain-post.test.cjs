// 0.6.50: a txnpost the node did not answer (the host timed out or lost the connection after sending; host shims say
// {status:false, pending:true, error:"the node did not answer txnpost…"}) may have been broadcast. Its inputs stay
// claimed, the user is told "posted, outcome unknown: check Activity before retrying" (not "post rejected"), and the
// claim is settled on later blocks from chain reads. A refusal (status:false, not pending) still frees the inputs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), os = require('node:os');
const { standin } = require('./node-standin.cjs');
const root = process.env.PP_ENGINE_ROOT || path.resolve(__dirname, '..');
const desktop = process.env.PP_DESKTOP_ROOT || path.resolve(root, '../../desktop/minimacore-desktop');
const { makeSqlShim } = require(path.join(desktop, 'main/pandapools/sqlshim.js'));
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(64, '0');
const BLOCK = '0x3FFDB1A06A2DCA90BEE0D7C0F5BA62B9AF23BF5D73A23D63555492F88D1E3828';
const FUND = hex(500), WALLET = hex(501), PK = hex(502), POOL = { address: hex(77), opk: hex(3), oadr: hex(2), tok: hex(1), kmin: '50' };
const TIMEOUT = { status: false, pending: true, error: 'the node did not answer txnpost (timed out after sending)' };
const invoke = (fn, ...args) => new Promise(r => fn(...args, r));

function node(postReply) {
  let spent = false;   // the funding coin, as the chain sees it
  const n = standin((p, v) => {
    if (p === 'checkmode') return { status: true, response: { writemode: true, dblocked: false } };
    if (p.startsWith('keys action:genkey')) return { status: true, response: { publickey: BLOCK } };
    if (p === 'keys') return { status: true, response: [{ publickey: PK, uses: 10 }] };
    const fund = { coinid: FUND, address: WALLET, amount: '5', tokenid: '0x00', spent: false, state: [], created: '100' };
    if (p.startsWith('coins relevant:true sendable:true tokenid:0x00')) return { status: true, response: spent ? [] : [fund] };
    const asked = (p.match(/^coins (?:checkmempool:true )?coinid:(0x[0-9a-fA-F]{64})$/) || [])[1];   // hex ids: any case, as the node
    if (asked && asked.toUpperCase() === FUND.toUpperCase()) return { status: true, response: spent ? [] : [fund] };   // coins never returns a spent coin
    if (p === 'scripts address:' + WALLET) return { status: true, response: { address: WALLET, simple: true, publickey: PK } };
    if (v === 'txncheck') return { status: true, response: { valid: { scripts: true, mmrproofs: true }, validamounts: true } };
    if (v === 'txnpost') return postReply;
    if (v.startsWith('txn')) return { status: true, response: {} };
    return { status: true, response: [] };
  });
  n.spend = () => { spent = true; };
  return n;
}
async function context(n, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-uncertain-post-')), sql = await makeSqlShim(path.join(dir, 'pool.sqlite')), logs = [];
  const c = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  c.MDS = { cmd: n.cmd, sql: sql.sql, log: m => logs.push(m), init() {}, notify() {}, persistRecovery: cb => cb(sql.flushChecked()) };
  c.self = c; vm.createContext(c);
  vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), c, { filename: 'engine.js' });
  return { c, logs, close: () => { sql.flush(); sql._db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const PAGE = ['runtime-guard.js', 'decimal.js', 'covenant.js', 'curve.js', 'router.js', 'book.js', 'store.js', 'activity-chain.js', 'input-claims.js', 'poolmgr.js', 'reserve-recovery.js'];
function bundle() {
  const line = fs.readFileSync(path.join(root, 'build.sh'), 'utf8').split('\n').find(l => /^cat .*service\.js\s*>/.test(l));
  return line.replace(/^cat\s+/, '').split('>')[0].trim().split(/\s+/);
}
function pageAnnounce(c) {
  return new Promise(r => c.PoolMgr.reannounce(POOL, { ok: id => r({ ok: id }), fail: m => r({ fail: m }) }));
}

test('page: an unanswered txnpost keeps its inputs claimed and says outcome unknown; chain reads settle it later', async () => {
  const n = node(TIMEOUT), h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init);
    const r = await pageAnnounce(h.c);
    assert.equal(n.ran.filter(p => p.startsWith('txnpost')).length, 1, 'the post went to the node once');
    assert.match(String(r.fail), /^posted, outcome unknown: check Activity before retrying/, 'not "post rejected": ' + r.fail);
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), false, 'the funding input stays claimed');
    const again = await pageAnnounce(h.c);
    assert.equal(n.ran.filter(p => p.startsWith('txnpost')).length, 1, 'a retry cannot spend the claimed input again: ' + again.fail);
    // later blocks: the coin is still unspent and out of the mempool → it was never broadcast → the claim is released
    const t = Date.now(), cmd = (q, cb) => h.c.MDS.cmd(q, cb);
    assert.equal(await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t), 0);
    assert.equal(await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t + 11 * 60000), 1);
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), true, 'never broadcast → usable again');
  } finally { h.close(); }
});
test('page: a post that DID go out (the input is spent on chain) stays claimed; a refusal frees its inputs at once', async () => {
  let n = node(TIMEOUT), h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init); await pageAnnounce(h.c); n.spend();
    const t = Date.now(), cmd = (q, cb) => h.c.MDS.cmd(q, cb);
    await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t); await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t + 11 * 60000);
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), false, 'spent: stays held');
  } finally { h.close(); }
  n = node({ status: false, pending: false, error: 'Invalid TxPoW' }); h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init);
    const r = await pageAnnounce(h.c);
    assert.match(String(r.fail), /^post rejected : Invalid TxPoW/);
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), true, 'refused: nothing was broadcast, the input is free');
  } finally { h.close(); }
});
test('service bundle: an unanswered txnpost keeps its inputs claimed and logs outcome unknown', async () => {
  const n = node(TIMEOUT), h = await context(n, bundle());
  try {
    await new Promise(r => h.c.ensureTables(r));
    const end = Date.now() + 20000;
    await new Promise(r => { h.c.reannounceSvc(POOL, 'k'); const wait = () => n.ran.some(p => p.startsWith('txnpost')) || Date.now() > end ? r() : setTimeout(wait, 5); wait(); });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(n.ran.filter(p => p.startsWith('txnpost')).length, 1);
    assert(h.logs.some(l => /posted, outcome unknown: check Activity before retrying/.test(l)), JSON.stringify(h.logs));
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), false, 'the funding input stays claimed');
  } finally { h.close(); }
});
test('a claim the service settles is free in the page too (separate contexts, one database)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-claims-2ctx-')), sql = await makeSqlShim(path.join(dir, 'c.sqlite'));
  try {
    const load = () => { const c = { MDS: { sql: sql.sql } }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(root, 'input-claims.js'), 'utf8'), c); return c.PoolInputClaims; };
    const page = load(), service = load(), id = FUND.toLowerCase();
    assert.equal(await invoke(page.post, [id], 'ppann_1'), true);
    assert.equal(await invoke(page.load, [id]), false, 'held in the page');
    const unspent = (q, cb) => cb({ status: true, response: [{ coinid: FUND, spent: false }] }), t = Date.now();
    await invoke(service.sweepUnposted, unspent, t);
    assert.equal(await invoke(service.sweepUnposted, unspent, t + 11 * 60000), 1, 'the service sweep released it');
    assert.equal(await invoke(page.load, [id]), true, 'the page reads the table, not a stale memory hold');
  } finally { sql._db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
