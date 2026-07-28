# v2.00 strategy specification

## Flat state

At each new M1 candle, and immediately after a campaign closes, MT5 maintains:

- one BUY STOP above current Ask;
- one SELL STOP below current Bid;
- a broker-side fallback SL on both orders.

The bracket is refreshed while flat. There is no predictive score required before arming it.

## Bullet 1

The first triggered stop starts the campaign. The campaign locks:

- one fallback distance;
- one bullet spacing distance;
- one fixed lot size.

The opposite stop remains active after bullet 1.

## Before direction lock

A same-direction continuation stop and the opposite reversal stop are both maintained.

- If the same-direction continuation triggers first, it becomes bullet 2.
- If the opposite stop triggers first, the original-side position is closed and the campaign flips to the newly triggered side.

## Direction lock

When bullet 2 in the same direction is active:

- the opposite pending order is cancelled;
- the campaign direction is locked;
- further equal-size continuation bullets are placed at the fixed campaign spacing.

## Fallback rule

Every bullet receives the same campaign fallback distance. The latest active bullet is the sentinel.

When the newest bullet reaches its broker-side SL or fallback:

1. cancel every remaining pending order;
2. close every remaining campaign position;
3. record the basket, legs, orders, banking decision and signal history;
4. rearm a fresh two-sided bracket immediately.

## Hard protection only

Ordinary trading is not blocked by quality scoring. New bullets can be blocked only by:

- Auto disabled or EA paused;
- emergency stop;
- disconnected/disabled MT5 trading;
- broker spread above the catastrophic ceiling;
- maximum positions or maximum total lots reached;
- hard basket loss;
- daily loss ceiling.

## Twelve Data

Twelve Data records live speed, acceleration, tick expansion and completed timeframe context. These fields support review and later optimisation. They do not control entry permission in v2.00.
