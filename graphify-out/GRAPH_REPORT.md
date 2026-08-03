# Graph Report - pandapools-mds  (2026-08-02)

## Corpus Check
- 15 files · ~64,622 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 347 nodes · 627 edges · 21 communities (18 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a0854197`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- service.js
- poolmgr.js
- decimal.js
- store.js
- curve.js
- book.js
- mds.js
- finalise
- digitsToString
- getPi
- parseOther
- router.js
- cosine
- log
- maxOrMin
- build.sh
- Changelog
- statement.js
- history.js
- PandaPools — MiniDapp

## God Nodes (most connected - your core abstractions)
1. `Changelog` - 23 edges
2. `buildAndPost()` - 19 edges
3. `PandaPools — MiniDapp` - 15 edges
4. `ingestFeed()` - 12 edges
5. `block()` - 12 edges
6. `esc()` - 12 edges
7. `tag()` - 10 edges
8. `checkPostSvc()` - 10 edges
9. `finalise()` - 10 edges
10. `decCmp()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `naturalExponential()` --calls--> `digitsToString()`  [EXTRACTED]
  decimal.js → decimal.js  _Bridges community 8 → community 7_
- `parseOther()` --calls--> `convertBase()`  [EXTRACTED]
  decimal.js → decimal.js  _Bridges community 8 → community 10_
- `getPi()` --calls--> `finalise()`  [EXTRACTED]
  decimal.js → decimal.js  _Bridges community 7 → community 9_

## Import Cycles
- None detected.

## Communities (21 total, 3 thin omitted)

### Community 0 - "service.js"
Cohesion: 0.09
Nodes (56): acquireGlobalSignLockSvc(), annKeySvc(), bestMinimaCoinSvc(), checkPostSvc(), clearSignWatchdogSvc(), covScript(), decCmp(), decDiv() (+48 more)

### Community 1 - "poolmgr.js"
Cohesion: 0.08
Nodes (56): acquireGlobalSignLock(), addAnnounceState(), advanceKeyUses(), buildAndPost(), buildCreate(), buildMigrate(), buildRouted(), burnTo() (+48 more)

### Community 3 - "store.js"
Cohesion: 0.11
Nodes (20): actRecord(), actRecordFailed(), actSetStatus(), confirmed(), create(), esc(), histInsert(), init() (+12 more)

### Community 4 - "curve.js"
Cohesion: 0.16
Nodes (19): aggregatePrice(), amt(), clampDec(), dec(), decOr(), feeGrowth(), fix(), funded() (+11 more)

### Community 5 - "book.js"
Cohesion: 0.31
Nodes (8): derivePools(), finishScan(), gatherOwned(), gatherRegistry(), group(), parseScripts(), readState(), scan()

### Community 6 - "mds.js"
Cohesion: 0.27
Nodes (5): httpPostAsync(), httpPostAsyncPoll(), MDSPostMessage(), PollListener(), postMDSFail()

### Community 7 - "finalise"
Cohesion: 0.24
Nodes (10): ceil(), checkRoundingDigits(), finalise(), floor(), getLn10(), naturalExponential(), naturalLogarithm(), round() (+2 more)

### Community 8 - "digitsToString"
Cohesion: 0.32
Nodes (8): checkInt32(), convertBase(), digitsToString(), finiteToString(), getZeroString(), nonFiniteToString(), random(), toStringBinary()

### Community 9 - "getPi"
Cohesion: 0.40
Nodes (5): atan(), atan2(), getPi(), isOdd(), toLessThanHalfPi()

### Community 10 - "parseOther"
Cohesion: 0.40
Nodes (5): getBase10Exponent(), intPow(), parseDecimal(), parseOther(), truncate()

### Community 12 - "cosine"
Cohesion: 0.67
Nodes (4): cosine(), sine(), taylorSeries(), tinyPow()

### Community 13 - "log"
Cohesion: 0.67
Nodes (3): log(), log10(), log2()

### Community 14 - "maxOrMin"
Cohesion: 0.67
Nodes (3): max(), maxOrMin(), min()

### Community 16 - "Changelog"
Cohesion: 0.09
Nodes (23): [0.1.7] — Initial MiniDapp, [0.1.8] — Stage 0: background service + hygiene, [0.2.0] — Stage 1: Activity parity, [0.3.0] — Stage 2: recovery Layers 1/2 (recipe persistence + re-track on launch), [0.4.0] — Stage 3: recovery Layers 3/4 (backup / restore + guidance), [0.5.0] — Stage 4: recovery Layer 5 (faded-beacon re-announce), [0.6.0] — Stage 5: parity complete (polish + final integration review), [0.6.10] — persistent paged history (#67) + the per-pool statement (+15 more)

### Community 17 - "statement.js"
Cohesion: 0.26
Nodes (17): block(), build(), cell(), cells(), classify(), d(), fixed(), hasBeacon() (+9 more)

### Community 18 - "history.js"
Cohesion: 0.36
Nodes (7): coins(), entryFrom(), finish(), firstAddr(), page(), shrink(), sync()

### Community 19 - "PandaPools — MiniDapp"
Cohesion: 0.10
Nodes (19): Architecture & file map, Build & release, Constant-product pools with a unique address each, Contents, Discovery — trust nothing, Exact math, Fund-safety design, How the AMM works (+11 more)

## Knowledge Gaps
- **40 isolated node(s):** `[0.6.17] — conservative history paging under the MDS reply cap`, `[0.6.16] — token-metadata network hardening parity`, `[0.6.15] — documentation/header parity polish for the native 0.9.23 line`, `[0.6.14] — finish native 0.9.23 parity: MiniDapp-wide signing, shared coin locks, spendable coin tags`, `[0.6.11] — carry the owner key's signature count through backup and restore` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Changelog` connect `Changelog` to `PandaPools — MiniDapp`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `[0.6.17] — conservative history paging under the MDS reply cap`, `[0.6.16] — token-metadata network hardening parity`, `[0.6.15] — documentation/header parity polish for the native 0.9.23 line` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `service.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08711433756805807 - nodes in this community are weakly interconnected._
- **Should `poolmgr.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08357685563997662 - nodes in this community are weakly interconnected._
- **Should `decimal.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `store.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1103448275862069 - nodes in this community are weakly interconnected._
- **Should `Changelog` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._