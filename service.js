/*
 * service.js — PandaPools background worker. Runs headless whenever the node is up (page open or not), so:
 *   (1) the sentinel coin notifier stays registered,
 *   (2) pool discovery stays fresh and every newly-seen registry pool is `newscript trackall`-ed
 *       (track-on-discovery) → it becomes a tracked contract that NEVER prunes, so this node keeps the pool
 *       enumerable + swappable forever, and
 *   (3) the GlobalFeed keeps capturing swaps across all pools even while the UI is closed.
 *
 * SELF-CONTAINED: the MDS service runtime injects only the `MDS` global (no decimal.js, no dapp modules), so
 * the covenant template, script-arg quoting, state reading and an exact BigInt fixed-point decimal are all
 * inlined here. It shares the `pp_feed` / `pp_kv` SQL tables with the page's store.js (same MDS database).
 */

var SENTINEL = "0x50414E4441504F4F4C53";     // "PANDAPOOLS"
var FEED_MAX = 100;
var READY = false;
var PRIMED = false;   // first ingest of this service session reseeds the snapshot silently (no phantom swap)

// The covenant template, ONE line, byte-identical to PoolCovenant/covenant.js (0.5% fee = *5/1000).
var TEMPLATE =
    "IF SIGNEDBY($OPK) THEN " +
    "IF VERIFYOUT(@INPUT $OADR @AMOUNT @TOKENID FALSE) THEN RETURN TRUE ENDIF " +
    "RETURN GETOUTADDR(@INPUT) EQ @ADDRESS AND GETOUTTOK(@INPUT) EQ @TOKENID AND GETOUTAMT(@INPUT) GTE @AMOUNT " +
    "ENDIF " +
    "IF @TOKENID EQ 0x00 THEN " +
    "ASSERT @INPUT % 2 EQ 0 LET s=@INPUT+1 " +
    "ASSERT GETINADDR(s) EQ @ADDRESS AND GETINTOK(s) EQ $TOK " +
    "ASSERT GETOUTADDR(s) EQ @ADDRESS AND GETOUTTOK(s) EQ $TOK " +
    "LET x=@AMOUNT LET y=GETINAMT(s) LET nx=GETOUTAMT(@INPUT) LET ny=GETOUTAMT(s) " +
    "ASSERT VERIFYOUT(@INPUT @ADDRESS nx 0x00 FALSE) " +
    "ELSE " +
    "ASSERT @TOKENID EQ $TOK AND @INPUT % 2 EQ 1 LET s=@INPUT-1 " +
    "ASSERT GETINADDR(s) EQ @ADDRESS AND GETINTOK(s) EQ 0x00 " +
    "ASSERT GETOUTADDR(s) EQ @ADDRESS AND GETOUTTOK(s) EQ 0x00 " +
    "LET y=@AMOUNT LET x=GETINAMT(s) LET ny=GETOUTAMT(@INPUT) LET nx=GETOUTAMT(s) " +
    "ASSERT VERIFYOUT(@INPUT @ADDRESS ny $TOK FALSE) " +
    "ENDIF " +
    "LET dx=nx-x LET dy=ny-y LET fx=MAX(dx 0)*5/1000 LET fy=MAX(dy 0)*5/1000 " +
    "RETURN (nx-fx)*(ny-fy) GTE MAX(x*y $KMIN)";

function covScript(opk, oadr, tok, kmin) {
    return TEMPLATE.split("$OPK").join(opk).split("$OADR").join(oadr).split("$TOK").join(tok).split("$KMIN").join(kmin);
}
// Quote a KISS script WITHOUT escaping forward slashes (JSONObject.quote's `/`→`\/` makes *5/1000 unparseable
// → coins permanently unspendable). Escape only `"` and `\`; leave `/` alone.
function scriptArg(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (c === '"' || c === '\\') out += '\\'; out += c; }
    return out + '"';
}
function truthy(v) {
    if (v === true) return true;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") { var s = v.trim().toLowerCase(); return s === "1" || s === "true"; }
    return false;
}
function readState(coin, port) {
    if (!coin || !coin.state) return null;
    var st = coin.state;
    if (Array.isArray(st)) {
        for (var i = 0; i < st.length; i++) {
            var e = st[i];
            if (e && (e.port === port || String(e.port) === String(port))) { var d = e.data || ""; return d === "" ? null : d; }
        }
        return null;
    }
    if (typeof st === "object") { var v = st[String(port)]; return (v === undefined || v === null || v === "") ? null : v; }
    return null;
}

// covenant literal extractors (recover a pool from a tracked contract script)
var P_OPK = /SIGNEDBY\((0x[0-9A-Fa-f]+)\)/;
var P_OADR = /VERIFYOUT\(@INPUT (0x[0-9A-Fa-f]+) @AMOUNT/;
var P_TOK = /GETINTOK\(s\) EQ (0x[0-9A-Fa-f]+)/;
var P_KMIN = /GTE MAX\(x\*y ([0-9.]+)\)/;
function grp(re, s) { var m = re.exec(s); return m ? m[1] : null; }

// ---------------------------------------------------------------- exact fixed-point decimal (BigInt, float fallback)
var HAS_BIG = (typeof BigInt !== "undefined");
function splitDec(s) { s = String(s); var i = s.indexOf("."); return { I: i < 0 ? s : s.slice(0, i), F: i < 0 ? "" : s.slice(i + 1) }; }
function decCmp(a, b) {   // non-negative decimal strings -> -1/0/1
    var sa = splitDec(a), sb = splitDec(b);
    var aI = (sa.I.replace(/^0+/, "") || "0"), bI = (sb.I.replace(/^0+/, "") || "0");
    if (aI.length !== bI.length) return aI.length < bI.length ? -1 : 1;
    if (aI !== bI) return aI < bI ? -1 : 1;
    var L = Math.max(sa.F.length, sb.F.length);
    var aF = sa.F + Array(L - sa.F.length + 1).join("0");
    var bF = sb.F + Array(L - sb.F.length + 1).join("0");
    return aF === bF ? 0 : (aF < bF ? -1 : 1);
}
function pad0(s, n) { while (s.length < n) s = "0" + s; return s; }
function unscale(digits, L) {
    var neg = digits.charAt(0) === "-"; if (neg) digits = digits.slice(1);
    if (L === 0) return (neg ? "-" : "") + (digits.replace(/^0+/, "") || "0");
    digits = pad0(digits, L + 1);
    var I = digits.slice(0, digits.length - L), F = digits.slice(digits.length - L).replace(/0+$/, "");
    return (neg ? "-" : "") + (I.replace(/^0+/, "") || "0") + (F ? "." + F : "");
}
function scaleTo(s, L) { var sp = splitDec(s); var F = sp.F + Array(L - sp.F.length + 1).join("0"); return (sp.I + F).replace(/^0+/, "") || "0"; }
function decSub(a, b) {   // a-b, a>=b>=0
    if (!HAS_BIG) return String(parseFloat(a) - parseFloat(b));
    var L = Math.max(splitDec(a).F.length, splitDec(b).F.length);
    return unscale((BigInt(scaleTo(a, L)) - BigInt(scaleTo(b, L))).toString(), L);
}
function decDiv(a, b, dp) {   // a/b to dp fractional digits, non-negative
    if (!HAS_BIG) { var bf = parseFloat(b); return bf ? String(parseFloat(a) / bf) : "0"; }
    var la = splitDec(a).F.length, lb = splitDec(b).F.length;
    var num = BigInt(scaleTo(a, la)) * pow10(lb + dp);
    var den = BigInt(scaleTo(b, lb)) * pow10(la);
    if (den === BigInt(0)) return "0";
    return unscale((num / den).toString(), dp);
}
function pow10(n) { var r = BigInt(1), t = BigInt(10); for (var i = 0; i < n; i++) r = r * t; return r; }

// ---------------------------------------------------------------- init
MDS.init(function (msg) {
    if (msg.event === "inited") {
        MDS.cmd("coinnotify action:add address:" + SENTINEL, function () {});
        ensureTables(function () { READY = true; MDS.log("PandaPools service ready"); scan(); });
    }
    if (msg.event === "NEWBLOCK") { if (READY) scan(); }
});

function ensureTables(cb) {
    MDS.sql("SELECT 1 FROM pp_feed LIMIT 1", function (r) {
        if (r && r.status) { cb(); return; }
        MDS.sql(
            "CREATE TABLE IF NOT EXISTS `pp_feed` (" +
            " `id` bigint auto_increment, `pool` varchar(80) NOT NULL, `tokenlabel` varchar(80) NOT NULL," +
            " `minimain` int NOT NULL, `minimaamt` varchar(90) NOT NULL, `tokenamt` varchar(90) NOT NULL," +
            " `price` varchar(90) NOT NULL, `ts` bigint NOT NULL)", function () {
            MDS.sql("CREATE TABLE IF NOT EXISTS `pp_kv` (`k` varchar(64) NOT NULL PRIMARY KEY, `v` text NOT NULL)", function () { cb(); });
        });
    });
}

// ---------------------------------------------------------------- discovery (mirrors book.js, self-contained)
function scan() {
    var params = {};   // "opk|tok|kmin" -> {opk,oadr,tok,kmin,script?}
    MDS.cmd("scripts", function (sres) {
        try {
            var arr = (sres && sres.status && Array.isArray(sres.response)) ? sres.response : [];
            for (var i = 0; i < arr.length; i++) {
                var sc = arr[i] ? (arr[i].script || "") : "";
                if (sc.indexOf("VERIFYOUT(@INPUT @ADDRESS") < 0 || sc.indexOf("GTE MAX(x*y") < 0) continue;
                var opk = grp(P_OPK, sc), oadr = grp(P_OADR, sc), tok = grp(P_TOK, sc), kmin = grp(P_KMIN, sc);
                if (!opk || !oadr || !tok || !kmin) continue;
                var k = opk + "|" + tok + "|" + kmin;
                if (!params[k]) params[k] = { opk: opk, oadr: oadr, tok: tok, kmin: kmin, script: sc };
            }
        } catch (e) {}
        MDS.cmd("coins simplestate:true order:desc address:" + SENTINEL, function (cres) {
            var coins = (cres && cres.status && Array.isArray(cres.response)) ? cres.response : [];
            for (var j = 0; j < coins.length; j++) {
                var c = coins[j];
                var t = readState(c, 2), o = readState(c, 3), pk = readState(c, 4), km = readState(c, 5);
                if (!t || !o || !pk || !km) continue;
                var key = pk + "|" + t + "|" + km;
                if (!params[key]) params[key] = { opk: pk, oadr: o, tok: t, kmin: km };
            }
            derive(params);
        });
    });
}

function derive(params) {
    var list = [];
    for (var k in params) if (params.hasOwnProperty(k)) list.push(params[k]);
    if (!list.length) return;
    var pools = [];
    var pending = list.length;
    function oneDone() { if (--pending === 0) fund(pools); }
    list.forEach(function (p) {
        var tracked = p.script || null;
        var script = tracked || covScript(p.opk, p.oadr, p.tok, p.kmin);
        MDS.cmd("runscript script:" + scriptArg(script), function (jr) {
            try {
                var resp = jr ? jr.response : null;
                if (resp && truthy(resp.parseok) && resp.script) {
                    pools.push({
                        opk: p.opk, oadr: p.oadr, tok: p.tok, kmin: p.kmin,
                        address: resp.script.address, covenantScript: tracked ? null : script,
                        reserveM: null, reserveT: null
                    });
                }
            } catch (e) {}
            oneDone();
        });
    });
}

function fund(pools) {
    if (!pools.length) return;
    var pending = pools.length;
    function oneDone() { if (--pending === 0) done(pools); }
    pools.forEach(function (pool) {
        MDS.cmd("coins address:" + pool.address, function (j) {
            var cs = (j && j.status && Array.isArray(j.response)) ? j.response : [];
            for (var i = 0; i < cs.length; i++) {
                var c = cs[i];
                if (!c || c.spent === true) continue;
                var tid = c.tokenid || "";
                if (tid === "0x00") {
                    var m = c.amount || "0";
                    if (pool.reserveM === null || decCmp(m, pool.reserveM) > 0) pool.reserveM = m;
                } else if (pool.tok && pool.tok.toLowerCase() === tid.toLowerCase()) {
                    var t = (c.tokenamount !== undefined ? c.tokenamount : (c.amount || "0"));
                    if (pool.reserveT === null || decCmp(t, pool.reserveT) > 0) { pool.reserveT = t; pool.tokLabel = labelOf(c.token, tid); }
                }
            }
            oneDone();
        });
    });
}

function labelOf(token, tid) {
    if (typeof token === "string") return token;
    if (token && typeof token === "object" && token.name) {
        if (typeof token.name === "object") return token.name.ticker || token.name.name || short(tid);
        if (typeof token.name === "string") return token.name;
    }
    return short(tid);
}
function short(s) { s = (s && s.indexOf("0x") === 0) ? s.substring(2) : (s || ""); return s.length > 8 ? s.substring(0, 8) + "…" : s; }
function isFunded(p) { return p.reserveM && p.reserveT && decCmp(p.reserveM, "0") > 0 && decCmp(p.reserveT, "0") > 0; }

function done(pools) {
    var funded = [];
    for (var i = 0; i < pools.length; i++) {
        var p = pools[i];
        if (!isFunded(p)) continue;
        funded.push(p);
        if (p.covenantScript) {   // track-on-discovery: keep this pool tracked on our node forever
            MDS.cmd("newscript trackall:true script:" + scriptArg(p.covenantScript), function () {});
            p.covenantScript = null;
        }
    }
    ingestFeed(funded);
}

// ---------------------------------------------------------------- GlobalFeed ingest (shares pp_feed / pp_kv)
function ingestFeed(pools) {
    var firstScan = !PRIMED;
    PRIMED = true;
    MDS.sql("SELECT v FROM pp_kv WHERE k='snap'", function (r) {
        var snap = {};
        if (r && r.status && r.rows && r.rows.length) { try { snap = JSON.parse(r.rows[0].V) || {}; } catch (e) { snap = {}; } }
        var seen = {}, now = Date.now(), inserts = [];
        for (var i = 0; i < pools.length; i++) {
            var p = pools[i];
            if (!isFunded(p)) continue;
            var addr = p.address.toLowerCase();
            seen[addr] = true;
            var prev = snap[addr];
            snap[addr] = p.reserveM + "|" + p.reserveT;
            if (prev === undefined || firstScan) continue;
            var bar = prev.indexOf("|");
            if (bar < 0) continue;
            var oldM = prev.substring(0, bar), oldT = prev.substring(bar + 1);
            var cm = decCmp(p.reserveM, oldM), ct = decCmp(p.reserveT, oldT);
            if (cm > 0 && ct < 0) {                 // MINIMA in, token out
                var dm1 = decSub(p.reserveM, oldM), dt1 = decSub(oldT, p.reserveT);
                inserts.push({ pool: addr, label: p.tokLabel || short(p.tok), min: 1, m: dm1, t: dt1, price: decDiv(dt1, dm1, 12), ts: now });
            } else if (cm < 0 && ct > 0) {          // token in, MINIMA out
                var dm2 = decSub(oldM, p.reserveM), dt2 = decSub(p.reserveT, oldT);
                inserts.push({ pool: addr, label: p.tokLabel || short(p.tok), min: 0, m: dm2, t: dt2, price: decDiv(dt2, dm2, 12), ts: now });
            }
        }
        for (var kk in snap) if (snap.hasOwnProperty(kk) && !seen[kk]) delete snap[kk];
        saveSnap(snap);
        inserts.forEach(function (ev) {
            MDS.sql("INSERT INTO pp_feed (pool, tokenlabel, minimain, minimaamt, tokenamt, price, ts) VALUES ('" +
                esc(ev.pool) + "','" + esc(ev.label) + "'," + ev.min + ",'" + esc(ev.m) + "','" + esc(ev.t) + "','" + esc(ev.price) + "'," + ev.ts + ")");
        });
        if (inserts.length) trimFeed();
    });
}
function saveSnap(snap) {
    var v = esc(JSON.stringify(snap));
    MDS.sql("DELETE FROM pp_kv WHERE k='snap'", function () { MDS.sql("INSERT INTO pp_kv (k, v) VALUES ('snap','" + v + "')"); });
}
function trimFeed() {
    MDS.sql("SELECT id FROM pp_feed ORDER BY id DESC LIMIT 1 OFFSET " + FEED_MAX, function (r) {
        if (r && r.status && r.rows && r.rows.length) MDS.sql("DELETE FROM pp_feed WHERE id <= " + (parseInt(r.rows[0].ID) || 0));
    });
}
function esc(v) { return String(v).replace(/'/g, "''"); }
