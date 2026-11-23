/* Durable posted-UTXO claims. Reuses the existing SQL primary-key reservation pattern.
 * Time never releases a submitted input. Confirmed transactions produce new IDs; uncertain posts stay held.
 */
var PoolInputClaims = (function(){
    var held={},owner={};   // owner: coin id -> the transaction handle whose post claimed it
    function valid(id){return typeof id==='string'&&/^0x[0-9a-fA-F]{64}$/.test(id);}
    function table(cb){MDS.sql('CREATE TABLE IF NOT EXISTS pp_posted_inputs (coinid varchar(160) primary key, handle varchar(160))',function(r){cb(!!r&&r.status===true);});}
    function blocked(ids){for(var i=0;i<ids.length;i++)if(held[ids[i].toLowerCase()])return true;return false;}
    function load(ids,cb){
        if(!ids.length||ids.some(function(id){return !valid(id);})){cb(false);return;}
        table(function(ok){if(!ok){cb(false);return;}
            var quoted=ids.map(function(id){return "'"+id.toLowerCase()+"'";}).join(',');
            MDS.sql('SELECT coinid,handle FROM pp_posted_inputs WHERE coinid IN ('+quoted+')',function(r){
                if(!r||r.status!==true||!Array.isArray(r.rows)){cb(false);return;}
                // The table is the truth for these ids: a claim another context released (the service's sweep after an
                // uncertain post, a refused post) must not stay held in this context's memory until a reload.
                for(var j=0;j<ids.length;j++){var k=ids[j].toLowerCase();delete held[k];delete owner[k];}
                for(var i=0;i<r.rows.length;i++){var id=r.rows[i].COINID||r.rows[i].coinid;if(!valid(id)){cb(false);return;}
                    id=id.toLowerCase();held[id]=true;owner[id]=String(r.rows[i].HANDLE||r.rows[i].handle||'');}
                cb(!blocked(ids));
            });
        });
    }
    // Same checkmempool query as the proven funding selector, for covenant reserves too.
    function check(ids,cmd,cb){
        load(ids,function(ok){if(!ok)return cb(false);var at=0;
            function next(){if(at>=ids.length)return cb(true);var id=ids[at++];
                cmd('coins checkmempool:true coinid:'+id,function(r){
                    var rows=r&&r.status===true&&!r.pending&&r.response,c=Array.isArray(rows)&&rows.length===1?rows[0]:null;
                    if(!c||String(c.coinid).toLowerCase()!==id.toLowerCase()||c.spent!==false)return cb(false);next();
                });
            }next();
        });
    }
    function post(ids,handle,cb){
        if(typeof handle!=='string'||!handle.match(/^[A-Za-z0-9_-]{1,150}$/)||blocked(ids)){cb(false);return;}
        // Keep memory holds even when storage fails. A failed partial reservation never broadcasts.
        for(var i=0;i<ids.length;i++){if(!valid(ids[i])){cb(false);return;}}
        ids.forEach(function(id){held[id.toLowerCase()]=true;owner[id.toLowerCase()]=handle;});
        var at=0;
        function step(){if(at===ids.length){if(MDS.persistRecovery)MDS.persistRecovery(cb);else cb(true);return;}
            MDS.sql("INSERT INTO pp_posted_inputs (coinid,handle) VALUES ('"+ids[at++].toLowerCase()+"','"+handle+"')",function(r){if(!r||r.status!==true){cb(false);return;}step();});}
        table(function(ok){if(!ok){cb(false);return;}step();});
    }
    /* Free this handle's claims. ONLY for a definite "nothing was broadcast": the node answered txnpost with
     * status:false (not pending), or the claim write itself failed before txnpost. An unanswered, pending or
     * uncertain post must stay held. Claims made by any other handle are never touched. */
    function release(ids,handle,cb){
        cb=cb||function(){};
        if(typeof handle!=='string'||!handle.match(/^[A-Za-z0-9_-]{1,150}$/)){cb(false);return;}
        MDS.sql("DELETE FROM pp_posted_inputs WHERE handle='"+handle+"'",function(r){
            if(!r||r.status!==true){cb(false);return;}
            (ids||[]).forEach(function(id){var k=String(id).toLowerCase();if(owner[k]===handle){delete held[k];delete owner[k];}});
            if(MDS.persistRecovery)MDS.persistRecovery(function(){cb(true);});else cb(true);
        });
    }
    /* Review 7 Nov (C-1): an uncertain post held its inputs FOREVER (no release path), so a BOOK/POOL take that never
     * mined kept the user's funding coins, order coins and pool reserves unusable in the app. The sweep (a service tick,
     * one block = one pass) settles every claim row from chain reads (`coins checkmempool:true coinid:` answers a coin
     * only while it is unspent, in the tree and out of the mempool / mining list):
     *   RELEASED  (never posted): first seen >= SWEEP_MS ago AND two CONSECUTIVE reads at least one block apart both
     *             answered it unspent and out of the mempool. One read is not enough: the miner drops a coin from its
     *             mining list a moment before the txn reaches the mempool, and a node restart empties the local mempool.
     *   DROPPED   (spent, or gone from the tree): absent on ABSENT_SWEEPS consecutive passes, or for over 24 h. The
     *             claim protects nothing any more (PoolInputClaims.check refuses a coin the node does not answer), and
     *             a row kept forever is re-queried every block.
     *   KEPT      otherwise: in the mempool, unreadable, or not yet proven either way.
     * One pass at a time (SWEEPING): a slow pass overlapping the next block's would double-count reads. Counters are
     * in memory, so a restart only makes the sweep start counting again (slower, never looser). */
    var SWEEP_MS=10*60000,ABSENT_SWEEPS=30,ABSENT_MS=24*3600000,firstSeen={},unspentAt={},absent={},SWEEPING=false;
    function sweepUnposted(cmd,nowMs,cb){
        cb=cb||function(){};nowMs=nowMs||Date.now();
        if(SWEEPING){cb(0);return;}
        SWEEPING=true;
        function done(n){SWEEPING=false;cb(n);}
        cmd('block',function(b){
            var tip=b&&b.status===true&&!b.pending&&b.response?parseInt(b.response.block,10):NaN;
            table(function(ok){if(!ok){done(0);return;}
                MDS.sql('SELECT coinid,handle FROM pp_posted_inputs',function(r){
                    if(!r||r.status!==true||!Array.isArray(r.rows)){done(0);return;}
                    var rows=r.rows,at=0,freed=0,live={};
                    function forget(id){delete firstSeen[id];delete unspentAt[id];delete absent[id];}
                    function drop(id,handle,why,counts){
                        MDS.sql("DELETE FROM pp_posted_inputs WHERE coinid='"+id+"'",function(d){
                            if(d&&d.status===true){delete held[id];delete owner[id];forget(id);if(counts)freed++;
                                try{MDS.log('PandaPools '+handle+': '+why);}catch(e){}}
                            next();
                        });
                    }
                    function next(){
                        if(at>=rows.length){for(var k in firstSeen)if(!live[k])forget(k);done(freed);return;}
                        var id=String(rows[at].COINID||rows[at].coinid||'').toLowerCase(),handle=String(rows[at].HANDLE||rows[at].handle||'');at++;
                        if(!valid(id)){next();return;}
                        live[id]=true;
                        if(!firstSeen[id])firstSeen[id]=nowMs;
                        cmd('coins checkmempool:true coinid:'+id,function(c){
                            if(!c||c.status!==true||c.pending||!Array.isArray(c.response)){delete unspentAt[id];next();return;}   // unreadable: proves nothing, breaks the streak
                            var coin=c.response.length===1?c.response[0]:null;
                            if(!c.response.length){
                                delete unspentAt[id];
                                var a=absent[id]||(absent[id]={n:0,since:nowMs});a.n++;
                                if(a.n>=ABSENT_SWEEPS||nowMs-a.since>ABSENT_MS){drop(id,handle,'claimed input '+id+' spent or gone from the chain tree for '+a.n+' sweeps, claim dropped',false);return;}
                                next();return;
                            }
                            delete absent[id];
                            if(!coin||String(coin.coinid).toLowerCase()!==id||coin.spent!==false||!isFinite(tip)){delete unspentAt[id];next();return;}
                            if(unspentAt[id]===undefined||tip<=unspentAt[id]){if(unspentAt[id]===undefined)unspentAt[id]=tip;next();return;}
                            if(nowMs-firstSeen[id]<SWEEP_MS){next();return;}
                            drop(id,handle,'not posted — claimed input '+id+' read unspent and out of the mempool at blocks '+unspentAt[id]+' and '+tip+', released',true);
                        });
                    }
                    next();
                });
            });
        });
    }
    /* cb(the subset of ids still claimed in the table) — or cb(null) when the table cannot be read. */
    function heldIds(ids,cb){
        if(!ids.length||ids.some(function(id){return !valid(id);})){cb(null);return;}
        table(function(ok){if(!ok){cb(null);return;}
            MDS.sql('SELECT coinid FROM pp_posted_inputs WHERE coinid IN ('+ids.map(function(id){return "'"+id.toLowerCase()+"'";}).join(',')+')',function(r){
                if(!r||r.status!==true||!Array.isArray(r.rows)){cb(null);return;}
                cb(r.rows.map(function(x){return String(x.COINID||x.coinid||'').toLowerCase();}));
            });
        });
    }
    return {load:load,check:check,post:post,release:release,blocked:blocked,sweepUnposted:sweepUnposted,heldIds:heldIds};
})();
