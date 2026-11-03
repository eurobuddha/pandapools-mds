const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
const {makeSqlShim}=require(path.resolve(root,'../../desktop/minimacore-desktop/main/pandapools/sqlshim.js'));
const hash=n=>'0x'+n.toString(16).padStart(64,'0'),good=response=>({status:true,response});
const p={address:hash(1),opk:hash(2),oadr:hash(3),tok:hash(4),minimumOwnerUses:100,signingStateUnverified:true};
async function harness(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pp-rescue-')),sql=await makeSqlShim(path.join(dir,'db.sqlite'));let cmds=[],closes=0,forwards=0,mined=false,empty=false,loseClose=false,loseForward=false,persist=true;
 const c={setTimeout,clearTimeout,MDS:{sql:(q,cb)=>sql.sql(q,cb),persistRecovery:cb=>cb(persist&&sql.flushChecked()),cmd(q,cb){cmds.push(q);
  if(q.startsWith('txnlist'))return cb(good({id:q.split(' ')[1].slice(3),transaction:{transactionid:q.includes('close')?hash(10):hash(11)}}));
  if(q.startsWith('history'))return cb(good({txpows:mined?[{istransaction:true,txpowid:hash(20),body:{txn:{transactionid:hash(10)}}},{istransaction:true,txpowid:hash(21),body:{txn:{transactionid:hash(11)}}}]:[]}));
  if(q.startsWith('txpow'))return cb(good({found:mined,blockid:hash(30),block:'100',tip:'103',confirmations:'3'}));
  if(q.startsWith('balance'))return cb(good([{coins:empty?0:2}]));cb({status:false});}},
  PoolRuntimeGuard:{check:cb=>cb(null)},Store:{ownAll:cb=>cb([{...p}],true)},
  ReserveRecovery:{integer:(n,m)=>Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=m,validRecipe:()=>true,readReserves:(_p,cb)=>cb(true)},
  PoolMgr:{readKeyUses:(_p,cb)=>cb(101,33,268435456),close(_p,done){closes++;assert.equal(_p.signingStateUnverified,true);assert.equal(done.noRetry,true);done.beforePost('ppclose_test',()=>{if(loseClose)done.fail('lost reply');else done.ok(hash(20));},done.fail);},
   forwardOwnerFunds(_a,done){done.beforeBuild(()=>{forwards++;assert.equal(done.recoveryExpected,2);done.beforePost('ppfwd_test',()=>{if(loseForward)done.fail('lost reply');else done.forwarded(hash(21),2);},done.fail);},done.fail);}}
 };vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'rescue-flow.js'),'utf8'),c);
 return {c,sql,cmds,run:attested=>new Promise(resolve=>c.PoolRescue.run(JSON.stringify({pools:[{addr:p.address}]}),attested,null,resolve)),get closes(){return closes},get forwards(){return forwards},mine:()=>mined=true,empty:()=>empty=true,loseClose:()=>loseClose=true,loseForward:()=>loseForward=true,persist:v=>persist=v,close(){sql._db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('rescue requires attestation and persists one close before confirmation and collection',async()=>{
 const h=await harness();try{assert.match(await h.run(false),/Confirm/);assert.equal(h.closes,0);assert.match(await h.run(true),/Withdrawal submitted/);assert.equal(h.closes,1);
 assert.match(await h.run(true),/Waiting/);assert.equal(h.forwards,0);h.mine();assert.match(await h.run(true),/Collection submitted/);assert.equal(h.forwards,1);
 assert.match(await h.run(true),/payout coins remain/);h.empty();assert.match(await h.run(true),/Recovery complete/);assert.equal(h.closes,1);assert.equal(h.forwards,1);
 }finally{h.close();}
});
test('uncertain close or collection never repeats a signature and can reconcile exact mined identity',async()=>{
 const h=await harness();try{h.loseClose();assert.match(await h.run(true),/No automatic signature retry/);assert.match(await h.run(true),/Waiting/);assert.equal(h.closes,1);
 h.mine();h.loseForward();assert.match(await h.run(true),/No automatic signature retry/);await h.run(true);assert.equal(h.forwards,1);h.empty();assert.match(await h.run(true),/Recovery complete/);
 }finally{h.close();}
});
test('failed durable claim never reaches a signature and retained journal prevents retry',async()=>{
 const h=await harness();try{h.persist(false);assert.match(await h.run(true),/Nothing signed/);assert.equal(h.closes,0);h.persist(true);assert.match(await h.run(true),/interrupted/);assert.equal(h.closes,0);}finally{h.close();}
});
test('false, pending, malformed and inconsistent inclusion never establishes confirmation',async()=>{
 const h=await harness();try{const r=good({found:true,blockid:hash(30),block:'100',tip:'103',confirmations:'3'});assert(h.c.PoolRescue.confirmed(r));for(const bad of [{...r,status:false},{...r,pending:true},good({...r.response,tip:'104'}),good({...r.response,confirmations:'2'}),good({...r.response,block:100})])assert.equal(h.c.PoolRescue.confirmed(bad),false);}finally{h.close();}
});

test('resuming a journal skips reserve restoration and does not recommend resync for withdrawn reserves',async()=>{
 const h=await harness();try{const json=JSON.stringify({pandapools_backup:3,pools:[{addr:p.address}]});
 const prepare=()=>new Promise(resolve=>h.c.PoolRescue.prepare(json,(needed,error)=>resolve({needed,error})));
 assert((await prepare()).needed);await h.run(true);assert.deepEqual(await prepare(),{needed:null,error:null});
 }finally{h.close();}
});
