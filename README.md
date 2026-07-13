# PandaPools — MiniDapp

A **constant-product AMM (automated market maker)** for the [Minima](https://minima.global) blockchain, delivered as a web **MiniDapp** (runs inside a Minima node's MDS sandbox). Swap MINIMA against a token across aggregated micro-pools, provide liquidity, and earn the **0.5 % swap fee** — all trustlessly, on-chain, with no custodian, batcher, or off-chain infrastructure.

This is the **MiniDapp edition** of PandaPools. It is a faithful port of the native Android PandaPools app and — crucially — **shares the same mainnet registry and covenant**, so both apps discover and trade the **same live pools**. A pool created in the native app is swappable here and vice-versa.

> **Status:** feature-complete at **v0.6.0** (full parity with native app 0.9.9). The remaining pre-release step is a live dust-lifecycle + interop test on a synced, funded classic node — see [Release status](#release-status).

> ⚠️ **Development software — use at your own risk.** PandaPools is experimental, actively-developed software provided **AS IS**, without warranty of any kind. It builds and posts real on-chain transactions that move real funds; despite extensive testing and code review, bugs may exist. Test with small amounts first, keep your seed backed up, and only risk what you can afford to lose. Nothing here is financial advice. See the [MIT License](LICENSE).

---

## Contents

- [What it does](#what-it-does)
- [How the AMM works](#how-the-amm-works)
- [The five tabs](#the-five-tabs)
- [Pool recovery (5 layers)](#pool-recovery-5-layers)
- [Architecture & file map](#architecture--file-map)
- [Fund-safety design](#fund-safety-design)
- [Install & run](#install--run)
- [Build & release](#build--release)
- [Interoperability with the native app](#interoperability-with-the-native-app)
- [Permissions](#permissions)
- [Release status](#release-status)
- [Version history](#version-history)

---

## What it does

- **Swap** MINIMA ⇄ token. Trades are **routed across every pool for the pair** (water-filling by best marginal price) and settle in **one transaction** — all-or-nothing, no partial fills.
- **Provide liquidity** by creating a pool or adding to one. LPs earn the 0.5 % fee, which accrues *inside* the pool (the constant-product `K` grows) — there is **no LP token**; your share is your pool.
- **Track** your positions (fees earned, impermanent-loss vs. holding, pool health) and a **live feed of all pool activity** (creates / swaps / adds / withdrawals) across the network.
- **Recover** your pools on any node — even a freshly wiped one — via a layered backup/re-track/re-announce system (see [Pool recovery](#pool-recovery-5-layers)).

Everything is **pure Minima**: no Ethereum, no HTLC, no bridge, no comms crypto.

---

## How the AMM works

### Constant-product pools with a unique address each

A pool is simply **two reserve coins** (MINIMA + a token) sitting at a **covenant address**, plus a small **discovery beacon**. There is **no on-chain pool state** — the reserves *are* the two coin amounts. The covenant is a [KISS-VM](https://docs.minima.global) script whose parameters (`$OPK` owner pubkey, `$OADR` owner payout address, `$TOK` paired tokenid, `$KMIN` product floor) are **hardcoded literals**, so **every pool has a unique address = its script hash** (a "Variant U" / Cauldron-style design). Zero state means multi-pool routing in a single transaction just works.

The covenant enforces the classic invariant on every swap, keeping the 0.5 % fee in the pool:

```
(nx − fx)·(ny − fy)  ≥  MAX(x·y, KMIN)      with  fx,fy = 0.5% of the amount added to each leg
```

### The KMIN product floor (the important defense)

Because one coin carries exactly one tokenid, a pool is a **2-coin pair**, and KISS has no unforgeable cross-coin binding. A naive `nx·ny ≥ x·y` invariant is drainable: an attacker pairs a **dust token coin** sent to the pool address with the real MINIMA coin and anchors the product near zero. PandaPools defeats this with a **hardcoded product floor** `KMIN = SIGDIG(20, x0·y0)` baked in at creation. A forged-dust pairing must *restore the full creation product* to extract anything — strictly worse than an honest swap. Discovery also always treats the **largest coin per leg** as the reserve, so dust can never masquerade as the reserve.

### Exact math

All fund-critical arithmetic uses **[decimal.js](https://mikemcl.github.io/decimal.js/)** configured to reproduce Java `BigDecimal` exactly (`precision: 40`, `rounding: ROUND_DOWN`, no scientific notation). This matters because the covenant address is a hash of the script (including the canonicalized `KMIN`), and the on-chain invariant is checked with grain-floored amounts — the client must round **exactly** the way the VM does or a spend is rejected. Recreated reserves round **up** to the token grain (pool-favourable), proceeds/change round **down**, and the input is clamped to the token's decimal grain.

### Discovery — trust nothing

Pools are found from a **shared on-chain registry**: a dust "beacon" coin at the sentinel address `0x50414E4441504F4F4C53` (the hex of `"PANDAPOOLS"`) carrying the pool's params in state ports 0–5. Discovery **re-derives each pool's covenant address from its params and only surfaces it if the script compiles** (`parseok`) — a forged beacon can at worst point at a real-but-bad pool, which the reserve/price filters drop. Two sources are merged:

1. **GTC (good-till-cancelled):** this node's own tracked pool contracts (via `scripts`). A spendable contract never prunes, so your pools stay enumerable forever, independent of the beacon.
2. **Registry beacons:** other creators' pools (via `coins address:<sentinel>`).

Newly-seen pools are **`newscript trackall`-ed once** ("track-on-discovery") so they stay visible + swappable on this node forever.

---

## The five tabs

| Tab | What it shows / does |
|---|---|
| **Swap** | Auto-selects the deepest pair; live routed quote (rate, price impact, pools-routed, 0.50 % fee, exact receive); direction flip; MEXC market-vs-pool arbitrage hint (USDT pairs); one-tx routed swap. |
| **Pools** | Read-only list of every live pool: reserves, spot price, fees accrued (`K/KMIN − 1`), address, aggregate depth. |
| **My LP** | Your pools with value, **fees earned** (√K model), **impermanent loss vs holding**, **KMIN health bar**; Create / Add / Migrate / Close; **Back up / restore pools**. |
| **Wallet** | Per-token balances with icons + web-validation badges, sendable / locked-in-pools / pending split; copyable receive address. |
| **Activity** | **My Activity** — this device's create/swap/add/migrate/close with a live "Confirming n/3" lifecycle + your on-chain PandaPools history. **All Pools** — a live feed of *everyone's* pool activity (create / swap / add / withdraw), detected from reserve movement. |

---

## Pool recovery (5 layers)

Your ability to **close/withdraw** an owned pool must survive a node resync, a fresh install, or a new device. PandaPools layers redundancy — *belt, braces, suspenders, string* — plus a network-discoverability layer:

1. **Belt — recipe persistence.** A durable per-pool recipe (params + the authoritative covenant script) in `pp_ownpools`. Seed + recipe ⇒ always reclaimable (the covenant is `SIGNEDBY($OPK)`, and `$OPK` is seed-derived).
2. **Braces — re-track on launch.** The background service re-registers every owned covenant a node has lost (gated on already-tracked, so a normal launch does zero writes), so a re-synced node rediscovers your pools automatically.
3. **Suspenders — backup / restore.** "Back up my pools" writes a portable JSON (recipes + a fresh `coinexport` coin+proof of each reserve). "Restore" re-tracks and re-imports the coins on **any** node — even a brand-new one where the pool aged out. **The backup is public data only** (addresses, public key, coin proofs) — it holds *no seed or private key* and cannot move funds. The format is **byte-compatible with the native app**, so a backup made in either restores in the other.
4. **String — guidance.** A "How it works" guide covering the seed + archive-resync last resort.
5. **Network discoverability — re-announce.** When a pool's beacon prunes (~a day), a fresh beacon is re-posted (foreground once/session + a headless 6-hourly background sweep) so strangers' new nodes keep discovering it. Re-announce spends **only a dust + fee from your wallet** (the pool address is excluded from funding, and it signs `auto` only) — **never a covenant coin, never added spend authority.**

---

## Architecture & file map

Scaffolded from the Limit DEX MiniDapp; command strings are byte-identical to the native app's `node.cmd(...)` calls. Every module is a self-contained ES5 IIFE (no bundler, no npm).

| File | Role |
|---|---|
| `covenant.js` | The 0.5 % covenant template + address derivation, KMIN canonicalization, the SENTINEL, and `scriptArg` (a JSON-quote that does **not** escape `/` — see [Fund-safety](#fund-safety-design)). |
| `curve.js` | `VirtualCurve` — constant-product quoting with grain-correct, pool-favourable rounding; spot price, K, fee-growth, aggregate depth. |
| `router.js` | `PoolRouter` — 128-step water-filling split across all pools for a pair (N equal pools ≡ one deep pool); capped at 6 legs. |
| `book.js` | `PoolBook` — trust-nothing discovery (GTC + registry), re-derivation + parseok gate, largest-coin reserve read, track-on-discovery. |
| `poolmgr.js` | `PoolManager` / `PoolTxn` / `TxPost` — the fund-moving code: create / add / migrate / close / swap / **re-announce**, the `txncheck` gate, and the restricted-MDS pending-sign resume flow. |
| `store.js` | Local persistence via `MDS.sql`: `pp_lp` (LP baselines), `pp_activity` (lifecycle log), `pp_feed`+`pp_kv` (global feed, **read-only from the page**), `pp_ownpools` (recovery recipes), plus the known-address set for personal-activity scoping. |
| `service.js` | The **background worker** — the *sole* global-feed ingester, track-on-discovery, re-track-on-launch, and the background re-announce sweep. Runs headless whenever the node is up. Self-contained (the MDS service runtime injects only `MDS`, so the covenant, decimals, and helpers are inlined). |
| `index.html` | The 5-tab UI, discovery/render loop, recovery UI, and a 3-theme switcher. |
| `decimal.js` | Vendored exact-decimal library. |
| `build.sh` | Packages `PandaPools_<version>.mds.zip` (dapp.conf first, or MDS install silently fails; version-drift guard). |

**The page reads; the service writes.** The global feed (`pp_feed`) is written **only** by `service.js` (which runs on every new block, page open or not); the page only renders it. This avoids double-counting and keeps the feed logic in one place.

---

## Fund-safety design

Every fund-critical Minima gotcha this project has hit on-chain is guarded here:

- **`parseok` pre-flight.** No funds move to a covenant that doesn't compile — a non-parsing script's coins would be permanently unspendable.
- **`scriptArg` never escapes `/`.** `JSONObject.quote` turns `*5/1000` into `*5\/1000`, which makes the covenant unparseable and **permanently strands** any coins at that address. `covenant.js scriptArg` escapes only `"` and `\`.
- **`txncheck` gate.** A post happens **only** if `response.valid.scripts` (the covenant verdict — *not* the top-level `scripts` count) **and** `response.validamounts` **and** `response.valid.mmrproofs` are all true; otherwise the tx is deleted. Fails closed.
- **Token-grain quantization.** On-chain token amounts are floored to the token's decimals; recreated reserves round up, proceeds/change down, input clamped — or the swap is rejected.
- **Owner-coin funding exclusion.** Funding a swap/re-announce excludes the pool address (and each pool's `$OADR`) so `txnsign auto` can't accidentally sign with `$OPK` and trip the covenant's owner branch.
- **Owner branches force funds to `$OADR` or back to the pool** — even a compromised `$OPK` can't redirect a withdrawal to a third party.
- **KMIN floor** (see above) — the load-bearing defense against the dust-pairing drain.
- **No `megammr` queries.** The sentinel scan stays in the recent unpruned window (a `megammr:true` query over the whole beacon pile once overflowed the native app's IPC).

Every stage of the parity upgrade was adversarially code-reviewed before release; the reviews caught (and fixed) real bugs, including an H2 `varchar` overflow (covenant scripts are ~1300 chars → the recipe `script` column must be `text`) and a `history` response-shape mismatch. See [CHANGELOG.md](CHANGELOG.md).

---

## Install & run

Requires an **official Minima node with MDS** (v1.0.46+; MDS listens on `MINIMA_PORT + 2`, default `9003`).

**Via MiniHub:** open `https://<node>:9003`, upload `PandaPools_<version>.mds.zip` (grab it from the [Releases](../../releases) page).

**Via the terminal:**
```bash
mds action:install file:/path/to/PandaPools_0.6.0.mds.zip
```

Grant it **WRITE** access when prompted (needed to mint owner keys, sign, and run the background re-announce). On a read-restricted node it still works via a pending-sign approval flow, with an approval tap per action.

---

## Build & release

```bash
./build.sh          # → PandaPools_<version>.mds.zip
```

`build.sh` zips `dapp.conf` **first** (MDS requires it), then the sources, and refuses to overwrite an existing versioned artifact. **Bump the version in two places together** — `dapp.conf` `"version"` and the `PANDAPOOLS_VERSION` constant in `index.html` — the script's drift guard enforces it. Build artifacts (`*.mds.zip`) are gitignored; each release's zip is attached to its **GitHub Release**, not committed.

---

## Interoperability with the native app

This MiniDapp and the **native Android PandaPools app** run against the **same Minima mainnet**, the **same sentinel registry**, and the **same 0.5 % covenant** — the covenant address derivation is byte-identical across both (KISS-VM parity). So:

- Pools created in either app are discovered and swappable in the other.
- Backup files are cross-compatible: back up in the MiniDapp, restore in the native app, or vice-versa.
- LPs and takers on both platforms trade the same aggregated liquidity.

---

## Permissions

WRITE access is recommended (create/swap/close, background re-announce, owner-key minting). A read-only install can still browse pools and use the pending-sign flow for actions, but the headless background re-announce (which can't drive an interactive approval) needs WRITE.

---

## Release status

The code is feature-complete and every stage was code-reviewed. The final pre-store gate is a **live dust-lifecycle + interop test on a synced, funded classic node**: create → swap → add → migrate → close, back up → restore, confirm the background service runs headless and re-announces, and confirm the MiniDapp sees pools the native app created (and vice-versa). After that it ships to the `panda_dapps` MiniDapp store.

**Known limitation (tracked):** My Activity reads a bounded live `history` window each render rather than a persistent, adaptively-paged store — fine for recent activity; a persistent history DB (matching the native `HistoryDb`) is the planned hardening.

---

## Version history

See **[CHANGELOG.md](CHANGELOG.md)** and the [Releases](../../releases) page. In short: `v0.1.7` (initial MiniDapp) → `v0.6.0` (full parity with native 0.9.9), delivered over six review-gated stages (background-service feed authority, full-lifecycle Activity, and all five recovery layers).
