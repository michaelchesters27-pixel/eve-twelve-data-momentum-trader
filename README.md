# EVE Fixed Ladder Flight Recorder v2.20

This package completely replaces the current strategy while keeping the same GitHub repository, Railway service, public domain, BOT_TOKEN and Twelve Data connection.

## Locked trading behaviour

- One fixed ladder is built at the start of each campaign.
- 8 BUY STOP orders are placed above the anchor.
- 8 SELL STOP orders are placed below the anchor.
- Every level is exactly 3.000 XAUUSD price units apart.
- Every order uses the same 0.01 lot.
- Every position starts with the same 2.000 broker-side SL.
- The original BUY and SELL ladders remain fixed. They do not slide and the opposite ladder is not cancelled.
- Every bullet that reaches +1.500 price movement has its SL moved to breakeven plus a 0.150 cost buffer.
- The newest filled bullet is always the campaign sentinel.
- If the newest bullet hits its original SL before halfway, every position and pending order is closed.
- If the newest protected bullet later hits its BE stop, every position and pending order is also closed.
- A fresh 8x8 ladder is built immediately after the campaign is flat.
- No quality score, breakout threshold, timeframe permission, session restriction or cooldown controls entries.
- Twelve Data is telemetry and historical context only. MT5 broker prices place and manage every order.

## Campaign profit target

The dashboard has a selectable take-home target:

- OFF: natural sentinel mode.
- ON: choose $1, $3, $5, $7, $10, $16, $25 or enter any custom amount.

When total floating campaign profit reaches the chosen amount, MT5 closes every position, deletes every pending order, banks the result and immediately starts a new ladder.

## Flight recorder

The project records:

- every ladder anchor and all 16 pending prices;
- every order placement, cancellation and rejection;
- every bullet entry and exit;
- initial SL, final SL, BE activation and time to BE;
- bullet MFE and MAE;
- campaign peak, drawdown, giveback and exit reason;
- replay snapshots containing bid, ask, floating profit, positions and pending orders;
- Twelve Data speed, acceleration and timeframe telemetry.

The dashboard can replay a selected campaign and export Campaigns, Bullets, BE Events, Ladders, Replay, Orders, Banking and Market Telemetry CSV files.

## Hard protection

- Maximum positions: 16
- Maximum total lots: 0.16
- Hard basket loss: $5 or 1% of balance, whichever is lower
- Hard daily loss: $20 or 4% of start-of-day balance, whichever is lower
- Hard spread limit: 150 broker points
- Hedging demo account required

## Identity

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.20.mq5`
- EA version: 2.20
- Magic number: 2907202622
- Order prefix: EVEL220
- Railway package: 2.2.0
- Data namespace: v220
