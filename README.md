# EVE Fixed Ladder Trader v2.10

This package completely replaces the current GitHub/Railway strategy while keeping the same repository, Railway service, public domain, BOT_TOKEN and Twelve Data connection.

## Trading behaviour

- MT5 anchors one fixed ladder around the current broker price.
- 8 BUY STOP orders are placed above the anchor.
- 8 SELL STOP orders are placed below the anchor.
- Every level is exactly 3.000 XAUUSD price units apart.
- Every order uses the same 0.01 lot.
- Every position has the same 2.000 broker-side fallback SL.
- Both ladders stay active until one side reaches its second filled bullet.
- When bullet 2 fills in one direction, that direction locks, all opposite pending orders are cancelled, and any opposite open hedge is closed.
- The newest filled bullet on the locked side becomes the sentinel.
- If the newest bullet reaches its fixed fallback, the full basket closes.
- A basket profit floor activates after at least 2 bullets and protects 60% of the peak after the trigger is reached.
- After a campaign closes, a completely fresh 8x8 ladder is rebuilt immediately.
- No quality score, breakout threshold, M5/M15/H1 permission, session restriction or cooldown controls entries.
- Twelve Data remains connected for live telemetry, scan history and analysis only. MT5 broker prices place and manage orders.

## Default hard limits

- Maximum live positions: 10
- Maximum total lots: 0.10
- Hard basket loss: $5 or 1% of balance, whichever is lower
- Hard daily loss: $20 or 4% of start-of-day balance, whichever is lower
- Hard spread limit: 150 broker points
- Hedging demo account required

## Identity

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.10.mq5`
- Version: 2.10
- Magic number: 2907202621
- Order prefix: EVEL210
- Railway package: 2.1.0
- Data namespace: v210
