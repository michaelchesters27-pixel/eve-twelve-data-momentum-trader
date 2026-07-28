import { config } from './config.js';
import { clamp, finite, round } from './utils.js';

function valueAtOrBefore(ticks, timestamp) {
  for (let index = ticks.length - 1; index >= 0; index--) if (ticks[index].timestamp <= timestamp) return ticks[index].price;
  return ticks[0]?.price ?? 0;
}
function changesInWindow(ticks, start) {
  const sample = ticks.filter(tick => tick.timestamp >= start);
  const changes = [];
  for (let index = 1; index < sample.length; index++) changes.push(sample[index].price - sample[index - 1].price);
  return changes;
}
function scaledPositive(value, threshold, maxPoints) {
  if (threshold <= 0 || value <= 0) return 0;
  return clamp(value / threshold, 0, 1.5) / 1.5 * maxPoints;
}

export class LiveFeatureEngine {
  constructor(maxAgeMs = 120_000) {
    this.maxAgeMs = maxAgeMs;
    this.series = new Map();
  }
  ingest(symbol, price, timestamp = Date.now()) {
    const numericPrice = finite(price, NaN);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;
    const ticks = this.series.get(symbol) || [];
    const last = ticks.at(-1);
    if (last && timestamp < last.timestamp - 2_000) return null;
    if (!last || timestamp !== last.timestamp || numericPrice !== last.price) ticks.push({ symbol, price: numericPrice, timestamp });
    const cutoff = timestamp - this.maxAgeMs;
    while (ticks.length && ticks[0].timestamp < cutoff) ticks.shift();
    this.series.set(symbol, ticks);
    return this.snapshot(symbol);
  }
  snapshot(symbol, context = null, mt5 = null) {
    const ticks = this.series.get(symbol) || [];
    if (ticks.length < 4) return { ready: false, symbol, tickCount: ticks.length, buy: emptyScore('BUY'), sell: emptyScore('SELL') };
    const latest = ticks.at(-1);
    const now = latest.timestamp;
    const price = latest.price;
    const atr = finite(context?.atr, 0);
    const delta = milliseconds => price - valueAtOrBefore(ticks, now - milliseconds);
    const d250 = delta(250), d1 = delta(1_000), d3 = delta(3_000), d10 = delta(10_000);
    const current3Count = ticks.filter(tick => tick.timestamp >= now - 3_000).length;
    const baselineTicks = ticks.filter(tick => tick.timestamp >= now - 33_000 && tick.timestamp < now - 3_000).length;
    const baselineRate3 = Math.max(1, baselineTicks / 10);
    const tickExpansion = current3Count / baselineRate3;
    const changes = changesInWindow(ticks, now - 3_000);
    const up = changes.filter(change => change > 0).length;
    const down = changes.filter(change => change < 0).length;
    const totalDirectional = up + down;
    const persistenceBuy = totalDirectional ? up / totalDirectional : 0.5;
    const persistenceSell = totalDirectional ? down / totalDirectional : 0.5;
    const path = changes.reduce((sum, change) => sum + Math.abs(change), 0);
    const efficiency = path > 0 ? Math.abs(d3) / path : 0;

    // Use an older frozen reference window. The most recent ticks are excluded so a
    // breakout can remain true long enough to be confirmed rather than disappearing
    // as soon as its own price becomes the rolling high/low.
    const referenceStart = now - config.breakoutLookbackMs;
    const referenceEnd = now - config.breakoutExcludeMs;
    const referenceWindow = ticks.filter(tick => tick.timestamp >= referenceStart && tick.timestamp <= referenceEnd);
    const microHigh = referenceWindow.length ? Math.max(...referenceWindow.map(tick => tick.price)) : price;
    const microLow = referenceWindow.length ? Math.min(...referenceWindow.map(tick => tick.price)) : price;
    const breakoutBuyDistance = Math.max(0, price - microHigh);
    const breakoutSellDistance = Math.max(0, microLow - price);
    const breakoutBuyDistanceAtr = atr > 0 ? breakoutBuyDistance / atr : 0;
    const breakoutSellDistanceAtr = atr > 0 ? breakoutSellDistance / atr : 0;
    const breakoutBuy = referenceWindow.length >= 3 && breakoutBuyDistanceAtr >= config.breakoutMinAtr;
    const breakoutSell = referenceWindow.length >= 3 && breakoutSellDistanceAtr >= config.breakoutMinAtr;

    const acceleration = Math.abs(d3) > 0 ? Math.abs(d1) / Math.max(Math.abs(d3) / 3, Number.EPSILON) : 0;
    const normalized = value => atr > 0 ? value / atr : 0;
    const spreadPrice = mt5?.fresh ? Math.max(0, finite(mt5.ask) - finite(mt5.bid)) : 0;
    const executionAtr = Math.max(finite(mt5?.atrM1, 0), atr, Number.EPSILON);
    const spreadAtr = spreadPrice / executionAtr;
    const base = {
      ready: Boolean(atr > 0 && ticks.length >= 8 && referenceWindow.length >= 3), symbol, timestamp: now, price, atr,
      delta250: d250, delta1: d1, delta3: d3, delta10: d10,
      velocity250Atr: normalized(d250), velocity1Atr: normalized(d1), velocity3Atr: normalized(d3), velocity10Atr: normalized(d10),
      tickExpansion, acceleration, persistenceBuy, persistenceSell, efficiency,
      microHigh, microLow, breakoutBuy, breakoutSell,
      breakoutBuyDistanceAtr, breakoutSellDistanceAtr,
      spreadPrice, spreadAtr, tickCount: ticks.length, referenceTickCount: referenceWindow.length
    };
    return { ...base, buy: scoreDirection('BUY', base, context), sell: scoreDirection('SELL', base, context) };
  }
  latestPrice(symbol) { return this.series.get(symbol)?.at(-1)?.price || null; }
  latestTimestamp(symbol) { return this.series.get(symbol)?.at(-1)?.timestamp || null; }
}

function emptyScore(direction) { return { direction, score: 0, components: {}, warnings: ['WARMING'] }; }

export function scoreDirection(direction, feature, context) {
  if (!feature?.ready || !context?.m1?.ready) return emptyScore(direction);
  const sign = direction === 'BUY' ? 1 : -1;
  const v1 = feature.velocity1Atr * sign;
  const v3 = feature.velocity3Atr * sign;
  const v10 = feature.velocity10Atr * sign;
  const persistence = direction === 'BUY' ? feature.persistenceBuy : feature.persistenceSell;
  const breakout = direction === 'BUY' ? feature.breakoutBuy : feature.breakoutSell;
  const breakoutDistanceAtr = direction === 'BUY' ? feature.breakoutBuyDistanceAtr : feature.breakoutSellDistanceAtr;
  const candle = context.m1.candle || {};
  const candleDirectional = finite(candle.bodyAtr) * sign;
  const closeQuality = direction === 'BUY' ? finite(candle.closeLocation) : 1 - finite(candle.closeLocation);
  const components = {
    velocity: v1 > 0 && v3 > 0 ? scaledPositive(v1, 0.040, 8) + scaledPositive(v3, 0.080, 6) : 0,
    persistence: clamp((persistence - 0.5) / 0.35, 0, 1) * 18,
    acceleration: clamp((feature.acceleration - 0.9) / 1.6, 0, 1) * 6,
    tickExpansion: clamp((feature.tickExpansion - 1) / 2.2, 0, 1) * 8,
    efficiency: clamp((feature.efficiency - 0.25) / 0.60, 0, 1) * 14,
    breakout: breakout ? clamp(breakoutDistanceAtr / 0.08, 0.25, 1) * 20 : 0,
    candleQuality: candleDirectional > 0 ? clamp(candleDirectional / 0.40, 0, 1) * 3 + clamp(closeQuality, 0, 1) * 3 : 0,
    m5Alignment: context.m5?.direction === direction ? 6 : context.m5?.direction === 'NEUTRAL' ? 2 : 0,
    m15Alignment: context.m15?.direction === direction ? 3 : context.m15?.direction === 'NEUTRAL' ? 1 : 0,
    h1Alignment: context.h1?.direction === direction ? 3 : context.h1?.direction === 'NEUTRAL' ? 1 : 0,
    executionQuality: clamp(1 - feature.spreadAtr / 0.30, 0, 1) * 2
  };
  let score = Object.values(components).reduce((sum, value) => sum + value, 0);
  const warnings = [];
  if (!breakout) {
    score = Math.min(score, 69);
    warnings.push('BREAKOUT_REQUIRED');
  }
  if (v1 <= 0 || v3 <= 0) { score *= 0.20; warnings.push('DIRECTION_NOT_PERSISTENT'); }
  if (context.m1.regime === 'COMPRESSION') { score = Math.min(score, 59); warnings.push('COMPRESSION_NOT_RELEASED'); }
  if (context.m1.regime === 'HIGH_VOL_CHOP') { score *= 0.68; warnings.push('HIGH_VOL_CHOP'); }
  if (context.m1.regime === 'EXHAUSTION_RISK') { score *= 0.62; warnings.push('EXHAUSTION_RISK'); }
  if (context.m1.extensionAtr > 2.2) { score *= 0.75; warnings.push('MOVE_ALREADY_EXTENDED'); }
  if (feature.spreadAtr > 0.50) { score *= 0.50; warnings.push('SPREAD_EXTREME'); }
  const oppositeVotes = [context.m15?.direction, context.h1?.direction].filter(value => value && value !== 'NEUTRAL' && value !== direction).length;
  if (oppositeVotes === 2) { score *= 0.70; warnings.push('M15_AND_H1_AGAINST'); }
  return {
    direction,
    score: round(clamp(score, 0, 100), 2),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value, 2)])),
    warnings,
    metrics: {
      v1: round(v1, 5), v3: round(v3, 5), v10: round(v10, 5),
      persistence: round(persistence, 4), breakout,
      breakoutDistanceAtr: round(breakoutDistanceAtr, 5),
      efficiency: round(feature.efficiency, 4), tickExpansion: round(feature.tickExpansion, 4)
    }
  };
}
