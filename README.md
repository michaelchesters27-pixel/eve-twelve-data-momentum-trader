# EVE Twelve Data Momentum Trader v1.00

A new autonomous **XAUUSD demo trading system** built from the useful protection logic in EVE v4.21, with the losing entry engine replaced by a Twelve Data decision engine.

## What runs where

- **Railway:** Twelve Data WebSocket, M1/M5/M15/H1 context, regime classification, directional quality scoring, scan history and dashboard.
- **MT5:** executable Bid/Ask, broker spread, market scout entry, continuation stops, individual SL/TP, first-leg failure exit, newest-leg sentinel, basket lock and capital protection.

## Entry logic

The system does not trade because price is merely moving quickly.

Railway scores BUY and SELL independently from 0–100 using:

- 250 ms, 1 s, 3 s and 10 s price movement
- persistence and movement efficiency
- acceleration and WebSocket update expansion
- micro breakout quality
- current M1 candle body/wicks/close location
- M1 volatility regime and extension
- M5, M15 and H1 direction
- real IC Markets spread sent by MT5
- Twelve Data versus MT5 feed divergence

A first scout position requires the configured initial quality threshold (default 80), a directional lead, fresh data and no hard rejection.

Continuation legs require the stronger continuation threshold (default 88), stronger persistence/efficiency and supporting local MT5 momentum.

## Protection kept from v4.21

- First leg closes early if it moves 0.25 ATR against entry before leg 2.
- Every leg has its own broker SL and TP.
- The newest leg is the campaign sentinel.
- Basket peak-profit protection retains part of floating profit.
- Positive baskets can bank when high-quality opposite momentum appears.
- Daily loss and emergency basket loss controls remain active.

## History

Railway records:

- every intelligence scan and exact rejection reason
- every issued signal
- MT5 order events
- individual legs
- completed baskets
- banking decisions
- system events

All are downloadable as CSV from the dashboard.

## Safety

This is experimental trading software. It has not been proven profitable. Run on a hedging demo account at 0.01 lot until a meaningful forward-test sample is available.
