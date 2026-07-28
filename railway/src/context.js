import { average, clamp, finite, median, round } from './utils.js';

export function normalizeBars(values = []) {
  return values
    .map(row => ({
      datetime: row.datetime,
      time: Date.parse(String(row.datetime).replace(' ', 'T') + (String(row.datetime).includes('Z') ? '' : 'Z')),
      open: finite(row.open, NaN),
      high: finite(row.high, NaN),
      low: finite(row.low, NaN),
      close: finite(row.close, NaN),
      volume: finite(row.volume, 0)
    }))
    .filter(row => [row.open, row.high, row.low, row.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
}

export function trueRanges(bars) {
  return bars.map((bar, index) => {
    const previousClose = index ? bars[index - 1].close : bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
}

export function atr(bars, period = 14) {
  const ranges = trueRanges(bars);
  return average(ranges.slice(-Math.max(2, period)));
}

export function ema(values, period) {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let result = values[0];
  for (let index = 1; index < values.length; index++) result = alpha * values[index] + (1 - alpha) * result;
  return result;
}

function slope(values, lookback = 8) {
  const sample = values.slice(-lookback);
  if (sample.length < 2) return 0;
  const n = sample.length;
  const xMean = (n - 1) / 2;
  const yMean = average(sample);
  let numerator = 0;
  let denominator = 0;
  sample.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

export function computeTimeframeContext(rawBars, interval) {
  const bars = normalizeBars(rawBars);
  if (bars.length < 25) return { ready: false, interval, bars: bars.length };
  const closes = bars.map(bar => bar.close);
  const ranges = trueRanges(bars);
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const atr14 = average(ranges.slice(-14));
  const priorAtr = average(ranges.slice(-42, -14)) || atr14;
  const atrExpansion = priorAtr > 0 ? atr14 / priorAtr : 1;
  const ema20 = ema(closes.slice(-80), 20);
  const ema50 = ema(closes.slice(-120), 50);
  const slope8 = slope(closes, 8);
  const trendRaw = atr14 > 0 ? ((latest.close - ema20) / atr14) * 0.55 + (slope8 / atr14) * 6 + ((ema20 - ema50) / atr14) * 0.25 : 0;
  const trendScore = clamp(trendRaw, -3, 3);
  const previous20 = bars.slice(-21, -1);
  const previousHigh = Math.max(...previous20.map(bar => bar.high));
  const previousLow = Math.min(...previous20.map(bar => bar.low));
  const breakout = latest.close > previousHigh ? 'UP' : latest.close < previousLow ? 'DOWN' : 'NONE';
  const breakoutDistanceAtr = atr14 > 0
    ? breakout === 'UP' ? (latest.close - previousHigh) / atr14 : breakout === 'DOWN' ? (previousLow - latest.close) / atr14 : 0
    : 0;
  const range = Math.max(latest.high - latest.low, Number.EPSILON);
  const body = latest.close - latest.open;
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const bodyFraction = Math.abs(body) / range;
  const closeLocation = (latest.close - latest.low) / range;
  const medianRecentRange = median(ranges.slice(-10));
  const medianBaseRange = median(ranges.slice(-60, -10)) || medianRecentRange;
  const compression = medianBaseRange > 0 ? medianRecentRange / medianBaseRange : 1;
  const priorRecentRange = median(ranges.slice(-11, -1));
  const priorBaseRange = median(ranges.slice(-61, -11)) || priorRecentRange;
  const priorCompression = priorBaseRange > 0 ? priorRecentRange / priorBaseRange : 1;
  const rangeExpansion = medianRecentRange > 0 ? range / medianRecentRange : 1;
  const extensionAtr = atr14 > 0 ? Math.abs(latest.close - ema20) / atr14 : 0;
  const directionalEfficiency = Math.abs(latest.close - bars.at(-8).close) / Math.max(ranges.slice(-8).reduce((sum, value) => sum + value, 0), Number.EPSILON);
  const closedBreakoutConfirmed = breakout !== 'NONE' && breakoutDistanceAtr >= 0.02 && bodyFraction >= 0.50 && rangeExpansion >= 1.05;
  const compressionRelease = priorCompression < 0.72 && closedBreakoutConfirmed && rangeExpansion >= 1.20;
  let regime = 'RANGE';
  if (compression < 0.68) regime = 'COMPRESSION';
  if (closedBreakoutConfirmed && atrExpansion > 1.02) regime = 'BREAKOUT';
  else if (Math.abs(trendScore) > 0.9 && directionalEfficiency > 0.42) regime = 'TREND';
  else if (atrExpansion > 1.45 && directionalEfficiency < 0.32) regime = 'HIGH_VOL_CHOP';
  if (extensionAtr > 2.2 && bodyFraction < 0.45) regime = 'EXHAUSTION_RISK';
  const direction = trendScore > 0.35 ? 'BUY' : trendScore < -0.35 ? 'SELL' : 'NEUTRAL';
  return {
    ready: true,
    interval,
    bars: bars.length,
    latestTime: latest.datetime,
    close: round(latest.close),
    atr: round(atr14),
    atrExpansion: round(atrExpansion, 4),
    trendScore: round(trendScore, 4),
    direction,
    breakout,
    breakoutDistanceAtr: round(breakoutDistanceAtr, 4),
    closedBreakoutConfirmed,
    compressionRelease,
    regime,
    compression: round(compression, 4),
    priorCompression: round(priorCompression, 4),
    rangeExpansion: round(rangeExpansion, 4),
    extensionAtr: round(extensionAtr, 4),
    directionalEfficiency: round(directionalEfficiency, 4),
    candle: {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      bodyAtr: atr14 > 0 ? round(body / atr14, 4) : 0,
      bodyFraction: round(bodyFraction, 4),
      upperWickFraction: round(upperWick / range, 4),
      lowerWickFraction: round(lowerWick / range, 4),
      closeLocation: round(closeLocation, 4),
      volume: latest.volume,
      volumeRatio: average(bars.slice(-20, -1).map(bar => bar.volume)) > 0
        ? round(latest.volume / average(bars.slice(-20, -1).map(bar => bar.volume)), 4)
        : null
    },
    previousClose: previous.close,
    previousHigh,
    previousLow
  };
}

export function combinedContext(contexts, symbol) {
  const symbolContexts = contexts[symbol] || {};
  const m1 = symbolContexts['1min'];
  const m5 = symbolContexts['5min'];
  const m15 = symbolContexts['15min'];
  const h1 = symbolContexts['1h'];
  const ready = Boolean(m1?.ready && m5?.ready && m15?.ready && h1?.ready);
  const directions = [m5, m15, h1].filter(Boolean).map(item => item.direction);
  const buyVotes = directions.filter(direction => direction === 'BUY').length;
  const sellVotes = directions.filter(direction => direction === 'SELL').length;
  return {
    ready,
    symbol,
    m1, m5, m15, h1,
    higherTimeframeDirection: buyVotes > sellVotes ? 'BUY' : sellVotes > buyVotes ? 'SELL' : 'NEUTRAL',
    alignmentVotes: { buy: buyVotes, sell: sellVotes },
    atr: m1?.atr || 0,
    regime: m1?.regime || 'UNKNOWN'
  };
}
