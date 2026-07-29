# EVE Fixed Ladder Flight Recorder v2.50

## First-bullet quick cut

Bullet 1 is the campaign proof trade. Once it opens, v2.50 immediately tightens its broker-side stop to **0.750 adverse price movement**. A live tick-level fallback also closes the campaign if the broker modification is delayed or rejected. When this quick cut fires, every remaining pending order is deleted and a completely fresh fixed ladder is armed immediately.

The rule is applied only while the campaign has exactly one fired bullet and one live position. Bullet 2 onward retains the existing **2.000 initial fallback**, while every bullet still moves to **BE + 0.150** after reaching **+1.500**.

This is a complete replacement for the existing GitHub repository. It keeps the same Railway service, domain, `BOT_TOKEN`, Twelve Data connection, Magic number and `v220` history namespace.

## Locked ladder

- 8 fixed BUY STOPs and 8 fixed SELL STOPs.
- Exact 3.000 XAUUSD spacing.
- Equal 0.01 lot on every order.
- Pending orders are placed with the existing 2.000 fallback. After Bullet 1 fills, v2.50 immediately tightens that live position to the 0.750 quick-cut stop. Bullet 2 onward keeps 2.000.
- Both original ladders remain fixed. They do not slide and the opposite ladder is not cancelled.
- No quality score, timeframe permission, session restriction or cooldown.
- Twelve Data remains telemetry only.

## Bullet protection

Bullet 1 has the extra quick-cut rule, while the BE rule still applies to every bullet:

1. Bullet 1 is tightened to a 0.750 adverse stop as soon as it opens.
2. Bullet 2 onward retains the original 2.000 fallback.
3. When any bullet moves +1.500 in profit, its SL moves to breakeven plus the 0.150 cost buffer.
4. If a protected BE stop is later hit, only that bullet closes.
5. Remaining live positions and the fixed pending ladder continue.
6. If the newest unprotected bullet hits its active risk stop, the complete campaign closes and rearms.

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

- `FIRST BULLET QUICK CUT STOP`
- `FIRST BULLET QUICK CUT MARKET EXIT`
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

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.50.mq5`
- EA version: 2.50
- Magic number: 2907202622
- Order prefix: EVEL250
- Railway package: 2.5.0
- Data namespace: v220

Never run v2.40 and v2.50 together. The retained Magic number allows v2.50 to recognise an existing v2.40 campaign during handover.
