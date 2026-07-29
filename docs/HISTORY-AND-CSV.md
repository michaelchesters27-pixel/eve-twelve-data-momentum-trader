# Flight recorder and CSV exports

The clean namespace is `v220`.

## Campaigns CSV

Campaign ID, anchor, start/end, duration, BUY and SELL bullet counts, target mode, net result, peak, MAE, giveback and exit reason.

## Bullets CSV

Every bullet open and close with side, bullet number, entry/exit price, initial SL, final SL, BE activation, time to BE, MFE, MAE, P/L and close reason.

## BE Events CSV

Every halfway protection event with campaign, bullet, entry, new SL, progress, trigger and buffer.

## Ladders CSV

Every campaign anchor plus all 8 BUY STOP and 8 SELL STOP prices, spacing, lot, fallback and BE geometry.

## Replay CSV

A timed sequence containing broker bid/ask, spread, basket floating/peak P/L, open positions, pending orders and newest bullet. The dashboard can load one campaign and replay its recorded timeline.

## Other exports

Orders, Banking, Market Telemetry, Signals, Events and MT5 heartbeat histories remain available.
