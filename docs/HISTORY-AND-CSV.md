# History and CSV files

The Railway dashboard provides:

- **Scans CSV:** live Twelve Data and MT5 telemetry, engine state, positions, pending orders and the current event.
- **Signals CSV:** every scout, reversal and continuation bullet that actually fired.
- **Orders CSV:** every pending order placed, cancelled or rejected, including bracket/continuation role, price, fallback and spacing.
- **Legs CSV:** every individual position open and close.
- **Baskets CSV:** one row per completed campaign with bullets fired, maximum simultaneous lots, peak profit, MAE, giveback and exit reason.
- **Banking CSV:** every full-campaign closure decision, including newest-leg fallback, manual close and hard loss protection.
- **Events CSV:** Railway startup, controls and service events.

The default clean storage namespace is `v200`. Existing old v1.04 history is not mixed into the new statistics.

A Railway Volume mounted at `/data` is optional for operation but required if local JSONL history must survive Railway redeployments. Without a volume, the bot still trades and records during the current deployment, but Railway local history can reset after redeployment.
