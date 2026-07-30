# EVE Fixed Ladder Flight Recorder v2.61 strategy

## Fixed campaign geometry

At campaign start the EA anchors one fixed ladder:

- 8 BUY STOPs above the anchor at 3.000 intervals.
- 8 SELL STOPs below the anchor at 3.000 intervals.
- 0.01 lot per order.
- Both sides stay in their original positions until the campaign finishes.

## Bullet risk

- Bullet 1: quick-cut at 0.750 adverse price movement.
- Bullet 2 onward: 2.000 initial fallback.
- Every bullet: after +1.500 favourable movement, tighten SL to entry plus the 0.150 cost buffer.
- A BE-protected stop closes only that bullet.
- A newest unprotected bullet failing before halfway closes the complete campaign and rearms.

## Profit target

Default target is ON at $5.00. Reaching it closes all positions and pending orders, banks the campaign and immediately rearms.

## Basket peak protection

Default: ON, activation $4.00, maximum giveback $1.00.

Once the basket's highest floating profit reaches $4.00, the moving floor equals highest peak minus $1.00. The floor can rise but never fall. Reaching the floor closes the complete campaign and rearms. Reaching $5.00 first banks the normal target.

Settings are snapshotted at campaign start. Dashboard changes apply only to the next campaign.

## Daily loss control

Dashboard-selectable ON/OFF, amount and reset. OFF cannot block a new ladder. ON blocks new ladders after realised P/L since reset reaches the selected negative amount.

## No entry filter

v2.61 retains the v2.50 baseline behaviour: no bias, session, timeframe, ATR, quality-score or cooldown gate. Twelve Data is telemetry only.
