# Graph Report - pandapools-mds  (2026-08-02)

## Corpus Check
- 15 files · ~62,762 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 286 nodes · 518 edges · 19 communities (16 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7ba07423`
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

## God Nodes (most connected - your core abstractions)
1. `Changelog` - 19 edges
2. `buildAndPost()` - 13 edges
3. `block()` - 12 edges
4. `esc()` - 12 edges
5. `ingestFeed()` - 12 edges
6. `finalise()` - 10 edges
7. `tag()` - 9 edges
8. `selectCoins()` - 8 edges
9. `decCmp()` - 8 edges
10. `funded()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `finishScan()` --indirect_call--> `k()`  [INFERRED]
  book.js → curve.js
- `derivePools()` --indirect_call--> `script()`  [INFERRED]
  book.js → covenant.js
- `scan()` --indirect_call--> `kmin()`  [INFERRED]
  service.js → covenant.js
- `derive()` --indirect_call--> `k()`  [INFERRED]
  service.js → curve.js
- `maybeReannounceSvc()` --indirect_call--> `k()`  [INFERRED]
  service.js → curve.js

## Import Cycles
- None detected.

## Communities (19 total, 3 thin omitted)

### Community 0 - "service.js"
Cohesion: 0.12
Nodes (39): script(), annKeySvc(), covScript(), decCmp(), decDiv(), decSnap(), decSub(), derive() (+31 more)

### Community 1 - "poolmgr.js"
Cohesion: 0.12
Nodes (37): addAnnounceState(), advanceKeyUses(), buildAndPost(), buildCreate(), buildMigrate(), buildRouted(), burnTo(), close() (+29 more)

### Community 3 - "store.js"
Cohesion: 0.11
Nodes (20): actRecord(), actRecordFailed(), actSetStatus(), confirmed(), create(), esc(), histInsert(), init() (+12 more)

### Community 4 - "curve.js"
Cohesion: 0.16
Nodes (19): aggregatePrice(), amt(), clampDec(), dec(), decOr(), feeGrowth(), fix(), funded() (+11 more)

### Community 5 - "book.js"
Cohesion: 0.20
Nodes (9): derivePools(), finishScan(), gatherOwned(), gatherRegistry(), group(), parseScripts(), readState(), scan() (+1 more)

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
Cohesion: 0.10
Nodes (19): [0.1.7] — Initial MiniDapp, [0.1.8] — Stage 0: background service + hygiene, [0.2.0] — Stage 1: Activity parity, [0.3.0] — Stage 2: recovery Layers 1/2 (recipe persistence + re-track on launch), [0.4.0] — Stage 3: recovery Layers 3/4 (backup / restore + guidance), [0.5.0] — Stage 4: recovery Layer 5 (faded-beacon re-announce), [0.6.0] — Stage 5: parity complete (polish + final integration review), [0.6.10] — persistent paged history (#67) + the per-pool statement (+11 more)

### Community 17 - "statement.js"
Cohesion: 0.26
Nodes (17): block(), build(), cell(), cells(), classify(), d(), fixed(), hasBeacon() (+9 more)

### Community 18 - "history.js"
Cohesion: 0.36
Nodes (7): coins(), entryFrom(), finish(), firstAddr(), page(), shrink(), sync()

## Knowledge Gaps
- **19 isolated node(s):** `[0.6.11] — carry the owner key's signature count through backup and restore`, `[0.6.10] — persistent paged history (#67) + the per-pool statement`, `[0.6.9] — Wallet: the full balance breakdown + a coin list (parity with native 0.9.20)`, `[0.6.8] — Pools tab: Individual | Combined view toggle`, `[0.6.7] — owner-key self-heal before Withdraw / Migrate / Close` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `k()` connect `curve.js` to `service.js`, `book.js`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `derive()` connect `service.js` to `curve.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `maybeReannounceSvc()` connect `service.js` to `curve.js`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `[0.6.11] — carry the owner key's signature count through backup and restore`, `[0.6.10] — persistent paged history (#67) + the per-pool statement`, `[0.6.9] — Wallet: the full balance breakdown + a coin list (parity with native 0.9.20)` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `service.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12073170731707317 - nodes in this community are weakly interconnected._
- **Should `poolmgr.js` be split into smaller, more focused modules?**
  _Cohesion score 0.12435897435897436 - nodes in this community are weakly interconnected._
- **Should `decimal.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._