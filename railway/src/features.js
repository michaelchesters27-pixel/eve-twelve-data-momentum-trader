import { config } from './config.js';
import { finite, round } from './utils.js';

function valueAtOrBefore(ticks, timestamp) {
  for (let index = ticks.length - 1; index >= 0; index--) {
    if (ticks[index].timestamp <= timestamp) return ticks[index].price;
  }
  return ticks[0]?.price ?? 0;
}

function changesInWindow(ticks, start) {
  const sample = ticks.filter(tick => tick.timestamp >= start);
  const changes = [];
  for (let index = 1; index < sample.length; index++) changes.push(sample[index].price - sample[index - 1].price);
  return changes;
}

function warmSnapshot(symbol, ticks, atr, reasons = []) {
  const latest = ticks.at(-1);
  const historySpanMs = ticks.length > 1 ? Math.max(0, latest.timestamp - ticks[0].timestamp) : 0;
  return {
    ready: false,
    symbol,
    timestamp: latest?.timestamp || null,
    price: latest?.price || 0,
    atr,
    tickCount: ticks.length,
    historySpanMs,
    warmupReasons: reasons,
    velocity250Atr: 0,
    velocity1Atr: 0,
    velocity3Atr: 0,
    velocity10Atr: 0,
    tickExpansion: 0,
    acceleration: 0,
    persistenceBuy: 0.5,
    persistenceSell: 0.5,
    efficiency: 0,
    liveDirection: 'MIXED'
  };
}

export class LiveFeatureEngine {
  constructor(maxAgeMs = 120_000) {
    this.maxAgeMs = maxAgeMs;
    this.series = new Map();
  }

  ingest(symbol, price, timestamp = Date.now()) {
    const numericPrice = finite(price, NaN);
    const numericTimestamp = finite(timestamp, Date.now());
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;

    const ticks = this.series.get(symbol) || [];
    const last = ticks.at(-1);
    if (last && numericTimestamp < last.timestamp - 2_000) return null;

    // Use Railway receipt order. Repeated prices and provider timestamps are retained
    // because tick arrival rate is useful telemetry for the aggressive MT5 engine.
    const safeTimestamp = last ? Math.max(numericTimestamp, last.timestamp + 1) : numericTimestamp;
    ticks.push({ symbol, price: numericPrice, timestamp: safeTimestamp });

    const cutoff = safeTimestamp - this.maxAgeMs;
    while (ticks.length && ticks[0].timestamp < cutoff) ticks.shift();
    this.series.set(symbol, ticks);
    return this.snapshot(symbol);
  }

  snapshot(symbol, context = null, mt5 = null) {
    const ticks = this.series.get(symbol) || [];
    const atr = Math.max(finite(context?.atr, 0), finite(mt5?.atrM1, 0));
    if (!ticks.length) return warmSnapshot(symbol, ticks, atr, ['WAITING_FOR_FIRST_TICK']);

    const latest = ticks.at(-1);
    const now = latest.timestamp;
    const price = latest.price;
    const historySpanMs = ticks.length > 1 ? Math.max(0, now - ticks[0].timestamp) : 0;
    const warmupReasons = [];
    if (ticks.length < config.featureWarmMinTicks) warmupReasons.push(`TICKS_${ticks.length}_OF_${config.featureWarmMinTicks}`);
    if (historySpanMs < config.featureWarmMinHistoryMs) warmupReasons.push(`HISTORY_${historySpanMs}MS_OF_${config.featureWarmMinHistoryMs}MS`);

    const delta = milliseconds => price - valueAtOrBefore(ticks, now - milliseconds);
    const d250 = delta(250);
    const d1 = delta(1_000);
    const d3 = delta(3_000);
    const d10 = delta(10_000);

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
    const acceleration = Math.abs(d3) > 0 ? Math.abs(d1) / Math.max(Math.abs(d3) / 3, Number.EPSILON) : 0;
    const normalized = value => atr > 0 ? value / atr : 0;
    const velocity1Atr = normalized(d1);
    const velocity3Atr = normalized(d3);
    const liveDirection = velocity1Atr > 0.01 && velocity3Atr > 0
      ? 'UP'
      : velocity1Atr < -0.01 && velocity3Atr < 0
        ? 'DOWN'
        : 'MIXED';

    return {
      ready: warmupReasons.length === 0,
      symbol,
      timestamp: now,
      price,
      atr,
      delta250: d250,
      delta1: d1,
      delta3: d3,
      delta10: d10,
      velocity250Atr: normalized(d250),
      velocity1Atr,
      velocity3Atr,
      velocity10Atr: normalized(d10),
      tickExpansion,
      acceleration,
      persistenceBuy,
      persistenceSell,
      efficiency,
      liveDirection,
      tickCount: ticks.length,
      historySpanMs,
      warmupReasons,
      note: 'Telemetry only. MT5 bullet geometry controls every entry.'
    };
  }

  latestPrice(symbol) { return this.series.get(symbol)?.at(-1)?.price || null; }
  latestTimestamp(symbol) { return this.series.get(symbol)?.at(-1)?.timestamp || null; }
}

export function roundedTelemetry(feature) {
  return {
    velocity1Atr: round(finite(feature?.velocity1Atr), 5),
    velocity3Atr: round(finite(feature?.velocity3Atr), 5),
    velocity10Atr: round(finite(feature?.velocity10Atr), 5),
    tickExpansion: round(finite(feature?.tickExpansion), 3),
    acceleration: round(finite(feature?.acceleration), 3),
    efficiency: round(finite(feature?.efficiency), 3)
  };
}
