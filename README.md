# EVE Fixed Ladder Flight Recorder v2.30

This package replaces the current GitHub repository contents while keeping the same Railway service, public domain, `BOT_TOKEN`, Twelve Data connection and existing `v220` campaign history.

Version 2.30 is an engineering and telemetry rebuild. The trading strategy is deliberately unchanged from v2.20 while the campaign accounting, heartbeat, exit labels and replay history are made consistent.

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
- In this observation build, if the newest protected bullet later hits its BE stop, every position and pending order is also closed.
- A fresh 8x8 ladder is built immediately after the campaign is flat.
- No quality score, breakout threshold, timeframe permission, session restriction or cooldown controls entries.
- Twelve Data is telemetry and historical context only. MT5 broker prices place and manage every order.

## Campaign profit target

The dashboard provides a selectable take-home target:

- OFF: let the campaign run under its natural sentinel rules.
- ON: choose $1, $3, $5, $7, $10, $16, $25 or enter any positive custom amount.

When total floating campaign profit reaches the chosen amount, MT5 closes every position, deletes every pending order, banks the result and immediately starts a new ladder.

## v2.30 accounting and telemetry rebuild

- A bullet is counted once using its unique MT5 `POSITION_IDENTIFIER`.
- Duplicate trade callbacks are ignored.
- BUY bullets fired, SELL bullets fired, unique bullets fired and live positions are reported separately.
- Campaign history audits the reported bullet total against unique OPEN leg records.
- Exit records distinguish `INITIAL STOP LOSS` from `BE PROTECTED STOP`.
- Every ladder, order, bullet, protection, banking and campaign event receives a campaign-wide event sequence.
- Campaign replay includes an exact ordered event timeline as well as price snapshots.
- Ladder rebuild records state the real reason instead of incorrectly reporting a new M1 candle.
- Heartbeat traffic has priority over queued telemetry and uses the `X-Bot-Token` header.
- The dashboard displays heartbeat sequence, heartbeat age, queue depth and last HTTP status.

## Flight recorder exports

The dashboard exports:

- Campaigns CSV
- Bullets CSV
- BE Events CSV
- Ladders CSV
- Replay CSV
- Orders CSV
- Banking CSV
- Market Telemetry CSV

Campaign history also shows an audit result:

- `CONSISTENT`
- `SYNCING CLOSE RECORDS`
- `COUNT MISMATCH`
- `NO BULLET RECORDS`

## Hard protection

- Maximum positions: 16
- Maximum total lots: 0.16
- Hard basket loss: $5 or 1% of balance, whichever is lower
- Hard daily loss: $20 or 4% of start-of-day balance, whichever is lower
- Hard spread limit: 150 broker points
- Hedging demo account required

## Identity

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.30.mq5`
- EA version: 2.30
- Magic number: 2907202622
- Order prefix: EVEL230
- Railway package: 2.3.0
- Data namespace: v220

The magic number and data namespace are retained intentionally so v2.30 can recover an existing v2.20 campaign and keep the existing dashboard history. Never run v2.20 and v2.30 together.
