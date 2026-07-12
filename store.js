/*
 * store.js — local persistence via MDS SQL, mirroring the native SharedPreferences stores:
 *   LpStore      → pp_lp        : per-pool opening reserves + a fee-baseline product K (fees / IL / age).
 *   ActivityLog  → pp_activity  : this device's create/swap/deposit/migrate/close lifecycle
 *                                 (type, summary, txpowid, submitblock, status, ts) — the immediate
 *                                 "confirming n/3…" feedback layer before the node's own history catches up.
 *   GlobalFeed   → pp_feed (+ pp_kv snapshot) : a live feed of ALL pool swaps (incl. other people's),
 *                                 detected from the constant-product signature (one reserve up, one down).
 *
 * Tables are created with the "SELECT 1 … then CREATE if missing" pattern so a normal run never triggers a
 * pending SQL prompt on a restricted MDS. All writes are best-effort/fire-and-forget; reads take callbacks.
 */
var Store = (function () {
    var D = Decimal;
    var ready = false;
    var FEED_MAX = 100;
    var ACT_MAX = 120;
    var primed = false;   // in-memory: first ingest of this session reseeds silently (no phantom swap)

    function esc(v) { return String(v).replace(/'/g, "''"); }

    // ---------------------------------------------------------------- init
    function init(cb) {
        // probe one table; only CREATE the set if missing (avoids pending prompts)
        MDS.sql("SELECT 1 FROM pp_activity LIMIT 1", function (r) {
            if (r && r.status) { ready = true; if (cb) cb(); return; }
            create(function () { ready = true; if (cb) cb(); });
        });
    }

    function create(cb) {
        MDS.sql(
            "CREATE TABLE IF NOT EXISTS `pp_lp` (" +
            " `address` varchar(80) NOT NULL PRIMARY KEY," +
            " `initm` varchar(90) NOT NULL," +
            " `initt` varchar(90) NOT NULL," +
            " `feebase` varchar(120) NOT NULL," +
            " `block` int NOT NULL)", function () {
            MDS.sql(
                "CREATE TABLE IF NOT EXISTS `pp_activity` (" +
                " `id` bigint auto_increment," +
                " `type` varchar(16) NOT NULL," +
                " `summary` varchar(400) NOT NULL," +
                " `txpowid` varchar(80)," +
                " `submitblock` int NOT NULL," +
                " `status` varchar(12) NOT NULL," +      // 'ok' | 'failed'
                " `failmsg` varchar(400)," +
                " `ts` bigint NOT NULL)", function () {
                MDS.sql(
                    "CREATE TABLE IF NOT EXISTS `pp_feed` (" +
                    " `id` bigint auto_increment," +
                    " `pool` varchar(80) NOT NULL," +
                    " `tokenlabel` varchar(80) NOT NULL," +
                    " `minimain` int NOT NULL," +
                    " `minimaamt` varchar(90) NOT NULL," +
                    " `tokenamt` varchar(90) NOT NULL," +
                    " `price` varchar(90) NOT NULL," +
                    " `ts` bigint NOT NULL)", function () {
                    MDS.sql(
                        "CREATE TABLE IF NOT EXISTS `pp_kv` (" +
                        " `k` varchar(64) NOT NULL PRIMARY KEY," +
                        " `v` text NOT NULL)", function () { if (cb) cb(); });
                });
            });
        });
    }

    // ---------------------------------------------------------------- LpStore
    var LP_MC = { precision: 30, rounding: D.ROUND_DOWN };
    function lpRecord(address, initM, initT, block) {
        if (!ready || !address) return;
        var m = PP.dec(initM), t = PP.dec(initT);
        var fk = m.times(t);
        upsertLp(address, m, t, fk, block);
    }
    function lpUpdateFeeBase(address, newM, newT) {
        if (!ready || !address) return;
        lpGet(address, function (s) {
            if (!s) return;
            upsertLp(address, s.initM, s.initT, PP.dec(newM).times(PP.dec(newT)), s.block);
        });
    }
    function upsertLp(address, m, t, fk, block) {
        var a = esc(address.toLowerCase());
        MDS.sql("DELETE FROM pp_lp WHERE address='" + a + "'", function () {
            MDS.sql("INSERT INTO pp_lp (address, initm, initt, feebase, block) VALUES ('" +
                a + "','" + esc(PP.amt(m)) + "','" + esc(PP.amt(t)) + "','" + esc(PP.amt(fk)) + "'," + (parseInt(block) || 0) + ")");
        });
    }
    function lpRemove(address) {
        if (!ready || !address) return;
        MDS.sql("DELETE FROM pp_lp WHERE address='" + esc(address.toLowerCase()) + "'");
    }
    function lpGet(address, cb) {
        if (!ready || !address) { cb(null); return; }
        MDS.sql("SELECT * FROM pp_lp WHERE address='" + esc(address.toLowerCase()) + "'", function (r) {
            if (!r || !r.status || !r.rows || !r.rows.length) { cb(null); return; }
            var row = r.rows[0];
            var m = PP.decOr(row.INITM, 0), t = PP.decOr(row.INITT, 0);
            cb({
                initM: m, initT: t,
                initPrice: (m.gt(0)) ? t.div(m) : new D(0),
                feeBaseK: PP.decOr(row.FEEBASE, m.times(t)),
                block: parseInt(row.BLOCK) || 0
            });
        });
    }

    // ---------------------------------------------------------------- ActivityLog
    function actRecord(type, summary, txpowid, submitBlock) {
        if (!ready) return;
        MDS.sql("INSERT INTO pp_activity (type, summary, txpowid, submitblock, status, failmsg, ts) VALUES ('" +
            esc(type) + "','" + esc(summary) + "','" + esc(txpowid || "") + "'," + (parseInt(submitBlock) || 0) +
            ",'ok','', " + Date.now() + ")", function () { trimActivity(); });
    }
    function actRecordFailed(type, summary, failMsg) {
        if (!ready) return;
        MDS.sql("INSERT INTO pp_activity (type, summary, txpowid, submitblock, status, failmsg, ts) VALUES ('" +
            esc(type) + "','" + esc(summary) + "','',0,'failed','" + esc(failMsg || "") + "', " + Date.now() + ")", function () { trimActivity(); });
    }
    function trimActivity() {
        MDS.sql("SELECT id FROM pp_activity ORDER BY id DESC LIMIT 1 OFFSET " + ACT_MAX, function (r) {
            if (r && r.status && r.rows && r.rows.length) MDS.sql("DELETE FROM pp_activity WHERE id <= " + (parseInt(r.rows[0].ID) || 0));
        });
    }
    /** cb(entries[]) newest first. Each: {type,summary,txpowid,submitBlock,ts,failed,failMsg}. */
    function actList(limit, cb) {
        if (!ready) { cb([]); return; }
        MDS.sql("SELECT * FROM pp_activity ORDER BY id DESC LIMIT " + (limit || ACT_MAX), function (r) {
            var out = [];
            if (r && r.status && r.rows) r.rows.forEach(function (row) {
                out.push({
                    type: row.TYPE, summary: row.SUMMARY,
                    txpowid: row.TXPOWID || "", submitBlock: parseInt(row.SUBMITBLOCK) || 0,
                    ts: parseInt(row.TS) || 0, failed: row.STATUS === "failed", failMsg: row.FAILMSG || ""
                });
            });
            cb(out);
        });
    }
    var CONFIRM_BLOCKS = 3;
    function confirmed(entry, chainBlock) {
        if (entry.failed) return false;
        if (entry.submitBlock > 0 && chainBlock > 0) return (chainBlock - entry.submitBlock) >= CONFIRM_BLOCKS;
        return (Date.now() - entry.ts) > 4 * 60000;
    }
    function statusText(entry, chainBlock) {
        if (entry.failed) return "Failed";
        if (confirmed(entry, chainBlock)) return "Confirmed";
        if (chainBlock <= 0 || entry.submitBlock <= 0) return "Submitted";
        var el = Math.max(0, chainBlock - entry.submitBlock);
        return "Confirming " + Math.min(el, CONFIRM_BLOCKS) + "/" + CONFIRM_BLOCKS;
    }

    // ---------------------------------------------------------------- GlobalFeed
    function loadSnap(cb) {
        MDS.sql("SELECT v FROM pp_kv WHERE k='snap'", function (r) {
            var snap = {};
            if (r && r.status && r.rows && r.rows.length) {
                try { snap = JSON.parse(r.rows[0].V) || {}; } catch (e) { snap = {}; }
            }
            cb(snap);
        });
    }
    function saveSnap(snap) {
        var v = esc(JSON.stringify(snap));
        MDS.sql("DELETE FROM pp_kv WHERE k='snap'", function () {
            MDS.sql("INSERT INTO pp_kv (k, v) VALUES ('snap','" + v + "')");
        });
    }

    /** Ingest a scan: detect swaps vs the last snapshot, append events, update the snapshot. */
    function feedIngest(pools) {
        if (!ready || !pools) return;
        var firstScanThisSession = !primed;
        primed = true;
        loadSnap(function (snap) {
            var seen = {};
            var now = Date.now();
            var inserts = [];
            for (var i = 0; i < pools.length; i++) {
                var p = pools[i];
                if (!p || !p.address || !Curve.funded(p)) continue;
                var addr = p.address.toLowerCase();
                seen[addr] = true;
                var prev = snap[addr];
                var rm = PP.dec(p.reserveM), rt = PP.dec(p.reserveT);
                snap[addr] = rm.toString() + "|" + rt.toString();
                if (prev === undefined || firstScanThisSession) continue;   // seed only; never diff a stale snapshot
                var bar = prev.indexOf("|");
                if (bar < 0) continue;
                var oldM, oldT;
                try { oldM = PP.dec(prev.substring(0, bar)); oldT = PP.dec(prev.substring(bar + 1)); } catch (e) { continue; }
                var cm = rm.cmp(oldM), ct = rt.cmp(oldT);
                if (cm > 0 && ct < 0) {                        // MINIMA in, token out
                    var dm1 = rm.minus(oldM), dt1 = oldT.minus(rt);
                    inserts.push({ pool: addr, label: PP.tokenLabel(p), min: 1, m: dm1, t: dt1, price: price(dt1, dm1), ts: now });
                } else if (cm < 0 && ct > 0) {                 // token in, MINIMA out
                    var dm2 = oldM.minus(rm), dt2 = rt.minus(oldT);
                    inserts.push({ pool: addr, label: PP.tokenLabel(p), min: 0, m: dm2, t: dt2, price: price(dt2, dm2), ts: now });
                }
                // both-up (deposit/migrate) or both-down: not a swap → ignore
            }
            // drop snapshots for vanished (closed) pools so a re-created address counts as new
            for (var k in snap) if (snap.hasOwnProperty(k) && !seen[k]) delete snap[k];
            saveSnap(snap);
            inserts.forEach(function (ev) {
                MDS.sql("INSERT INTO pp_feed (pool, tokenlabel, minimain, minimaamt, tokenamt, price, ts) VALUES ('" +
                    esc(ev.pool) + "','" + esc(ev.label) + "'," + ev.min + ",'" + esc(PP.amt(ev.m)) + "','" +
                    esc(PP.amt(ev.t)) + "','" + esc(PP.amt(ev.price)) + "'," + ev.ts + ")");
            });
            if (inserts.length) trimFeed();
        });
    }
    function price(tok, minima) {
        var mn = PP.dec(minima);
        if (mn.isZero()) return new D(0);
        return PP.dec(tok).div(mn);
    }
    function trimFeed() {
        MDS.sql("SELECT id FROM pp_feed ORDER BY id DESC LIMIT 1 OFFSET " + FEED_MAX, function (r) {
            if (r && r.status && r.rows && r.rows.length) MDS.sql("DELETE FROM pp_feed WHERE id <= " + (parseInt(r.rows[0].ID) || 0));
        });
    }
    /** cb(events[]) newest first. Each: {pool,tokenLabel,minimaIn,minimaAmt,tokenAmt,price,ts}. */
    function feedList(limit, cb) {
        if (!ready) { cb([]); return; }
        MDS.sql("SELECT * FROM pp_feed ORDER BY id DESC LIMIT " + (limit || FEED_MAX), function (r) {
            var out = [];
            if (r && r.status && r.rows) r.rows.forEach(function (row) {
                out.push({
                    pool: row.POOL, tokenLabel: row.TOKENLABEL, minimaIn: String(row.MINIMAIN) === "1",
                    minimaAmt: PP.decOr(row.MINIMAAMT, 0), tokenAmt: PP.decOr(row.TOKENAMT, 0),
                    price: PP.decOr(row.PRICE, 0), ts: parseInt(row.TS) || 0
                });
            });
            cb(out);
        });
    }

    return {
        init: init, isReady: function () { return ready; },
        lpRecord: lpRecord, lpUpdateFeeBase: lpUpdateFeeBase, lpRemove: lpRemove, lpGet: lpGet,
        actRecord: actRecord, actRecordFailed: actRecordFailed, actList: actList,
        confirmed: confirmed, statusText: statusText, CONFIRM_BLOCKS: CONFIRM_BLOCKS,
        feedIngest: feedIngest, feedList: feedList
    };
})();
