// 0.6.54: the claims sweep. A claim is RELEASED only after two consecutive "unspent + not in mempool" reads at least one
// block apart (the miner drops a coin from its mining list a moment before the txn reaches the mempool; a restart empties
// the local mempool), DROPPED once its coin has been absent for 30 sweeps or over 24 h (it was re-queried every block
// forever), and never runs twice at once.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), os = require('node:os');
const root = process.env.PP_ENGINE_ROOT || path.resolve(__dirname, '..');
const desktop = process.env.PP_DESKTOP_ROOT || path.resolve(root, '../../desktop/minimacore-desktop');
const { makeSqlShim } = require(path.join(desktop, 'main/pandapools/sqlshim.js'));
const id = n => '0x' + String(n).repeat(64);
const invoke = (fn, ...args) => new Promise(r => fn(...args, r));
async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sweep-')), sql = await makeSqlShim(path.join(dir, 'c.sqlite')), logs = [];
  const c = { MDS: { sql: sql.sql, log: m => logs.push(m) } }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'input-claims.js'), 'utf8'), c);
  return { claims: c.PoolInputClaims, logs, close: () => { sql._db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
// a node whose answers the test sets: tip (block height) and, per coin, 'unspent' | 'absent'
function chain() {
  const n = { tip: 100, coin: {}, reads: 0 };
  n.cmd = (q, cb) => {
    if (q === 'block') return cb({ status: true, response: { block: String(n.tip) } });
    n.reads++;
    const cid = q.split('coinid:')[1];
    cb({ status: true, response: n.coin[cid] === 'unspent' ? [{ coinid: cid, spent: false }] : [] });   // the node never answers a spent coin
  };
  return n;
}
const MIN = 60000, T = 1e12;   // sweep times are absolute ms (0 would read as 'now')

test('release needs two consecutive unspent reads at least one block apart (and the 10-minute floor)', async () => {
  const h = await harness(), n = chain(), A = id(1);
  try {
    assert.equal(await invoke(h.claims.post, [A], 'pp_a'), true);
    n.coin[A] = 'unspent';
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 0), 0, 'first read at block 100');
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 11 * MIN), 0, 'a second read in the SAME block is not a second block');
    n.coin[A] = 'absent'; n.tip = 101;
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 12 * MIN), 0, 'absent (in the mempool) breaks the streak');
    n.coin[A] = 'unspent'; n.tip = 102;
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 13 * MIN), 0, 'one unspent read after the break is not enough');
    n.tip = 103;
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 14 * MIN), 1, 'two consecutive unspent reads, one block apart → released');
    assert.equal(await invoke(h.claims.load, [A]), true);
    assert(h.logs.some(l => l.includes('pp_a') && l.includes(A) && /not posted/.test(l)), JSON.stringify(h.logs));
  } finally { h.close(); }
});
test('the 10-minute floor still holds even with two reads a block apart', async () => {
  const h = await harness(), n = chain(), A = id(2);
  try {
    await invoke(h.claims.post, [A], 'pp_b'); n.coin[A] = 'unspent';
    await invoke(h.claims.sweepUnposted, n.cmd, T + 0); n.tip++;
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 2 * MIN), 0);
    n.tip++;
    assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 10 * MIN + 1), 1);
  } finally { h.close(); }
});
test('a claim whose coin stays absent is dropped after 30 sweeps, or after 24 h; never released as "not posted"', async () => {
  const h = await harness(), n = chain(), A = id(3), B2 = id(4);
  try {
    await invoke(h.claims.post, [A], 'pp_spent');
    for (let i = 0; i < 29; i++) { n.tip++; await invoke(h.claims.sweepUnposted, n.cmd, T + i * MIN); }
    assert.equal(await invoke(h.claims.load, [A]), false, 'held for 29 absent sweeps');
    n.tip++; assert.equal(await invoke(h.claims.sweepUnposted, n.cmd, T + 30 * MIN), 0, 'a drop is not a release');
    assert.deepEqual(Array.from(await invoke(h.claims.heldIds, [A])), [], 'the 30th absent sweep drops the row');
    await invoke(h.claims.post, [B2], 'pp_old');
    await invoke(h.claims.sweepUnposted, n.cmd, T + 40 * MIN);
    await invoke(h.claims.sweepUnposted, n.cmd, T + 40 * MIN + 24 * 60 * MIN + 1);
    assert.deepEqual(Array.from(await invoke(h.claims.heldIds, [B2])), [], 'absent for over 24 h → dropped');
    assert(h.logs.every(l => !/not posted/.test(l)), 'a vanished coin is never reported as not posted');
  } finally { h.close(); }
});
test('one sweep at a time: a pass started while another is running does nothing', async () => {
  const h = await harness(), A = id(5);
  try {
    await invoke(h.claims.post, [A], 'pp_c');
    const held = [], reads = [];
    const slow = (q, cb) => { reads.push(q); held.push(cb); };
    h.claims.sweepUnposted(slow, T, () => {});
    let second = null; h.claims.sweepUnposted(slow, T + 1, n => { second = n; });
    assert.equal(second, 0, 'the overlapping pass returns at once');
    assert.deepEqual(reads, ['block'], 'and issued no read of its own');
    while (held.length) held.shift()({ status: true, response: { block: '1' } });
  } finally { h.close(); }
});
