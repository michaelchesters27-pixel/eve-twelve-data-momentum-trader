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
  const breakout = Boolean(directionScore.metrics?.breakout);
  const breakoutDistanceAtr = finite(directionScore.metrics?.breakoutDistanceAtr, 0);
  const persistence = finite(directionScore.metrics?.persistence, 0);

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

  // v1.03: price speed can never substitute for a real directional break.
  if (!breakout) hardBlocks.push(`NO_CONFIRMED_${direction}_BREAKOUT`);
  if (breakout && breakoutDistanceAtr < config.breakoutMinAtr) {
    hardBlocks.push(`BREAKOUT_DISTANCE_${round(breakoutDistanceAtr, 4)}_ATR_BELOW_${config.breakoutMinAtr}`);
  }
  if (m1.regime === 'COMPRESSION') hardBlocks.push('COMPRESSION_WAIT_FOR_CLOSED_EXPANSION');
  if (m1.regime === 'HIGH_VOL_CHOP') hardBlocks.push('HIGH_VOLATILITY_CHOP');
  if (m1.regime === 'EXHAUSTION_RISK') hardBlocks.push('MOVE_EXHAUSTION_RISK');
  if (m1.extensionAtr > 2.4) hardBlocks.push(`MOVE_ALREADY_EXTENDED_${round(m1.extensionAtr, 2)}_ATR`);

  const closedBreakoutDirection = m1.breakout === 'UP' ? 'BUY' : m1.breakout === 'DOWN' ? 'SELL' : 'NONE';
  if (m1.regime === 'BREAKOUT' && m1.closedBreakoutConfirmed && closedBreakoutDirection !== 'NONE' && closedBreakoutDirection !== direction) {
    hardBlocks.push(`M1_CLOSED_BREAKOUT_AGAINST_${direction}`);
  }

  const oppositeHigher = [context?.m15?.direction, context?.h1?.direction]
    .filter(value => value && value !== 'NEUTRAL' && value !== direction).length;
  if (oppositeHigher === 2) hardBlocks.push(`M15_AND_H1_AGAINST_${direction}`);

  if (directionScore.score < config.initialQualityMin) reasons.push(`${direction}_QUALITY_${directionScore.score}_BELOW_${config.initialQualityMin}`);
  if (directionScore.score - oppositeScore.score < 8) reasons.push(`DIRECTION_EDGE_${round(directionScore.score - oppositeScore.score, 1)}_BELOW_8`);
  if (persistence < config.breakoutPersistenceMin) reasons.push(`POST_BREAKOUT_PERSISTENCE_${round(persistence, 3)}_BELOW_${config.breakoutPersistenceMin}`);
  if (finite(feature.efficiency) < config.breakoutEfficiencyMin) reasons.push(`POST_BREAKOUT_EFFICIENCY_${round(feature.efficiency, 3)}_BELOW_${config.breakoutEfficiencyMin}`);
  if (finite(feature.tickExpansion) < config.breakoutTickExpansionMin) reasons.push(`TICK_EXPANSION_${round(feature.tickExpansion, 3)}_BELOW_${config.breakoutTickExpansionMin}`);

  const eligible = hardBlocks.length === 0 && reasons.length === 0;
  const addAllowed = eligible && directionScore.score >= config.continuationQualityMin &&
    persistence >= Math.max(config.breakoutPersistenceMin + 0.04, 0.72) &&
    finite(feature.efficiency) >= Math.max(config.breakoutEfficiencyMin + 0.05, 0.53) &&
    finite(feature.tickExpansion) >= Math.max(config.breakoutTickExpansionMin + 0.10, 1.20) &&
    breakoutDistanceAtr >= Math.max(config.breakoutMinAtr * 1.5, 0.025);

  return {
    direction, eligible, addAllowed, quality: directionScore.score, oppositeQuality: oppositeScore.score,
    hardBlocks, reasons, feedDivergenceAtr: round(feedDivergenceAtr, 4),
    twelveTickAgeMs: wsAgeMs, twelvePriceFresh: wsFresh,
    breakoutConfirmed: breakout, breakoutDistanceAtr: round(breakoutDistanceAtr, 5),
    postBreakoutPersistence: round(persistence, 4),
    session: sessionForTimestamp(now, config.timezone)
  };
}

export function chooseAssessment(input) {
  const buy = assessDirection({ ...input, direction: 'BUY' });
  const sell = assessDirection({ ...input, direction: 'SELL' });
  const best = buy.quality >= sell.quality ? buy : sell;
  return { buy, sell, best };
}
