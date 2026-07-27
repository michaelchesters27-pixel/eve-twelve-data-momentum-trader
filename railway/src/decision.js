import { config } from './config.js';
import { finite, round, sessionForTimestamp } from './utils.js';

export function assessDirection({ direction, score, feature, context, mt5, twelveStatus, now = Date.now() }) {
  const reasons = [];
  const hardBlocks = [];
  const directionScore = direction === 'BUY' ? score.buy : score.sell;
  const oppositeScore = direction === 'BUY' ? score.sell : score.buy;
  const m1 = context?.m1 || {};
  const wsTime = Date.parse(twelveStatus?.lastTickAt || '');
  const wsAgeMs = Number.isFinite(wsTime) ? Math.max(0, now - wsTime) : null;
  const wsFresh = wsAgeMs !== null && wsAgeMs <= config.wsStaleMs;
  if (!context?.ready) hardBlocks.push('TWELVE_DATA_CONTEXT_WARMING');
  if (!wsFresh) hardBlocks.push('TWELVE_DATA_PRICE_STALE');
  if (!mt5?.fresh) hardBlocks.push('MT5_OFFLINE_OR_STALE');
  if (!mt5?.algoAllowed) hardBlocks.push('MT5_ALGO_TRADING_BLOCKED');
  if (!mt5?.terminalConnected) hardBlocks.push('MT5_TERMINAL_DISCONNECTED');
  if (feature.spreadAtr > config.maxSpreadAtr) hardBlocks.push(`SPREAD_${round(feature.spreadAtr, 3)}_ATR_ABOVE_${config.maxSpreadAtr}`);
  const mt5Mid = mt5?.fresh ? (finite(mt5.bid) + finite(mt5.ask)) / 2 : 0;
  const executionAtr = Math.max(finite(mt5?.atrM1, 0), finite(context?.atr, 0), Number.EPSILON);
  const feedDivergenceAtr = mt5Mid > 0 ? Math.abs(feature.price - mt5Mid) / executionAtr : 0;
  if (feedDivergenceAtr > config.maxFeedDivergenceAtr) hardBlocks.push(`TWELVE_DATA_MT5_DIVERGENCE_${round(feedDivergenceAtr, 3)}_ATR`);
  if (m1.regime === 'HIGH_VOL_CHOP') hardBlocks.push('HIGH_VOLATILITY_CHOP');
  if (m1.regime === 'EXHAUSTION_RISK') hardBlocks.push('MOVE_EXHAUSTION_RISK');
  if (m1.extensionAtr > 2.4) hardBlocks.push(`MOVE_ALREADY_EXTENDED_${round(m1.extensionAtr, 2)}_ATR`);
  const oppositeHigher = [context?.m15?.direction, context?.h1?.direction].filter(value => value && value !== 'NEUTRAL' && value !== direction).length;
  if (oppositeHigher === 2) hardBlocks.push(`M15_AND_H1_AGAINST_${direction}`);
  if (directionScore.score < config.initialQualityMin) reasons.push(`${direction}_QUALITY_${directionScore.score}_BELOW_${config.initialQualityMin}`);
  if (directionScore.score - oppositeScore.score < 8) reasons.push(`DIRECTION_EDGE_${round(directionScore.score - oppositeScore.score, 1)}_BELOW_8`);
  if (!directionScore.metrics?.breakout && directionScore.components?.breakout < 4) reasons.push('BREAKOUT_QUALITY_LOW');
  if ((directionScore.metrics?.persistence || 0) < 0.62) reasons.push('MOMENTUM_PERSISTENCE_LOW');
  const eligible = hardBlocks.length === 0 && reasons.length === 0;
  const addAllowed = eligible && directionScore.score >= config.continuationQualityMin &&
    (directionScore.metrics?.persistence || 0) >= 0.68 && finite(feature.efficiency) >= 0.48 &&
    finite(feature.tickExpansion) >= 1.10;
  return {
    direction, eligible, addAllowed, quality: directionScore.score, oppositeQuality: oppositeScore.score,
    hardBlocks, reasons, feedDivergenceAtr: round(feedDivergenceAtr, 4),
    twelveTickAgeMs: wsAgeMs, twelvePriceFresh: wsFresh,
    session: sessionForTimestamp(now, config.timezone)
  };
}

export function chooseAssessment(input) {
  const buy = assessDirection({ ...input, direction: 'BUY' });
  const sell = assessDirection({ ...input, direction: 'SELL' });
  const best = buy.quality >= sell.quality ? buy : sell;
  return { buy, sell, best };
}
