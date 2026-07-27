# Strategy specification

## Core principle

The previous bot detected speed but did not reliably determine whether the movement deserved risk. This version separates market intelligence from broker execution.

## Railway intelligence gate

A trade is rejected when any hard block is active, including:

- Twelve Data context warming or stale
- MT5 heartbeat stale, disconnected or Algo Trading blocked
- broker spread too large relative to ATR
- Twelve Data and MT5 prices diverging beyond tolerance
- high-volatility chop
- exhaustion or excessive extension
- both M15 and H1 against the direction

If no hard block exists, the directional quality score must reach 80 and lead the opposite score by at least 8 points. The signal must hold for 650 ms.

## Scout and continuation

- First entry: immediate 0.01-lot market scout.
- Additional entries: pending continuation stop orders.
- Default maximum: 4 positions and 0.04 total lots.
- Additional legs require quality 88+, add permission from Railway and supporting MT5 tick momentum.

## Exit management

- Initial SL: 1.05 M1 ATR.
- Initial TP: 1.30 M1 ATR.
- First-leg failure: 0.25 ATR adverse movement before leg 2.
- Break-even: begins at 0.40 ATR.
- Trailing: begins at 0.65 ATR with 0.30 ATR distance.
- Newest-leg SL: closes remaining campaign.
- Basket lock: activates after a meaningful peak and protects 40% of the peak, after estimated commission reserve.
