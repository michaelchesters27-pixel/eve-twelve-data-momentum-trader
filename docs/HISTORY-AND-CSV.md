# Flight recorder, audit and CSV exports

The data namespace remains `v220` so the existing history is preserved across the v2.50 deployment.

## Campaign-wide sequence

Every important event carries:

- `campaignId`
- `eventSequence`
- event time
- action
- side
- bullet number or ticket where relevant
- reason

This sequence allows the dashboard to reconstruct the exact order of ladder placement, pending-order actions, bullet entries, BE protection, exits, banking and campaign completion.

## Campaigns CSV

Campaign ID, anchor, start/end, duration, unique BUY and SELL bullet counts, maximum simultaneous positions, target mode, net result, peak, MAE, giveback, exit reason and counting method.

## Bullets CSV

Every unique bullet OPEN and CLOSE record with side, bullet number, position identifier, ticket, entry/exit price, initial SL, final SL, BE activation, time to BE, MFE, MAE, P/L, precise close reason and campaign exit context.

The expected SL labels are:

- `INITIAL STOP LOSS`
- `BE PROTECTED STOP - BULLET ONLY`

## BE Events CSV

Every halfway protection event with campaign, sequence, bullet, entry, new SL, progress, trigger and buffer.

## Ladders CSV

Every campaign anchor plus all 8 BUY STOP and 8 SELL STOP prices, spacing, lot, fallback, BE geometry and true build reason.

Normal build reasons include:

- `EA START - IMMEDIATE REARM`
- `CAMPAIGN COMPLETE - <reason>`
- `LADDER MISSING - REPAIR`
- `DASHBOARD REBUILD REQUEST`

`OPTIONAL M1 REFRESH` appears only when that input is deliberately enabled.

## Replay CSV

Timed broker snapshots containing bid, ask, spread, floating and peak P/L, live positions, pending orders, unique bullets fired, BUY/SELL bullet totals, newest bullet and the last event.

## Orders CSV

Every pending-order placement, rejection and cancellation with campaign ID, event sequence, role, side, ticket, volume, price and reason.

## Banking CSV

Every campaign close decision, including profit target, sentinel failure, hard protection or manual close.

## Market Telemetry CSV

Twelve Data and MT5 context used only for later analysis. It does not block ladder entries.

## Campaign audit

The server checks each completed campaign against its leg records:

- `CONSISTENT`: reported bullet total matches unique OPEN position identifiers and all expected CLOSE records are present.
- `SYNCING CLOSE RECORDS`: the total is correct but some close events are still arriving.
- `COUNT MISMATCH`: the campaign total differs from the unique OPEN bullet records.
- `NO BULLET RECORDS`: no usable bullet records exist for that campaign.

## Replay page

Selecting a campaign shows:

1. The exact event timeline ordered by `eventSequence` and time.
2. The price and basket P/L snapshots for the same campaign.

This lets one campaign be reviewed without guessing from disconnected CSV rows.

## v2.50 first-bullet quick-cut tracking

The protection export now also records `FIRST_BULLET_QUICK_CUT_ARMED`. Campaign and bullet close reasons distinguish `FIRST BULLET QUICK CUT STOP` from `FIRST BULLET QUICK CUT MARKET EXIT`. Campaign history records `FIRST BULLET QUICK CUT 0.750 ADVERSE - CLOSE FULL CAMPAIGN` when the rule ends a campaign.
