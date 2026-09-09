const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), os = require('node:os');
const base = path.resolve(__dirname, '..');
const engine = process.env.PP_ENGINE_ROOT || base;
const desktop = process.env.PP_DESKTOP_ROOT || path.resolve(base, '../../desktop/minimacore-desktop');
const { makeSqlShim } = require(path.join(desktop, 'main/pandapools/sqlshim'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'receipt-consolidation-header.json')));
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const pool = hash(5000), token = hash(999);
const expectedPosted = '0x8C6B7401E1343318C7EC80563408C9978C40B7CA59EF76CE443EB0D2B68D27EB';
const files = ['decimal.js','covenant.js','curve.js','store.js','history.js','statement.js','sha3.js','receipt-recovery.js','activity-chain.js'];
let count = 0;
async function test(name, fn) { await fn(); console.log('PASS', name); count++; }
async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-parity-test-'));
  const sql = await makeSqlShim(path.join(dir, 'history.sqlite'));
  const trace=[], rawSql=sql.sql;sql.sql=(q,cb)=>{const entry={q};trace.push(entry);const result=rawSql(q,cb);entry.ok=result.status;return result;};
  let now = Date.now(), responder = () => ({ status: true, response: { found: true, confirmations: 853, block: 2304392, tip: 2305245 } });
  const commands = [];
  const context = { console, setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? 30000 : Math.min(ms, 1)), clearTimeout,
    Date: class extends Date { static now() { return now; } }, MDS: { sql: sql.sql, cmd: (q, cb) => { commands.push(q); cb(responder(q)); } } };
  context.self = context; vm.createContext(context);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(engine, f), 'utf8'), context, { filename: f }));
  await new Promise(r => context.Store.init(r)); await new Promise(r => context.ActivityChain.init(r));
  return { c: context, sql, commands, file: path.join(dir, 'history.sqlite'), set: f => { responder = f; }, advance: () => { now += 10001; },
    snap: () => new Promise(r => context.ActivityChain.snapshot(r)), verify: () => new Promise(r => context.ActivityChain.verify(r)),
    observe: tx => new Promise(r => context.ActivityChain.observe(tx,r)), close: () => { context.ActivityChain.stop(); sql.flush(); if(process.env.PP_SQL_TRACE)fs.writeFileSync(process.env.PP_SQL_TRACE,trace.filter(e=>e.ok).map(e=>e.q).join(';\n')+';\n'); } };
}
function tx(id, inputs, outputs, diff = {}) { return { txpowid: id, header: { block: '500', timemilli: '1788900329000' }, body: { txn: { transactionid: hash(8000 + Number.parseInt(id.slice(-4),16)), inputs, outputs } }, detail: { difference: diff } }; }
function coin(address, amount, tid = '0x00') { return { address, amount, tokenamount: amount, tokenid: tid }; }
(async () => {
 const h = await harness(), c = h.c;
 await test('actual Android receipt fixture recovers identical posted ID', () => { assert.equal(c.ReceiptRecovery.submittedId(fixture).toLowerCase(), expectedPosted.toLowerCase()); });
 await test('altered header, wrong hash and malformed parents cannot recover', () => {
   for (const mutate of [t => t.header.block = '2304537', t => t.txpowid = hash(99), t => t.header.superparents[0].count = 33]) {
     const f = JSON.parse(JSON.stringify(fixture)); mutate(f); assert.equal(c.ReceiptRecovery.submittedId(f), '');
   }
 });
 await test('MiniNumber signed bytes and fractional scale agree with Java codec', () => {
   assert.deepEqual(Array.from(c.ReceiptRecovery.number('128')), [0,2,0,128]);
   assert.deepEqual(Array.from(c.ReceiptRecovery.number('-128')), [0,1,128]);
   assert.deepEqual(Array.from(c.ReceiptRecovery.number('1.20')), [2,1,120]);
 });
 await test('elapsed blocks, old confirmed status and elapsed time never confirm', () => {
   assert.equal(c.Store.confirmed({ confirmedOnchain:true,submitBlock:1,ts:1 }, 99999), false);
   assert.equal(c.Store.confirmed({ verifiedDepth:853,verifiedAt:123 }), true);
   assert.equal(c.Store.confirmed({ verifiedDepth:853,verifiedAt:123,failed:true }), false);
 });
 await test('failed receipts beyond 120 are preserved', async () => {
   for (let i=0;i<140;i++) c.Store.actRecordFailed('SWAP','failure '+i,'test');
   const rows=await new Promise(r=>c.Store.actList(-1,r)); assert.equal(rows.length,140);
 });
 await test('old receipt matches only reconstructed identity and requires independent proof', async () => {
   h.sql.sql(`INSERT INTO pp_activity(type,summary,txpowid,submitblock,status,failmsg,ts) VALUES ('CONSOLIDATE','legacy','${expectedPosted}',1,'ok','',${fixture.header.timemilli})`);
   const t=JSON.parse(JSON.stringify(fixture));t.body={txn:{transactionid:hash(1000),inputs:[],outputs:[]}};
   assert.equal(await h.observe(t),true);
   let s=await h.snap(), row=s.receipts.find(r=>r.originalTxpowid===expectedPosted);
   assert.equal(row.txpowid,t.txpowid.toLowerCase());assert.equal(row.verifiedAt,0);assert.equal(row.confirmed,false);
   await h.verify();s=await h.snap();row=s.receipts.find(r=>r.originalTxpowid===expectedPosted);
   assert.equal(row.verifiedDepth,853);assert.equal(row.confirmed,true);assert.equal(row.transactionTime,Number(fixture.header.timemilli));
 });
 await test('new receipts retain immutable transaction identity across mining', async () => {
   const t=tx(hash(100),[],[]), submission=JSON.parse(JSON.stringify(t));submission.txpowid=hash(101);
   await new Promise(r=>c.ActivityChain.rememberSubmission({response:submission},submission.txpowid,r));
   c.Store.actRecord('CREATE','new pool',submission.txpowid,1,pool);await h.observe(t);
   const row=(await h.snap()).receipts.find(r=>r.originalTxpowid===submission.txpowid);
   assert.equal(row.txpowid,t.txpowid);assert.equal(row.confirmed,false);
 });
 await test('withdrawal derives from spent reserves and identical header time on both devices', () => {
   const t=tx(hash(200),[coin(pool,'175157.93892489164'),coin(pool,'784.52331493',token)],[]);
   assert.equal(c.ActivityChain.touches(t,pool),true);assert.equal(c.ActivityChain.touches(t,hash(201)),false);
   const a=c.History.entryFrom(t,null), b=c.History.entryFrom(t,null), known={ [pool]:true };
   a.syncedAt=1;b.syncedAt=99999999;
   const ev=c.ActivityChain.poolEvents(a,known)[0], ev2=c.ActivityChain.poolEvents(b,known)[0];
   assert.equal(ev.kind,'WITHDRAW');assert.equal(ev.tokenAmt,'784.52331493');assert.equal(ev.ts,ev2.ts);assert.equal(a.deltas,'{}');
 });
 await test('all confirmations rotate beyond the former 150-record limit', async () => {
   for(let i=300;i<500;i++) { const t=tx(hash(i),[],[]);const row=c.History.entryFrom(t,t.detail);row.timemilli=i;await new Promise(r=>c.Store.histInsert(row,r)); }
   for(let i=0;i<19;i++){h.advance();await h.verify();}
   assert(h.commands.includes('txpow onchain:'+hash(300)));assert(h.commands.includes('txpow onchain:'+hash(499)));
 });
 await test('transport errors and malformed confirmation replies preserve last verified evidence', async () => {
   const before=(await h.snap()).receipts.find(r=>r.originalTxpowid===expectedPosted).verifiedDepth;
   for(const reply of [null,{status:false},{status:true,response:{found:true}},{status:true,response:{found:true,confirmations:'nonsense'}}]) {
     h.set(()=>reply);h.advance();await h.verify();assert(c.ActivityChain.status().includes('failed'));
     assert.equal((await h.snap()).receipts.find(r=>r.originalTxpowid===expectedPosted).verifiedDepth,before);
   }
 });
 await test('not-found evidence replaces a previous green confirmation', async () => {
   h.set(()=>({status:true,response:{found:false}}));h.advance();await h.verify();
   assert.equal((await h.snap()).receipts.find(r=>r.originalTxpowid===expectedPosted).confirmed,false);
 });
 await test('public address lookup stores third-party transactions outside wallet accounting', async () => {
   await new Promise(r=>c.Store.knownAddrsAdd([pool],r));const before=await new Promise(r=>c.Store.histAll(r));
   const publicTx=tx(hash(777),[coin(pool,'10'),coin(pool,'5',token)],[]), unrelated=tx(hash(778),[coin(hash(888),'42')],[]);
   h.set(q=>q.startsWith('txpow address:')?{status:true,response:[publicTx,unrelated]}:{status:true,response:{found:true,confirmations:12}});
   c.ActivityChain.syncPublic(true);await new Promise(r=>setTimeout(r,300));
   const after=await new Promise(r=>c.Store.histAll(r));assert.equal(after.length,before.length);
   const s=await h.snap();assert(s.events.some(e=>e.txpowid===publicTx.txpowid));assert(!s.events.some(e=>e.txpowid===unrelated.txpowid));
 });
 await test('timeline retains old failures and joins exact IDs without using amount/time guesses', () => {
   const row={txpowid:hash(99),timemilli:100,inputs:JSON.stringify([coin(pool,'1')]),outputs:'[]',deltas:'{"0x00":"1"}'};
   const receipts=[{txpowid:hash(88),ts:100,failed:true},{txpowid:hash(99),ts:999}];
   const rows=c.ActivityChain.timeline(receipts,[row],{[pool]:true});assert.equal(rows.length,2);assert.equal(rows[1].time,100);assert(rows.some(r=>r.receipt.failed));
 });
 await test('reloaded SQL store preserves original IDs and proof metadata', async () => { h.sql.flush();const reopened=await makeSqlShim(h.file);assert(reopened.sql('SELECT COUNT(*) AS C FROM pp_txids').rows[0].C>=2);assert(reopened.sql('SELECT COUNT(*) AS C FROM pp_txproof').rows[0].C>=200);assert.equal(reopened.sql("SELECT txpowid FROM pp_activity WHERE txpowid='"+expectedPosted+"'").rows[0].TXPOWID,expectedPosted);reopened.flush(); });
 await test('a skipped history reply is incomplete and cannot mark backfill or repair finished', async () => {
   h.set(q=>q.startsWith('history ') && !q.includes('offset:0') ? {status:true,response:{txpows:[],details:[]}} : {status:false});
   const result=await new Promise(r=>c.History.sync((n,ok)=>r(ok)));
   assert.equal(result,false);
   assert.notEqual(await new Promise(r=>c.Store.kvGet('hist_backfilled',r)),'true');
   assert.notEqual(await new Promise(r=>c.Store.kvGet('activity_repair_v1',r)),'true');
 });
 await test('failed public lookup stays visible and never deletes cached transactions', async () => {
   const before=(await h.snap()).events.length; h.set(()=>({status:false}));c.ActivityChain.syncPublic(true);
   await new Promise(r=>setTimeout(r,60));assert(c.ActivityChain.status().includes('Public pool lookup failed'));assert.equal((await h.snap()).events.length,before);
 });
 await test('MDS Activity renders real counts, transaction times and original receipt IDs', async () => {
   const elements={};c.document={hidden:false,getElementById:id=>elements[id]||(elements[id]={innerHTML:'',classList:{toggle(){}}}),querySelectorAll:()=>[]};
   c.MDS.init=()=>{};c.History.isRunning=()=>true;
   const scripts=Array.from(fs.readFileSync(path.join(base,'index.html'),'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)).map(m=>m[1]).join('\n');
   vm.runInContext(scripts,c,{filename:'index-inline.js'});
   c.App.setScope(false);await new Promise(r=>setTimeout(r,30));
   assert(elements.actList.innerHTML.includes('Show more'));
   c.App.showMoreActivity();c.App.showMoreActivity();await new Promise(r=>setTimeout(r,30));
   assert(elements.actList.innerHTML.includes('Original submission'));assert(elements.actList.innerHTML.includes('Transaction 2026-09-08'));
   assert(!elements.actList.innerHTML.includes('Confirmed on-chain</div>'));
 });
 await test('storage read failures retain the last visible snapshot and report the error', async () => {
   const before=await h.snap(), originalSql=c.MDS.sql;
   c.MDS.sql=(q,cb)=>{ if(q.startsWith('SELECT * FROM pp_activity')) cb({status:false});else originalSql(q,cb); };
   const after=await h.snap();assert.equal(after.rows.length,before.rows.length);assert(after.error.includes('storage read failed'));c.MDS.sql=originalSql;
 });
 h.close();console.log(`${count} tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
