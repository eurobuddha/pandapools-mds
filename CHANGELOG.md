# Changelog

All notable changes to the PandaPools MiniDapp. Newest first. Each release is tagged and its `.mds.zip` is attached to the corresponding [GitHub Release](../../releases).

Versions `0.1.8` → `0.6.0` are a six-stage upgrade that brought the MiniDapp to **full feature parity with the native Android app (0.9.9)**. Every stage went through an implement → adversarial code-review → fix → re-review loop before release.

---

## [0.6.18] — stop the runaway owner-key hunt (bounded, remembered, provable)
- **Fixed** the owner-key hunt minting keys without limit (parity with native **0.9.24**). A backup restored from a different seed carries an `$OPK` this node can never derive, and every Withdraw/Migrate/Collect/restore re-burned up to 256 permanent wallet keys hunting it — there is no key-delete command. One foreign recipe also poisoned every Collect.
- **Added** a persistent **hunt ledger** (`pp_kv` "opkhunt"): a lifetime cap of 256 mints per (seed-fingerprint, owner key), charged per REAL mint only — a failed `newaddress` (read-restricted dapp, locked vault) never charges — and persisted per mint so interrupted hunts resume with only their remainder. Re-seeding re-opens the budget deliberately.
- **Added** `kidx` — the owner key's derivation index (`pp_kv` "opkidx", backup **format v3**) — captured free from `newaddress`'s `total` at create, stamped at backup, remembered on restore. Hunts become exact, and a wallet already past the index proves a foreign seed with **zero** mints. Values are hard-coerced (a malformed backup's `"kidx": null` must never brand a legitimate key foreign).
- Unreachable keys are **reported, never retried**: Withdraw/Migrate abort with "this pool's owner key belongs to a different seed", Collect proceeds and says how many pools were skipped, restore counts them in the status line.
- Hunts are **serialised**; hunt state loads via a single-flight, max-wins merge that only trusts confirmed reads (a transient SQL failure can't clobber the persisted ledger); a hard per-run mint backstop caps any single hunt at the deepest legitimate exact target.
- The rules are byte-mirrored with the desktop copy; the native `HuntBudget` JVM suite (21 tests) is the spec, plus 28 end-to-end mock-node simulations of this exact JS (foreign 256-then-0, interrupted resume, locked vault, failed reads, malformed kidx, store races).

## [0.6.17] — conservative history paging under the MDS reply cap

- **Fixed** a stale assumption in `history.js` that MDS history backfill could safely start at `max:64`. The local Minima production reference documents the same 256 KB reply-cap class for MDS command replies, and an oversized page can be returned as empty/failed data. The MiniDapp now starts at `max:4` — the earlier measured safe page size — and keeps the adaptive halve/retry/max:1 skip logic.
- **Fixed** the README/changelog wording that claimed `MDSCommandHandler` had no relevant size cap.

## [0.6.16] — token-metadata network hardening parity

- **Fixed** a native-parity security gap in the Wallet token icon path. Web-validation URLs were already blocked from loopback/LAN targets, but token icon URLs could still be passed directly to `<img src>`. The MiniDapp now rejects loopback, private, link-local, `.local`, and `.internal` HTTP(S) icon URLs before rendering them, matching the native `ImageLoader.isBlockedHost` intent and falling back to the deterministic identicon.

## [0.6.15] — documentation/header parity polish for the native 0.9.23 line

- **Fixed** stale MiniDapp metadata and documentation left over from the 0.6.0 parity milestone. The app is now documented as tracking native PandaPools **0.9.23**, not stopping at native 0.9.9.
- **Fixed** the static header fallback version in `index.html` so a slow or failed init does not briefly show `v0.6.0`.
- **Fixed** the README's obsolete "known limitation" claiming My Activity still used a bounded live history window. Since 0.6.10 it uses the permanent `pp_history` mirror and the per-pool statement reads that same mirror.
- **Fixed** stale discovery documentation/comments that still described removed track-on-discovery. The docs now match the native 0.9.14+ model: owned contracts are re-tracked, other creators' pools come from the bounded registry window and re-announce mesh.

## [0.6.14] — finish native 0.9.23 parity: MiniDapp-wide signing, shared coin locks, spendable coin tags

- **Added** the native 0.9.22 serial signing gate to the MiniDapp transaction path: only one build → sign → check → post chain is allowed to run at once. Because MDS runs the page and background service in separate JavaScript contexts, the lock is SQL-backed (`pp_signlock`) with a heartbeat so it is genuinely MiniDapp-wide.
- **Added** SQL-backed `pp_coinlocks`, the MDS equivalent of native `CoinLock`. Because the MDS page and background service run in separate JavaScript contexts, the reservation has to be shared through the MiniDapp database, not a local variable. UI swaps/LP actions and headless keep-fresh/re-announce now avoid selecting the same wallet funding coin.
- **Fixed** headless keep-fresh/re-announce funding to exclude both the pool covenant address and `$OADR`, matching native 0.9.22's owner-key self-signing guard.
- **Fixed** the Wallet coin detail list to mark each coin as `spendable` or `locked` from the node's own `sendable:true` set, matching native 0.9.21. Pool/beacon tags remain as the explanation layer.

## [0.6.11] — carry the owner key's signature count through backup and restore

- **Fixed** the last key-reuse path (parity with native 0.9.23). A pool's owner key is minted with `newaddress`, so a seed-only re-sync doesn't bring it back — only the 64 defaults are rebuilt. `ensureOwnerKeys` re-mints it correctly, but the node inserts **every** new key at `uses = 0`, so the next owner action re-signed leaves the pre-restore node had already spent. Signing one Winternitz leaf twice leaks its private key.
- **Added** `opkuses` + `atblock` to the backup (**format v2**): the owner key's real signature count and the height it was read at. On restore the target is `count + elapsed blocks ÷ 900 + slack` — every term measured or derived.
- Advanced by burning leaves (`sign` increments and persists `uses`), since no command sets a counter and the private key can't be fetched. **Works on any node** — no forked build, no new command.
- A pre-v2 backup, or a key the advance can't reach, is reported — never silently resumed at leaf 0.
- The arithmetic is verified case-by-case against the native Java implementation.

## [0.6.10] — persistent paged history (#67) + the per-pool statement

- **Added** `pp_history`: a permanent, txpowid-keyed mirror of the node's `history relevant:true`, the MiniDapp counterpart of the native app's `HistoryDb`. It accumulates and is never pruned — the node retains only a window, so once a transaction ages out of `history` this is the only remaining record of it. Closes deferred **#67**.
- **Fixed** the Activity tab's one-shot `history max:4`, which showed about four transactions and could back nothing. It now reads the mirror, which `history.js` fills in the background with adaptive paging (backfill once, then incremental until it meets a transaction it already holds).
- **Uses adaptive history paging.** The default page starts at `max:4`, then halves on failed pages and skips at `max:1` only if a single oversized txpow would otherwise stall the sync. Hosts that know their transport can safely carry larger replies may override via `MDS.historyPageMax`.
- **Added** the **per-pool statement** (My LP → Export statement): what you put in, your own trades, what is in the pool now, and the profit — as CSV, downloadable or copyable. Ported from native 0.9.19/0.9.20 and verified to reproduce its figures exactly.
- A routed swap is **split across the pools it actually touched**, measured as `Σ(outputs at pool) − Σ(inputs at pool)`, with the split checked against the wallet's own movement; a row that doesn't tie is flagged and excluded rather than mis-booked.
- Two labelled profit figures — **pool profit (vs holding)** (fees minus impermanent loss) and **change in market value** (which includes MINIMA's own price move). Nothing is estimated: where a value can't be obtained the file says so.

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
