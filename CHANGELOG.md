# Changelog

All notable changes to the PandaPools MiniDapp. Newest first. Each release is tagged and its `.mds.zip` is attached to the corresponding [GitHub Release](../../releases).

Versions `0.1.8` → `0.6.0` are a six-stage upgrade that brought the MiniDapp to **full feature parity with the native Android app (0.9.9)**. Every stage went through an implement → adversarial code-review → fix → re-review loop before release.

---

## [0.6.0] — Stage 5: parity complete (polish + final integration review)

Feature parity with the native app is complete: 5 tabs, trust-nothing discovery, all four lifecycle transactions, scoped My Activity + full-lifecycle All Pools, and the full 5-layer pool recovery.

- **Added** a "Use MEXC market price" helper to the USDT create form (fills the token side at the live market mid so a pool opens balanced) — priced-create parity with the native app.
- **Fixed** (final full-app integration review): the background service `scan()` now has a **re-entrancy guard** (with a 2-minute stuck-guard), matching the page and the native app's synchronized ingest — prevents a snapshot/feed race under new-block bursts.
- **Fixed** My Activity now bounds its `history` query (`max:50`) instead of fetching the node's entire relevant set (~2 MB) on every render.
- Review confirmed **no fund-safety issue**: covenant, transaction, re-announce, and recovery paths are byte-consistent with the proven native app; no `megammr` query anywhere.

## [0.5.0] — Stage 4: recovery Layer 5 (faded-beacon re-announce)

Keeps a pool discoverable to strangers' fresh nodes after its dust announce beacon prunes (~1 day).

- **Added** foreground re-announce (once per session, from My LP) — re-posts a fresh beacon for any of your funded pools whose beacon has faded.
- **Added** a **headless background re-announce** in the service worker (6-hour throttle, driven from `pp_ownpools`) so pools stay discoverable while the page is closed.
- **Fund-safe:** re-announce spends only a dust + fee from the wallet (the pool address is excluded from funding), signs `auto` only (no owner key, no covenant coin), and posts only past the `valid.scripts + validamounts + valid.mmrproofs` gate; the beacon identity key includes the payout address so a forged beacon can't suppress a real re-announce.
- Review fix: the background in-flight guard is set-on-fire, cleared-on-failure (retry next sweep), and cleared-on-beacon-reappear (so a later re-fade re-announces); posting is bounded to ≤ owned-pools per 6 h.

## [0.4.0] — Stage 3: recovery Layers 3/4 (backup / restore + guidance)

- **Added** "Back up my pools" — a portable JSON of each recipe plus a fresh `coinexport` (coin + MMR proof) of every reserve coin, offered as a copyable textarea + download link.
- **Added** "Restore" — paste or load a backup to re-track each covenant and re-import the coins on **any** node, even a fresh one where the pool aged out.
- **Added** a "How recovery works" guide (belt / braces / suspenders / string).
- The backup is **public data only** (addresses, public key, coin proofs) — no seed or private key — and its format is **byte-compatible with the native app**, so backups cross-restore.

## [0.3.0] — Stage 2: recovery Layers 1/2 (recipe persistence + re-track on launch)

- **Added** `pp_ownpools` — a durable, node-independent recipe for each owned pool (params + the authoritative covenant script), recorded on create/migrate, backfilled on discovery, and kept on close.
- **Added** re-track-on-launch: the background service re-registers only the covenants a node has actually lost (gated by a single `scripts` read, so a normal launch does zero writes); the page seeds its known-address set from recipes.
- **Fixed** (review, verified against the node's H2 engine): a covenant script is ~1300 characters, so the recipe `script` column must be `text` — `varchar(1024)` overflows and silently drops every recipe.

## [0.2.0] — Stage 1: Activity parity

- **Changed** All Pools from a swaps-only feed to a **full lifecycle feed** (Create / Swap / Add / Withdraw) with first-sighting reseed, a 2-scan close-grace, and no first-scan wipe.
- **Changed** My Activity is now **scoped to your PandaPools actions** — filtered to transactions that touch a known pool covenant address and moved your wallet (excludes plain sends, other dapps, and strangers' swaps on pools you track).
- **Added** a `kind` column to `pp_feed` via a probe-then-migrate.
- **Fixed** (review, verified on the live node): the node's `history` `details[]` carry no `txpowid` and are index-parallel to `txpows[]` (their inputs/outputs are token-sum maps, not coin arrays) — the difference is now associated by index, without which the personal on-chain history rendered nothing.

## [0.1.8] — Stage 0: background service + hygiene

- **Enabled** the background `service.js` (declared in `dapp.conf`) and made it the **sole global-feed ingester** — the page now only reads `pp_feed`, eliminating a page-vs-service double-count and the duplicated feed logic.
- **Housekeeping:** consistent version strings; `*.mds.zip` build artifacts are now gitignored (attached to releases instead of committed).

## [0.1.7] — Initial MiniDapp

First import of the PandaPools MiniDapp: the 0.5 % constant-product covenant, exact `decimal.js` math, water-filling router, trust-nothing discovery, all lifecycle transactions with the restricted-MDS pending-sign flow, the 5-tab UI, wallet balances, LP dashboard, and SQL persistence. Covenant address parity with the native app and MDS install were verified; the live dust-lifecycle test was the release gate.

---

[0.6.0]: ../../releases/tag/v0.6.0
[0.5.0]: ../../releases/tag/v0.5.0
[0.4.0]: ../../releases/tag/v0.4.0
[0.3.0]: ../../releases/tag/v0.3.0
[0.2.0]: ../../releases/tag/v0.2.0
[0.1.8]: ../../releases/tag/v0.1.8
[0.1.7]: ../../releases/tag/v0.1.7
