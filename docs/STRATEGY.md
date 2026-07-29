# EVE Fixed Ladder Flight Recorder v2.20 strategy

## Campaign start

When flat and autonomous trading is enabled, MT5 records its current midpoint as the anchor and preloads:

- BUY STOPs: anchor +3, +6, +9, +12, +15, +18, +21 and +24
- SELL STOPs: anchor -3, -6, -9, -12, -15, -18, -21 and -24

Every order is 0.01 lot and begins with a 2.000 broker-side SL.

## Fixed ladder

The ladder is built once and stays where it was placed. It does not slide with price. The opposite ladder is not cancelled. Price can therefore trigger BUY bullets, SELL bullets or both during the same campaign.

## Halfway protection

Each bullet is tracked independently. When it reaches +1.500 price movement in its favour, its SL moves to:

- BUY: entry + 0.150
- SELL: entry - 0.150

This is breakeven plus a small cost buffer.

## Sentinel exit

The most recently filled bullet is the newest bullet and therefore the sentinel.

- If it fails before halfway and hits its original SL, close the entire campaign.
- If it reached halfway, moved to BE and later hits that BE stop, close the entire campaign.

The EA cancels every remaining pending order, closes every remaining position and immediately builds a new fixed ladder.

## Campaign profit target

From the Railway dashboard:

- OFF allows natural sentinel management.
- ON banks the selected floating campaign profit and immediately rearms.

The selected amount can be $1, $3, $5, $7, $10, $16, $25 or a custom positive value.

## Twelve Data

Twelve Data records live speed, acceleration, tick activity and timeframe context. It never grants or refuses a ladder entry.
