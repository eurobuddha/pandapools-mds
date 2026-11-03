const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path');
const root=process.env.PP_ENGINE_ROOT||path.resolve(__dirname,'..');
const B=require(path.join(root,'combined-backup')),F=require(path.join(root,'full-backup'));
const id=n=>'0x'+String(n).repeat(64),password='🔐 café horse battery staple',recipes={pandapools_backup:3,pools:[{opk:id(2),opkuses:5}]};
const keys={status:true,response:{keys:[{modifier:'0x00',publickey:id(1),size:128,depth:4,uses:0},{modifier:'0x01',publickey:id(2),size:128,depth:4,uses:5}]}};
test('encrypted bundle rejects wrong password, changed bytes and hostile KDF before exposing state',async()=>{
 const node=Uint8Array.from({length:64},(_,i)=>i),data=await B.create(password,recipes,id(1),'block','ab'.repeat(32),node);
 const opened=await B.open(password,data);assert.deepEqual(opened.node,node);assert.equal(opened.manifest.nodePassword,'ab'.repeat(32));
 await assert.rejects(()=>B.open('wrong password',data),/AUTHENTICATION/);
 for(const mutate of [b=>{b[b.length-1]^=1;return b;},b=>b.slice(0,-1),b=>{b[6]=127;return b;}])await assert.rejects(()=>B.open(password,mutate(data.slice())));
 assert.throws(()=>B.validate({...opened.manifest,nodeBytes:'64'}));
 assert.equal(B.validPassword('🔐'.repeat(11)),false);assert.equal(B.validPassword('🔐'.repeat(12)),true);
});
test('native capture fails closed and removes temporary node backup',async()=>{
 let deleted=0,made=0;
 const api={backup:async()=>JSON.stringify(recipes),cmd:async q=>q==='status'?{status:true,response:{locked:false}}:keys,makeNode:async()=>{made++;},readNode:async()=>new Uint8Array(0),deleteNode:async()=>{deleted++;}};
 await assert.rejects(()=>F.capture(api,password),/NODE_BACKUP_SIZE/);assert.equal(made,1);assert.equal(deleted,1);
 api.readNode=async()=>new Uint8Array(64);const bundle=await F.capture(api,password);assert(bundle.encrypted.length>64);assert.equal(deleted,2);
 api.cmd=async()=>({status:true,response:{locked:true}});await assert.rejects(()=>F.capture(api,password),/WALLET_LOCKED/);assert.equal(made,2);
});
test('missing keys, regressed counters and null counters are rejected',()=>{
 for(const uses of [null,'',true,4,-1,'broken']){const broken=JSON.parse(JSON.stringify(keys));broken.response.keys[1].uses=uses;assert.throws(()=>F.identity(broken,recipes));}
 assert.equal(F.identity(keys,recipes).wallet,id(1));
});
async function sqlHarness(){
 const desktop=path.resolve(__dirname,'../../../desktop/minimacore-desktop');
 const {makeSqlShim}=require(path.join(desktop,'main/pandapools/sqlshim'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pool-input-claims-'));const file=path.join(dir,'claims.sqlite');
 let sql=await makeSqlShim(file),failPersist=false,failSql=false;
 const load=()=>{const c={MDS:{sql:(q,cb)=>failSql?cb({status:false}):sql.sql(q,cb),persistRecovery:cb=>{if(!failPersist)sql.flush();cb(!failPersist);}}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'input-claims.js'),'utf8'),c);return c.PoolInputClaims;};
 return {load,fail:()=>{failPersist=true;},badSql:()=>{failSql=true;},restart:async()=>{sql.flush();sql=await makeSqlShim(file);return load();},close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('posted inputs stay held across a new context and durable database reload',async()=>{
 const h=await sqlHarness();try{let c=h.load();const call=(fn,...args)=>new Promise(r=>fn(...args,r));
 assert.equal(await call(c.load,[id(3),id(4)]),true);assert.equal(await call(c.post,[id(3),id(4)],'swap_1'),true);
 c=await h.restart();assert.equal(await call(c.load,[id(3)]),false);assert.equal(await call(c.load,[id(5)]),true);
 h.fail();assert.equal(await call(c.post,[id(5)],'swap_2'),false);assert.equal(await call(c.load,[id(5)]),false);
 h.badSql();assert.equal(await call(c.load,[id(6)]),false);
 }finally{h.close();}
});
test('release frees only the named handle and survives a restart',async()=>{
 const h=await sqlHarness();try{let c=h.load();const call=(fn,...args)=>new Promise(r=>fn(...args,r));
 assert.equal(await call(c.post,[id(1)],'kept'),true);assert.equal(await call(c.post,[id(2)],'refused'),true);
 assert.equal(await call(c.release,[id(1),id(2)],'refused'),true);
 assert.equal(await call(c.load,[id(2)]),true,'refused post is free');assert.equal(await call(c.load,[id(1)]),false,'other handle stays held');
 c=await h.restart();assert.equal(await call(c.load,[id(2)]),true);assert.equal(await call(c.load,[id(1)]),false);
 }finally{h.close();}
});
test('pending reserve exclusion checks exact IDs and readable unspent replies',async()=>{
 const h=await sqlHarness();try{const c=h.load();let reply={status:true,response:[{coinid:id(8),spent:false}]};const check=()=>new Promise(r=>c.check([id(8)],(q,cb)=>{assert.equal(q,'coins checkmempool:true coinid:'+id(8));cb(reply);},r));
 assert.equal(await check(),true);for(const r of [{status:true,response:[]},{status:true,response:[{coinid:id(9),spent:false}]},{status:true,pending:true,response:[{coinid:id(8),spent:false}]}]){reply=r;assert.equal(await check(),false);}
 }finally{h.close();}
});
