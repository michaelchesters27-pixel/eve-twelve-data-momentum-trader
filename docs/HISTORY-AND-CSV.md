# History and CSV files

The dashboard provides:

- **Scans CSV:** every Railway intelligence scan with BUY/SELL scores, regime, timeframe directions, live mechanics and exact rejection reason.
- **Signals CSV:** every trade decision issued to MT5.
- **Orders CSV:** market scout and continuation order requests, accepts, cancels and rejects.
- **Legs CSV:** every individual position open and close.
- **Baskets CSV:** one row per completed campaign, including peak profit, MAE, giveback and exit reason.
- **Banking CSV:** basket-lock, first-leg failure, sentinel and opposite-momentum decisions.
- **Events CSV:** service, controls and error history.

A Railway Volume mounted at `/data` is required for history to survive redeploys.
