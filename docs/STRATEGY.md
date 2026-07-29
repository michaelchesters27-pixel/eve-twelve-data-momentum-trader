# EVE Fixed Ladder Flight Recorder v2.30 strategy

Version 2.30 keeps the v2.20 trading behaviour unchanged while repairing campaign accounting and telemetry.

## Campaign start

When flat and autonomous trading is enabled, MT5 records its current midpoint as the anchor and preloads:

- BUY STOPs: anchor +3, +6, +9, +12, +15, +18, +21 and +24
- SELL STOPs: anchor -3, -6, -9, -12, -15, -18, -21 and -24

Every order is 0.01 lot and begins with a 2.000 broker-side SL.

## Fixed ladder

The ladder is built once and stays where it was placed. It does not slide with price. The opposite ladder is not cancelled. Price can therefore trigger BUY bullets, SELL bullets or both during the same campaign.

The optional `InpRefreshBracketEveryM1Candle` input remains OFF by default. Normal ladder rebuilding only occurs when the EA starts, a completed campaign rearms, the ladder is missing and needs repair, or the dashboard explicitly requests a rebuild.

## Halfway protection

Each bullet is tracked independently. When it reaches +1.500 price movement in its favour, its SL moves to:

- BUY: entry + 0.150
- SELL: entry - 0.150

This is breakeven plus a small cost buffer.

## Sentinel exit

The most recently filled bullet is the newest bullet and therefore the sentinel.

- If it fails before halfway and hits its original SL, close the entire campaign.
- In this observation build, if it reaches halfway, moves to BE and later hits that protected stop, close the entire campaign.

The EA cancels every remaining pending order, closes every remaining position and immediately builds a new fixed ladder.

## Campaign profit target

From the Railway dashboard:

- OFF allows natural sentinel management.
- ON banks the selected floating campaign profit and immediately rearms.

The selected amount can be $1, $3, $5, $7, $10, $16, $25 or a custom positive value.

## Counting method

A bullet is counted once by its unique MT5 `POSITION_IDENTIFIER`. Duplicate deal callbacks do not create extra bullets. Historical bullets fired and currently open positions are separate values.

## Twelve Data

Twelve Data records live speed, acceleration, tick activity and timeframe context. It never grants or refuses a ladder entry.
