# EVE Twelve Data Momentum Trader v1.04

A real autonomous XAUUSD **demo** trading system using Twelve Data on Railway for market intelligence and MT5 for execution and protection.

## v1.04 scanner warmup fix

This complete release fixes the live scanner remaining on `LIVE_FEATURE_ENGINE_WARMING`. It uses Railway receipt time for live features, records diagnostic scans while warming, and preserves the mandatory confirmed-breakout trade gate.

## What runs where

- **Railway:** Twelve Data WebSocket, completed M1/M5/M15/H1 candle context, breakout confirmation, quality scoring, history and dashboard.
- **MT5:** market scout, continuation stops, individual SL/TP, first-leg failure, newest-leg sentinel, basket lock and capital protection.

## Safety

Experimental software. It has not been proven profitable. Use a hedging demo account at 0.01 lot until a meaningful new v1.04 sample exists.
