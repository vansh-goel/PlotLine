# PlotLine contract

This Rust contract runs PlotLine’s shared daily 3D plot on NEAR testnet.

Each account receives a configurable number of free placements per day (initially one). Additional pieces spend banked credits purchased with NEAR; each shape costs its voxel footprint in credits. Credit purchases accrue to the treasury.

After finalization, edition sales split 90% to active builders by shape-credit weight and 10% to the treasury. The treasury may update the credit price, free daily placements, and price of future editions within hard bounds. Finalized days retain their edition price.

```bash
cargo test --lib
cargo near build
```

Credit purchases are non-refundable. Removing a piece refunds released storage but does not restore its free placement or spent credits.
