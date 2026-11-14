# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, TypeScript, React Three Fiber, and a Rust NEAR smart contract on testnet.

## Users

People collaboratively building a shared voxel sculpture and collectors supporting the builders after each daily plot closes.

## Product Purpose

PlotLine gives everyone one shared 3D plot per day. Contributors place a limited number of pieces, the finished plot becomes a time-limited collectible edition, and sale proceeds reward the people who built it.

## Positioning

A collaborative 3D build whose finalized on-chain contribution record directly determines each builder's earnings.

## Operating Context

Users connect a NEAR wallet, place or remove supported pieces, watch the shared plot update, finalize an ended day, collect its edition, and withdraw builder earnings.

## Capabilities and Constraints

- Testnet-only hackathon build.
- A fixed shape catalog, palette, plot bounds, support rules, and daily per-account allowance are enforced by the contract.
- Ninety percent of each edition sale is split by active pieces at finalization; ten percent accrues to the configured treasury.
- Edition sales close after a fixed window.
- Per-account limits are not Sybil resistance.
- Cross-chain collection is a stretch feature and must remain an explicitly two-step, dry-quote demo unless a real flow is verified.

## Brand Commitments

- Product name: PlotLine.
- Do not use the protected toy-brick brand name anywhere.
- Do not copy another collaborative-canvas product's identity or a real construction set.
- Voice is direct, playful, and transparent about fees and limitations.

## Evidence on Hand

The Rust contract and its unit/Sandbox tests are in `contract/`. No testimonials, production usage, or mainnet claims exist and none may be fabricated.

## Product Principles

- Put the shared build before explanatory chrome.
- Make contribution, ownership, and payout state legible.
- Mirror contract validity rules in the placement experience.
- Keep financial claims exact and auditable.
- Preserve a complete mobile build loop.

## Accessibility & Inclusion

Keyboard-visible controls, reduced-motion support, sufficient contrast, and touch-sized primary actions are required.
