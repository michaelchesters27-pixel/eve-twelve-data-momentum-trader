# EVE Twelve Data Momentum Trader v1.03

A real autonomous XAUUSD **demo** trading system using Twelve Data on Railway for market intelligence and MT5 for execution and protection.

## v1.03 complete corrected build

This is the complete corrected release of the confirmed-breakout rebuild. It includes the compile fix found in v1.02 and starts a clean v1.03 forward-test sample.

- A live directional microstructure breakout is now mandatory.
- Price must remain beyond the breakout reference while quality holds for at least 900 ms.
- Compression is a hard block until a closed M1 expansion has occurred.
- Post-breakout persistence, efficiency and tick expansion are mandatory.
- No-breakout scores are capped below the 80 entry threshold.
- Raw velocity and acceleration have less influence; confirmed breakout and follow-through have more influence.
- Continuation orders cannot be armed until the scout has moved at least 0.10 ATR in profit.
- Twelve Data REST calls are aligned to completed candle closes and the still-forming candle is excluded.
- v1.03 uses a separate `v103` history namespace, so its forward-test statistics start at zero without deleting v1.01 files.

## What runs where

- **Railway:** Twelve Data WebSocket, completed M1/M5/M15/H1 candle context, breakout confirmation, quality scoring, history and dashboard.
- **MT5:** market scout, continuation stops, individual SL/TP, first-leg failure, newest-leg sentinel, basket lock and capital protection.

## Safety

Experimental software. It has not been proven profitable. Use a hedging demo account at 0.01 lot until a meaningful new v1.03 sample exists.
