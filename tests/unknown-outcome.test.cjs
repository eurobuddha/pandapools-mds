// 0.6.53: a post the node did not answer ("posted, outcome unknown") is recorded in Activity as UNKNOWN with the input
// coin ids it claimed (in full) — never as Failed with no id — and the chain settles it: POSTED (the transaction that
// spent all its inputs, so confirmations follow) or NOT POSTED (the sweep freed its inputs). Until then the same kind of
// action stays off in the page (settleUnknown reports which kinds are still unknown).
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
  let spent = false;
  const n = standin((p, v) => {
    if (p === 'checkmode') return { status: true, response: { writemode: true, dblocked: false } };
    if (p.startsWith('keys action:genkey')) return { status: true, response: { publickey: BLOCK } };
    if (p === 'keys') return { status: true, response: [{ publickey: PK, uses: 10 }] };
    const fund = { coinid: FUND, address: WALLET, amount: '5', tokenid: '0x00', spent: false, state: [], created: '100' };
    if (p.startsWith('coins relevant:true sendable:true tokenid:0x00')) return { status: true, response: spent ? [] : [fund] };
    const asked = (p.match(/^coins (?:checkmempool:true )?coinid:(0x[0-9a-fA-F]{64})$/) || [])[1];
    if (asked && asked.toUpperCase() === FUND.toUpperCase()) return { status: true, response: spent ? [] : [fund] };   // only coins still unspent in the tree
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-unknown-')), sql = await makeSqlShim(path.join(dir, 'pool.sqlite')), logs = [];
  const c = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  c.MDS = { cmd: n.cmd, sql: sql.sql, log: m => logs.push(m), init() {}, notify() {}, persistRecovery: cb => cb(sql.flushChecked()) };
  c.self = c; vm.createContext(c);
  vm.runInContext(files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'), c, { filename: 'engine.js' });
  return { c, logs, close: () => { sql.flush(); sql._db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const PAGE = ['runtime-guard.js', 'decimal.js', 'covenant.js', 'curve.js', 'router.js', 'book.js', 'store.js', 'history.js', 'activity-chain.js', 'input-claims.js', 'poolmgr.js', 'reserve-recovery.js'];
function bundle() {
  const line = fs.readFileSync(path.join(root, 'build.sh'), 'utf8').split('\n').find(l => /^cat .*service\.js\s*>/.test(l));
  return line.replace(/^cat\s+/, '').split('>')[0].trim().split(/\s+/);
}
const unknownPost = c => new Promise(r => c.PoolMgr.reannounce(POOL, { ok: id => r({ ok: id }), fail: (m, info) => r({ fail: m, info }) }));
const row = async c => (await invoke(c.Store.actList, -1))[0];

test('an unanswered post is recorded UNKNOWN with its claimed inputs in full; a transaction spending them settles it POSTED', async () => {
  const n = node(TIMEOUT), h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init); await invoke(h.c.ActivityChain.init);
    const r = await unknownPost(h.c);
    assert.match(String(r.fail), /^posted, outcome unknown/);
    assert(r.info && r.info.unknown === true, 'the engine hands the page the claimed inputs: ' + JSON.stringify(r.info));
    assert.deepEqual(Array.from(r.info.inputs, x => x.toLowerCase()), [FUND.toLowerCase()]);
    await invoke(h.c.Store.actRecordFail, 'SWAP', 'swap 5 MINIMA', r.fail, r.info);
    let e = await row(h.c);
    assert.equal(e.outcome, 'unknown'); assert.equal(e.failed, false, 'never "Failed"');
    assert.deepEqual(Array.from(e.inputs), [FUND.toLowerCase()], 'the full claimed coin id');
    assert.equal(h.c.ActivityChain.statusText(e), 'Outcome unknown · waiting for the chain');
    assert.deepEqual({ ...await invoke(h.c.ActivityChain.settleUnknown) }, { SWAP: true }, 'unsettled: the swap action stays off');
    // the chain: the wallet history now holds the transaction that spent the claimed input
    const TX = hex(9001);
    const entry = h.c.History.entryFrom({ txpowid: TX, header: { block: '120', timemilli: String(Date.now()) },
      body: { txn: { inputs: [{ coinid: FUND, address: WALLET, amount: '5', tokenid: '0x00' }], outputs: [{ coinid: hex(9002), address: POOL.address, amount: '0.000000001', tokenid: '0x00' }] } } }, null);
    assert.equal(JSON.parse(entry.inputs)[0].coinid, FUND, 'history keeps each input coin id');
    await invoke(h.c.Store.histInsert, entry);
    assert.deepEqual({ ...await invoke(h.c.ActivityChain.settleUnknown) }, {}, 'settled: the action is back on');
    e = await row(h.c);
    assert.equal(e.outcome, ''); assert.equal(e.failed, false); assert.equal(e.txpowid, TX.toLowerCase(), 'posted, with the transaction that went through');
  } finally { h.close(); }
});
test('an unknown post whose inputs the sweep frees settles NOT POSTED; a refusal stays a plain failure', async () => {
  const n = node(TIMEOUT), h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init); await invoke(h.c.ActivityChain.init);
    const r = await unknownPost(h.c);
    await invoke(h.c.Store.actRecordFail, 'CLOSE', 'withdraw', r.fail, r.info);
    const cmd = (q, cb) => h.c.MDS.cmd(q, cb), t = Date.now();
    for (const dt of [0, 11 * 60000, 22 * 60000]) await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t + dt);
    assert.equal(await invoke(h.c.PoolInputClaims.load, [FUND]), true, 'never broadcast → the sweep freed it');
    assert.deepEqual({ ...await invoke(h.c.ActivityChain.settleUnknown) }, {});
    const e = await row(h.c);
    assert.equal(e.outcome, 'notposted'); assert.equal(e.failed, true); assert.equal(h.c.ActivityChain.statusText(e), 'Not posted · inputs free again');
    await invoke(h.c.Store.actRecordFail, 'DEPOSIT', 'add', 'post rejected : Invalid TxPoW', undefined);
    assert.equal((await row(h.c)).failed, true); assert.equal((await row(h.c)).outcome, '');
    assert.deepEqual({ ...await invoke(h.c.ActivityChain.settleUnknown) }, {}, 'a refusal holds nothing back');
  } finally { h.close(); }
});
test('every operation kind is held back while its own unknown post is unsettled', async () => {
  const n = node(TIMEOUT), h = await context(n, PAGE);
  try {
    await invoke(h.c.Store.init); await invoke(h.c.ActivityChain.init);
    const r = await unknownPost(h.c);
    for (const kind of ['SWAP', 'CREATE', 'DEPOSIT', 'MIGRATE', 'CLOSE']) await invoke(h.c.Store.actRecordFail, kind, kind, r.fail, r.info);
    assert.deepEqual(Object.keys(await invoke(h.c.ActivityChain.settleUnknown)).sort(), ['CLOSE', 'CREATE', 'DEPOSIT', 'MIGRATE', 'SWAP']);
  } finally { h.close(); }
});
test('service bundle: the outcome-unknown log names every claimed input in full; the sweep logs NOT POSTED when it frees them', async () => {
  const n = node(TIMEOUT), h = await context(n, bundle());
  try {
    await new Promise(r => h.c.ensureTables(r));
    const end = Date.now() + 20000;
    await new Promise(r => { h.c.reannounceSvc(POOL, 'k'); const wait = () => n.ran.some(p => p.startsWith('txnpost')) || Date.now() > end ? r() : setTimeout(wait, 5); wait(); });
    await new Promise(r => setTimeout(r, 200));
    assert(h.logs.some(l => /posted, outcome unknown/.test(l) && l.includes(FUND)), JSON.stringify(h.logs));
    const cmd = (q, cb) => h.c.MDS.cmd(q, cb), t = Date.now();
    for (const dt of [0, 11 * 60000, 22 * 60000]) await invoke(h.c.PoolInputClaims.sweepUnposted, cmd, t + dt);
    assert(h.logs.some(l => /not posted/.test(l) && l.includes(FUND.toLowerCase())), JSON.stringify(h.logs));
  } finally { h.close(); }
});
