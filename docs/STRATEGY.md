# v2.50 strategy rules

- Bullet 1 quick-cut: 0.750 adverse price movement, then close the campaign and rearm.
- Bullet 2 onward: existing 2.000 initial fallback.
- Every bullet: at +1.500 move SL to BE + 0.150.
- A BE-protected stop closes only that bullet.
- 8 BUY STOPs and 8 SELL STOPs remain fixed at campaign start with 3.000 spacing and 0.01 lots.
- Profit target and daily loss controls remain dashboard-selectable.

# EVE Fixed Ladder Flight Recorder v2.50 strategy

## Campaign start

When flat and autonomous trading is enabled, the EA records the current midpoint as the anchor and places:

- BUY STOPs at anchor +3, +6, +9, +12, +15, +18, +21 and +24.
- SELL STOPs at anchor -3, -6, -9, -12, -15, -18, -21 and -24.

Every pending order is 0.01 lot and starts with a 2.000 broker-side SL.

## Fixed geometry

The ladder is built once and stays where it was placed. It does not slide with price. The opposite ladder stays active. A new ladder is built only after a campaign finishes, when a missing ladder is repaired, at EA startup or after a dashboard rebuild request.

## Every bullet earns its own protection

Bullet 1, Bullet 2 and every later bullet are treated identically.

At +1.500 favourable price movement:

- BUY SL moves to entry +0.150.
- SELL SL moves to entry -0.150.

The SL only tightens; it never widens.

## Exit hierarchy

- Newest bullet hits its original SL before +1.500: close the complete campaign, delete pending orders and rearm.
- A bullet has already reached +1.500 and its BE-protected SL is hit: close that bullet only.
- If other positions remain, the campaign continues and the newest remaining live position becomes the sentinel.
- If no positions remain, clear the old pending ladder, finish the campaign and rearm.
- Profit target reached: close everything, bank and rearm.
- Hard basket protection/manual/emergency exit: close everything and rearm or remain stopped as appropriate.

## Daily loss control

The Railway dashboard controls the daily loss rule:

- OFF: no daily loss block.
- ON: stop placing new ladders once realised P/L since the latest reset reaches the selected negative dollar amount.
- Reset now: start the daily P/L counter again from the moment MT5 receives the updated setting and permit immediate rearming.

The current campaign remains protected. The daily loss rule controls new ladder creation rather than abandoning an open position without its normal exit handling.

## Twelve Data

Twelve Data records live speed, acceleration, tick activity and timeframe context for later review. It never grants or refuses an entry.
