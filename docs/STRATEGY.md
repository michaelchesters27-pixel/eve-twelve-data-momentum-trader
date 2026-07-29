# EVE Fixed Ladder Trader v2.10 strategy

## Campaign start

When the EA is flat and autonomous trading is enabled, it records the current MT5 midpoint as the campaign anchor and preloads a fixed ladder:

- BUY STOP levels: anchor + 3, +6, +9, +12, +15, +18, +21, +24
- SELL STOP levels: anchor - 3, -6, -9, -12, -15, -18, -21, -24

Every order is 0.01 lot and has a 2.000 fallback SL.

## Direction selection

Price chooses the direction. There is no predictive score or timeframe permission.

Both ladders remain active after the first bullet. This allows the opposite first-level order to hedge a sharp reversal. The campaign does not lock until one side reaches two filled bullets.

## Direction lock

When a side reaches bullet 2:

- that side becomes the locked campaign direction;
- all opposite pending orders are cancelled;
- any opposite open hedge is closed;
- remaining same-direction pending levels stay in place.

## Exit

The newest filled bullet on the locked side is the sentinel. Every bullet has its own 2.000 SL. If the sentinel SL is reached, all remaining positions and pending orders close.

Basket peak protection is also active after at least two bullets. Once the trigger is met, the basket closes if floating profit falls to 60% of its recorded peak, subject to commission reserve.

Hard basket loss, hard daily loss, emergency stop, terminal status and catastrophic spread remain the only operating protections.

## Rearm

After all positions and pending orders are flat, the EA records the campaign, resets, anchors a new ladder around the current MT5 price and rearms immediately.

## Twelve Data

Twelve Data records speed, acceleration, tick activity and timeframe context. It never grants or refuses an MT5 ladder order.
