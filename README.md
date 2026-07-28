# EVE Bullet Storm Trader v2.00

A full replacement for the conservative confirmed-breakout engine.

This is an aggressive XAUUSD **demo** trading system. MT5 arms both directions around every new M1 candle. Price chooses the first bullet. If the move continues, equal-size bullets are added. Every bullet carries the same campaign fallback distance, and the newest bullet is the sentinel: when its fallback is hit, the entire remaining campaign is closed.

## What runs where

- **MT5:** two-sided M1 bracket, trade execution, equal-size bullet ladder, reversal before leg 2, direction lock after leg 2, broker-side stop loss on every bullet, newest-leg basket closure and hard capital protection.
- **Railway:** dashboard, controls, history, CSV exports and persistent service state.
- **Twelve Data:** live WebSocket speed/acceleration telemetry plus completed M1/M5/M15/H1 context for recording and later analysis. Twelve Data does **not** grant or refuse trades in v2.00.

## Core behaviour

1. While flat, place one BUY STOP and one SELL STOP around price.
2. The first triggered order starts the campaign.
3. Keep the opposite pending order alive until the second same-direction bullet activates.
4. If the opposite side triggers first, close the original side and flip the campaign.
5. Once leg 2 activates, cancel the opposite order and lock the direction.
6. Keep placing equal-size continuation bullets at the fixed campaign spacing.
7. Every bullet has the same fixed campaign fallback distance.
8. If the newest bullet hits its fallback, close all remaining bullets.
9. Rearm immediately and start again.

## Default hard protection

- Fixed lot per bullet: `0.01`
- Maximum open positions: `10`
- Maximum total lots: `0.10`
- Hard basket loss: tighter of `$5.00` or `1%` of balance
- Daily loss block: tighter of `$20.00` or `4%` of estimated day-start balance
- Catastrophic spread ceiling: `150` broker points
- No martingale and no lot multiplication

## Important

This is experimental software and has not been proven profitable. Use a **hedging demo account only**. MetaEditor is not available in this environment, so the MQ5 file must be compiled locally and must show `0 errors` before attachment.
