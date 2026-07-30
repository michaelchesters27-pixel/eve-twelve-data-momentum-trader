# EVE Fixed Ladder Flight Recorder v2.61

This is the audit-driven replacement for v2.50. It keeps the same Railway service, domain, environment variables, Magic number and `v220` history namespace.

## One trading change

Basket peak protection is enabled by default for each new campaign:

- Profit target: **$5.00**
- Protection activation: **+$4.00 basket peak**
- Maximum giveback: **$1.00 from the highest basket peak**

Examples:

- Peak reaches $4.20: protected basket floor becomes $3.20.
- Peak rises to $4.80: floor rises to $3.80.
- Basket reaches $5.00 first: normal target banks the campaign.
- Basket falls to the moving floor first: close every live position and pending order, bank the protected amount and immediately rearm.

The protection values are copied into the campaign when that campaign starts. Dashboard changes apply to the next campaign and cannot alter a campaign already running.

## Audit and persistence fixes

- Profit-target, daily-loss and basket-protection controls are saved atomically in both a primary and backup settings file.
- MT5 also stores the latest controls locally and can restore them after a missing Railway settings file.
- Each campaign records the exact settings version and values it started with.
- Close-leg reports retain the correct campaign ID.
- Duplicate telemetry is de-duplicated by deterministic record IDs.
- Bullet totals are reconciled against unique OPEN position identifiers.
- Recorded basket peak can never be lower than realised campaign profit.
- Each confirmed ladder produces 16 deterministic order-placement records, even if individual order telemetry is delayed.
- Replay, campaigns, bullets, orders and banking records use the same campaign identity.

## Unchanged trading engine

- 8 fixed BUY STOPs and 8 fixed SELL STOPs.
- Exact 3.000 XAUUSD spacing.
- Equal 0.01 lots.
- Both original ladders stay fixed and active.
- Bullet 1 quick cut: 0.750 adverse price movement.
- Bullet 2 onward initial fallback: 2.000.
- Every bullet moves to BE + 0.150 after +1.500 favourable movement.
- A protected bullet hitting BE closes only that bullet.
- The newest unprotected bullet failing before halfway closes the complete campaign.
- Immediate rearm after a completed campaign.
- No quality score, session restriction, timeframe permission or cooldown.
- Twelve Data remains telemetry only.

## Dashboard controls

- Profit target ON/OFF and custom target.
- Basket peak protection ON/OFF, activation and maximum giveback.
- Daily loss ON/OFF, custom amount and manual reset.

Defaults for a fresh installation are target ON at $5.00, peak protection ON at $4.00 / $1.00, and daily loss OFF.

## Identity

- EA: `EVE_Twelve_Data_Fixed_Ladder_v2.61.mq5`
- EA version: 2.61
- Magic number: 2907202622
- Order prefix: EVEL261
- Railway package: 2.6.1
- Data namespace: v220

Never run v2.50 and v2.61 together. Deploy only when v2.50 has no live positions and no active campaign.
