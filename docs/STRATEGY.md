# v1.02 strategy specification

## Mandatory eligibility gate

A scout can only be issued when all of the following are true:

- Twelve Data and MT5 are fresh and connected.
- Spread and feed divergence are inside limits.
- A live BUY or SELL break exists beyond an older 10-second reference window.
- Breakout distance is at least 0.015 M1 ATR.
- Post-breakout persistence is at least 0.68.
- Movement efficiency is at least 0.48.
- Tick expansion is at least 1.10.
- Quality is at least 80 and leads the opposite direction by at least 8.
- The complete eligibility state remains present for at least 900 ms.
- M1 is not in compression, high-volatility chop or exhaustion.
- M15 and H1 are not both against the direction.

No score can override a missing breakout.

## Compression

No entry is permitted while the latest completed M1 context is classified as COMPRESSION. Context is calculated only from completed candles. Once a candle closes outside prior structure with expansion, the regime can become BREAKOUT and live confirmation may then qualify.

## Continuation

Continuation still requires Railway quality 88+, strong follow-through and local MT5 momentum. In addition, the scout must first move at least 0.10 ATR in profit.

## Protection

First-leg failure, individual SL/TP, break-even, trailing, newest-leg sentinel, basket lock, daily loss and emergency loss controls are unchanged.
