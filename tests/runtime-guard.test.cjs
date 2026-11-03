const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const BLOCK='0x3FFDB1A06A2DCA90BEE0D7C0F5BA62B9AF23BF5D73A23D63555492F88D1E3828';
const CLASSIC='0x8B0CF5A33D71DBB1E986219C57E6B97ED9489F699DE7ED8189BEF7F168A5DA76';
function harness(){
 let mode={status:true,response:{writemode:true,dblocked:false}},probe={status:true,response:{publickey:BLOCK}},writes=[],calls=[],events;
 const c={MDS:{cmd(q,cb){calls.push(q);if(q==='checkmode')return cb(mode);if(q.startsWith('keys action:genkey'))return cb(probe);writes.push(q);if(cb)cb({status:true,response:{}});},init(cb){events=cb;},log(){},sql(q,cb){cb({status:false});}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'runtime-guard.js'),'utf8'),c);c.PoolRuntimeGuard.install();
 return {c,writes,calls,mode(v){mode=v;},probe(v){probe=v;},event(v){events(v);}};
}
test('READ, pending, failed, locked, missing and unknown node modes never write',()=>{
 for(const mode of [null,{status:false,response:{writemode:true,dblocked:false}},{status:true,pending:true,response:{writemode:true,dblocked:false}},{status:true,response:{writemode:false,dblocked:false}},{status:true,response:{writemode:true,dblocked:true}},{status:true,response:{writemode:true}}]){
  const h=harness();h.mode(mode);let r;h.c.MDS.cmd('txnsign id:test publickey:auto',v=>r=v);assert.equal(r.status,false);assert.equal(h.writes.length,0);
 }
 for(const probe of [null,{status:true,pending:true,response:{publickey:BLOCK}},{status:true,response:{publickey:CLASSIC}},{status:true,response:{publickey:'0x00'}}]){
  const h=harness();h.probe(probe);let r;h.c.MDS.cmd('txnpost id:test',v=>r=v);assert.equal(r.status,false);assert.equal(h.writes.length,0);
 }
});
test('each write rechecks current permission and key mode, including changes after startup',()=>{
 const h=harness();let checked;h.c.PoolRuntimeGuard.check(e=>checked=e);assert.equal(checked,null);
 h.c.MDS.cmd('newaddress',()=>{});assert.deepEqual(h.writes,['newaddress']);
 h.mode({status:true,response:{writemode:false,dblocked:false}});h.c.MDS.cmd('txnpost id:test',()=>{});assert.deepEqual(h.writes,['newaddress']);
 h.mode({status:true,response:{writemode:true,dblocked:false}});h.probe({status:true,response:{publickey:CLASSIC}});h.c.MDS.cmd('coinimport data:0xaa',()=>{});assert.deepEqual(h.writes,['newaddress']);
});
test('headless startup in READ does not register, refresh, announce or sign',()=>{
 const h=harness();h.mode({status:true,response:{writemode:false,dblocked:false}});
 vm.runInContext(fs.readFileSync(path.join(root,'service.js'),'utf8'),h.c);h.event({event:'inited'});h.event({event:'NEWBLOCK'});assert.equal(h.c.READY,false);assert.deepEqual(h.writes,[]);
});
test('guard is installed in page and packaged headless service and the default page starts hidden',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),build=fs.readFileSync(path.join(root,'build.sh'),'utf8');
 assert.match(html,/id="poolShell" hidden inert/);assert.match(html,/PoolRuntimeGuard.install\(\)/);assert.match(build,/cat runtime-guard.js/);assert.match(html,/pp_host_notice_v1/);assert.match(harness().c.PoolRuntimeGuard.notice,/24\/7/);
});
