# Changelog

All notable changes to the PandaPools MiniDapp. Newest first. Each release is tagged and its `.mds.zip` is attached to the corresponding [GitHub Release](../../releases).

Versions `0.1.8` → `0.6.0` are a six-stage upgrade that brought the MiniDapp to **full feature parity with the native Android app (0.9.9)**. Every stage went through an implement → adversarial code-review → fix → re-review loop before release.

---

## [0.6.9] — Wallet: the full balance breakdown + a coin list (parity with native 0.9.20)

- **Fixed** the Wallet hiding the numbers that explain itself. `Locked (in pools)` and `Pending` were rendered only when non-zero and `confirmed` was never shown at all — so a node with everything committed to a pool read `Sendable 0` with nothing accounting for the rest. Every figure now shows unconditionally, zeros included, on one line: `confirmed X · locked ≈ Y · unconfirmed Z · N coins · updated Ns ago · tap for coins`.
- `locked` is still `confirmed − sendable` (`sendable` counts only simple-address coins; `confirmed` includes contract-locked ones — here, your pool reserves), now carrying `≈` because it is derived, not node-supplied. Full precision via `PP.tidy`, so the Wallet and My LP agree about the same coins.
- **Added** a **coin list** — tap any token card. Every coin the node holds for it, largest first, with its **full** coinid: no cap and no truncation, because an elided id can't be looked up. Tagged `(pool)` for covenant reserves (via the existing `Store.knownAddrsGet`) and `(beacon)` for registry dust at the sentinel, so the gap between confirmed and sendable is named rather than merely stated. Selectable, with a *copy all coins* action.
- The coin query is bounded and omits `simplestate`; on the node's over-256KB stub it retries sendable-only and **says the list is partial** rather than quietly showing a subset.
- Token amounts were already read correctly here (`tokenamount` for tokens, `amount` for `0x00`) — the native app's misread had no counterpart to fix.

## [0.6.8] — Pools tab: Individual | Combined view toggle

- **Added** a toggle on the Pools tab: keep the per-pool list (**Individual**) or fold every pool of a token into **one collective-pool card** (**Combined**) — summed reserves + aggregate spot price + pool count + tradeable depth.
- Display-only: reuses the router's own aggregation (`Router.byToken` + `Curve.totalMinima`/`aggregatePrice` + `Router.aggregateDepth`) — no new pool math, no covenant/txn change, engine files byte-identical.
- Senior code-review: ship — numbers exact (`totalToken = totalMinima × aggregatePrice`), XSS-safe, counts consistent (discovery is funded-only). Released 3-way with native **0.9.17** + desktop **0.16.2**.

## [0.6.7] — owner-key self-heal before Withdraw / Migrate / Close

- **Fixed** a restore-then-manage fund scare: `$OPK` is a `newaddress` key (index ≥ 64) that a seed-only restore re-derives **asynchronously**, so acting before it finished could sign against a key the node didn't yet hold (`Public Key not found`). Close/Migrate/Collect now regenerate the owner key (a no-op when already held) **before** signing.
- Glue/call-site only — `poolmgr.js` untouched, byte-identical to native/desktop. Parity with native **0.9.16** + desktop **0.8.3**.

## [0.6.6] — discovery reliability tuning (parity with native 0.9.15)

- **Fixed** a beacon-lapse **flicker** where a pool aged out of the tight sentinel window and vanished from non-owner nodes until the mesh re-announced it. Widened `SENTINEL_SCAN_DEPTH` **400 → 1500** (≈ a pool's whole ~20 h life).
- **Added** proactive re-announce (`REANNOUNCE_DEPTH/BLOCKS = 1000`) — re-post a beacon *before* it leaves the discovery window. **Hard invariant:** discovery_depth > reannounce_depth + confirm-lag (1500 vs 1000).
- **Changed** keep-fresh `REFRESH_BLOCKS` **1200 → 900** so reserves sit inside even a freshly-resynced node's short unpruned window.

## [0.6.5] — honest create-confirmation + copyable txpowid

- **Changed** a create shows **"Confirming…"** until its pool's covenant address actually holds **both** reserve legs on-chain (the durable signal), then latches **Confirmed**; a mined-then-reorged create is marked "Not confirmed — coins returned" instead of a misleading success.
- **Added** a copyable txpowid on post; keep-fresh now reads `pp_ownpools` + per-covenant coins instead of a full sentinel scan.

## [0.6.4] — bound the overflow-risk queries (parity with native 0.9.14)

- **Fixed** the unbounded node queries that let discovery/history degrade to empty on a busy node: both sentinel scans → `depth:400`, `history max:50 → max:4` (~160 KB, under the cap), and **track-on-discovery removed** so the `scripts` reply can't grow.
- Dropped the useless sentinel `coinnotify add` (+ one-time `remove`). Fund path (`poolmgr.js`) untouched.

## [0.6.3] — keep pools fresh in the cascade (parity with native 0.9.12)

- **Added** owner keep-fresh: every ~900 blocks (before the ~1700-block cascade edge) the owner recreates its pool's two reserve coins **in place** (grow-in-place, same amounts + fresh beacon, owner-signed = `deposit(0)`) → young coinids → back in the cascade so light nodes keep seeing + trading them.
- Decentralized (no server, no `megammr`); zero burn; covenant `GETOUTAMT GTE @AMOUNT` fail-closed. Wired as the service's sole feed authority.

## [0.6.2] — foolproof anchored MINIMA/USDT-only pool creation (native parity)

- **Changed** create to the native app's price-anchored, **USDT-only** flow: fresh MEXC MINIMA/USDT mid → live-USDT-pool spot → manual; enter-USDT-only (MINIMA derived = usdt ÷ price); manual free-ratio only for the first pool — prevents opening a mispriced pool.

## [0.6.1] — gossip discovery + withdraw-to-default + owner-key recovery (native parity)

- **Added** two-source discovery (own tracked pool contracts, GTC + never-pruned, merged with fresh sentinel beacons), a `parseok` gate so a non-compiling covenant can't masquerade as a live pool, and track-on-discovery.
- **Added** owner-key recovery on restore and withdraw-to-default-address, matching the native app's recovery model.

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
