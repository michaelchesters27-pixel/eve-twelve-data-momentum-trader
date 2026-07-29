# EVE Fixed Ladder Flight Recorder v2.40

This is a complete replacement for the existing GitHub repository. It keeps the same Railway service, domain, `BOT_TOKEN`, Twelve Data connection, Magic number and `v220` history namespace.

## Locked ladder

- 8 fixed BUY STOPs and 8 fixed SELL STOPs.
- Exact 3.000 XAUUSD spacing.
- Equal 0.01 lot on every order.
- Every position begins with a 2.000 broker-side SL.
- Both original ladders remain fixed. They do not slide and the opposite ladder is not cancelled.
- No quality score, timeframe permission, session restriction or cooldown.
- Twelve Data remains telemetry only.

## Bullet protection from Bullet 1 onward

Every individual bullet uses the same rule, including Position/Bullet 1:

1. The bullet opens with its original 2.000 SL.
2. When it moves +1.500 in profit, its SL moves to breakeven plus the 0.150 cost buffer.
3. If a protected BE stop is later hit, only that bullet closes.
4. Remaining live positions and the fixed pending ladder continue.
5. If the newest bullet fails before reaching +1.500 and hits its original SL, the complete campaign closes and rearms.

When a protected Bullet 1 is the only live position and it closes at BE, the campaign is naturally flat, so the old pending ladder is cleared and a fresh ladder is built.

## Campaign profit take-home

The dashboard supports OFF, $1, $2, $3, $5, $7, $10, $16, $25 and any positive custom amount.

When the basket reaches the chosen floating-profit target, all positions and pending orders close, the profit is banked and a fresh ladder is built immediately.

## Daily loss control

The dashboard now provides:

- Daily loss limit ON/OFF.
- $5, $10, $20, $30 and $50 presets.
- Any positive custom dollar amount.
- `Reset daily loss now`.
- Live P/L since the latest reset.
- Remaining loss allowance.
- Locked/unlocked status and reset time.

OFF means the daily loss rule cannot block new ladders. ON blocks new ladders once realised P/L since the latest reset reaches the chosen negative amount. Resetting clears the counter from that moment and permits immediate rearming. The counter also starts fresh at the next broker day.

## Flight recorder

The existing campaign, bullet, protection, ladder, replay, order, banking and market-telemetry exports remain. Exit labels now distinguish:

- `INITIAL STOP LOSS`
- `BE PROTECTED STOP - BULLET ONLY`
- `NEWEST BULLET FAILED BEFORE HALFWAY - CLOSE FULL CAMPAIGN`
- profit-target and manual/hard-protection exits

## Hard protection retained

- Maximum positions: 16.
- Maximum total lots: 0.16.
- Hard basket loss: $5 or 1% of balance, whichever is lower.
- Hard spread limit: 150 broker points.
- Hedging demo account required.

The separate daily loss lock is dashboard-controlled and defaults to OFF in this research build.

## Identity

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.40.mq5`
- EA version: 2.40
- Magic number: 2907202622
- Order prefix: EVEL240
- Railway package: 2.4.0
- Data namespace: v220

Never run v2.30 and v2.40 together. The retained Magic number allows v2.40 to recognise an existing v2.30 campaign during handover.
