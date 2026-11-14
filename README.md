# PlotLine

PlotLine is a shared 3D construction plot on NEAR testnet. Everyone builds on the same plot during a short demo epoch. When it closes, the finished build becomes a limited-time NFT edition, and 90% of edition revenue is distributed to builders by contribution weight.

> Testnet hackathon prototype. Do not use it with real funds or represent it as production financial infrastructure.

- Live app: <https://plot-line-peach.vercel.app>
- Contract: [`plotline-build.testnet`](https://testnet.nearblocks.io/address/plotline-build.testnet)
- Treasury: `plotline-treasury.testnet`

## Try it

1. Open the live app and connect a NEAR testnet wallet. You see today’s 3D plot, its real on-chain countdown, one free daily placement, and your banked credits.
2. Select a shape and color, point at an exposed surface, and place it. You see the snapped validity preview and the confirmed piece appear on the shared plot.
3. Buy build credits and place another piece. You see credits decrease by the selected shape’s footprint cost.
4. Open **Build chat**, sign a message, and share an idea or HTTPS image link. You see it appear in that day’s wallet-authenticated discussion.
5. After the five-minute demo epoch ends, the configured keeper finalizes the shared plot. Open **Archive** to see its 24-hour edition sale.
6. Select **Collect edition** and approve the 0.1 NEAR testnet purchase plus NFT storage. You see the edition under **Profile → Collected editions**.
7. After an edition sale funds the builder pool, open **Profile → Builder earnings** and withdraw. You see the claim disappear after the transfer succeeds.

Empty plots cannot be finalized and never produce editions.

## Economics

| Action | Cost | Destination |
| --- | ---: | --- |
| First placement per account per epoch | Gas and storage only | NEAR network / contract storage |
| Build credit | 0.01 NEAR | Treasury |
| 1×1, cylinder, slope, hook or rotor | 1 credit | Spent from builder balance |
| 1×2 | 2 credits | Spent from builder balance |
| 2×2 | 4 credits | Spent from builder balance |
| 2×4 | 8 credits | Spent from builder balance |
| Edition | 0.1 NEAR plus NFT storage | 90% builders / 10% treasury |

Unused attached storage deposits are refunded. Credit purchases are non-refundable. Removing a current-day piece refunds released storage but does not restore its free placement or spent credits.

Builder rewards use active shape-credit weight at finalization, not transaction count. A contribution worth eight credits receives eight times the edition share of a one-credit contribution. Claims are pull-based and use an O(1) accumulator.

The treasury can update the free-placement allowance, credit price, and price of future editions within contract bounds. The 90/10 edition split is fixed. Finalized editions retain their snapshotted price and sale deadline.

## Architecture

- `contract/`: Rust + near-sdk smart contract, placement validation, credit balances, NEP-171 editions, payouts and tests.
- `web/`: Next.js App Router, React Three Fiber scene, NEAR wallet calls, archive, leaderboard and profile.
- Upstash Redis: public display names and day-scoped chat only. Financial state, pieces, editions and payouts remain on-chain.
- `/api/edition/[day]`: chain-derived isometric SVG used as NFT media.
- `/api/cron/finalize`: secret-protected keeper endpoint that finalizes the latest ended, non-empty plot.

The contract is authoritative for plot bounds, support, overlap, palette, free placement, credit spending, finalization, collection windows and payouts. The browser mirrors placement validation only for immediate feedback.

## Local development

Prerequisites:

- Node.js 20+
- Rust toolchain from `contract/rust-toolchain.toml`
- [`cargo-near`](https://github.com/near/cargo-near)
- [`near-cli-rs`](https://near.cli.rs/)

```bash
git clone https://github.com/vansh-goel/PlotLine.git
cd PlotLine

cd contract
cargo test --lib
cargo near build non-reproducible-wasm

cd ../web
cp .env.example .env.local
npm install
npm test
npm run dev
```

Open <http://localhost:3000>.

Environment variable names:

```dotenv
NEXT_PUBLIC_CONTRACT_ID=plotline-build.testnet
NEXT_PUBLIC_NETWORK=testnet
KV_REST_API_URL=
KV_REST_API_TOKEN=
KV_REST_API_READ_ONLY_TOKEN=
KEEPER_ACCOUNT_ID=
KEEPER_PRIVATE_KEY=
CRON_SECRET=
```

Never commit `.env*`, private keys, Redis tokens or submission payloads. NEAR keys used by the CLI remain in the local OS keychain.

### Keeper automation

Each plot is created implicitly by its on-chain day number: `(block time - genesis) / epoch length`. Pieces are stored under that day, so there is no database job that creates a new blank plot. Finalization freezes the entire shared day, never one builder's individual work, and cannot happen before the epoch ends.

The protected keeper endpoint is triggered by the Vercel Schedule in `web/vercel.json`. Configure these values before enabling it:

- Vercel: `KEEPER_ACCOUNT_ID`, `KEEPER_PRIVATE_KEY`, `CRON_SECRET`

Use a separate funded testnet keeper account; do not use the treasury's full-access key. Only that configured account can call `finalize`; the treasury can rotate it with `update_keeper`. Vercel Schedules on Hobby run at most every 15 minutes and may have 1–15 minutes of jitter, so the route catches up to four recent non-empty plots per run.

## Contract deployment

Build and deploy code updates to the existing initialized testnet account:

```bash
cd contract
cargo near build non-reproducible-wasm
near contract deploy plotline-build.testnet \
  use-file target/near/contract.wasm \
  without-init-call \
  network-config testnet \
  sign-with-keychain send
```

Do **not** call `new` again on an initialized contract. The current demo uses five-minute epochs, a 24-hour edition window, a 32×24×32 plot, one free placement, 0.01 NEAR credits and 0.1 NEAR editions.

## NEAR integration

- NEP-171 NFT core, enumeration and metadata views
- NEP-297-style structured events for placement, removal, finalization, collection, credit purchases and withdrawals
- NEP-330 source metadata through `cargo-near`
- Storage-backed payable placement and minting with excess-deposit refunds
- Asynchronous pull payments with failure callbacks restoring claim state

This build does not claim a cross-chain Intents flow.

## Known limitations

- Testnet only. The five-minute epoch is demo configuration, not a production “day.”
- Per-account limits are Sybil-resistant only to the extent that extra accounts cost gas and storage.
- Vercel Hobby scheduling can be delayed by its jitter window. No public manual finalization path is exposed.
- Display names and chat are Web2 data in Upstash Redis. Chat supports external HTTPS image links, not file uploads, moderation or permanent archival.
- The edition SVG currently renders the first 100 pieces.
- Profile earnings discovery scans the latest 24 plots; a production version needs an indexed per-builder history.
- Hook and rotor parts are single-voxel decorative pieces. Rotation changes their orientation; they are not simulated mechanical joints.
- A production mainnet launch with real revenue requires a contract audit, governance for upgrades, operational monitoring and legal review.
- Blocking a website by geography would not prevent direct calls to the public contract.

## Libraries and generated code

The project uses Next.js, React, React Three Fiber, Drei, Three.js, `near-connect-hooks`, `@hot-labs/near-connect`, `near-api-js`, near-sdk, near-contract-standards, near-sandbox, Vitest, TypeScript, ESLint and Archivo Variable. The initial Rust structure came from official NEAR contract tooling. Generated boilerplate includes coding-agent-created implementation and documentation, reviewed through local tests. No third-party application template or brand assets are included.

The repository began at 2026-11-14 23:02:29 UTC, inside the hackathon build window; there is no pre-window codebase diff.

## License

MIT — see [LICENSE](LICENSE).
