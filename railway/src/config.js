import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}
function numEnv(name, fallback, min = -Infinity, max = Infinity) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function listEnv(name, fallback = []) {
  const raw = String(process.env[name] || '').trim();
  return raw ? raw.split(',').map(value => value.trim()).filter(Boolean) : fallback;
}

export const config = Object.freeze({
  version: '1.0.2',
  serviceName: 'EVE Twelve Data Momentum Trader',
  mode: 'AUTONOMOUS_DEMO_TRADER',
  port: numEnv('PORT', 3000, 1, 65535),
  botToken: String(process.env.BOT_TOKEN || 'CHANGE-ME').trim(),
  dashboardOrigin: String(process.env.DASHBOARD_ORIGIN || '*').trim(),
  dataDir: String(process.env.DATA_DIR || path.join(__dirname, '..', 'data')).trim(),
  // v1.02 intentionally starts a clean forward-test sample while leaving older files untouched.
  dataNamespace: String(process.env.DATA_NAMESPACE || 'v102').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'v102',
  timezone: String(process.env.TIMEZONE || 'Europe/London').trim(),
  autonomousAtStart: boolEnv('AUTO_ENABLED', true),
  twelveDataApiKey: String(process.env.TWELVE_DATA_API_KEY || '').trim(),
  primarySymbol: String(process.env.TWELVE_DATA_SYMBOL || 'XAU/USD').trim(),
  wsSymbols: listEnv('TWELVE_DATA_WS_SYMBOLS', []),
  initialQualityMin: numEnv('INITIAL_QUALITY_MIN', 80, 1, 100),
  continuationQualityMin: numEnv('CONTINUATION_QUALITY_MIN', 88, 1, 100),
  signalHoldMs: numEnv('SIGNAL_HOLD_MS', 650, 0, 10_000),
  breakoutConfirmMs: numEnv('BREAKOUT_CONFIRM_MS', 900, 250, 10_000),
  breakoutLookbackMs: numEnv('BREAKOUT_LOOKBACK_MS', 10_000, 3_000, 60_000),
  breakoutExcludeMs: numEnv('BREAKOUT_EXCLUDE_MS', 1_200, 300, 5_000),
  breakoutMinAtr: numEnv('BREAKOUT_MIN_ATR', 0.015, 0.001, 0.50),
  breakoutPersistenceMin: numEnv('BREAKOUT_PERSISTENCE_MIN', 0.68, 0.50, 0.98),
  breakoutEfficiencyMin: numEnv('BREAKOUT_EFFICIENCY_MIN', 0.48, 0.10, 0.95),
  breakoutTickExpansionMin: numEnv('BREAKOUT_TICK_EXPANSION_MIN', 1.10, 0.50, 5.00),
  signalTtlMs: numEnv('SIGNAL_TTL_MS', 12_000, 2_000, 120_000),
  signalCooldownMs: numEnv('SIGNAL_COOLDOWN_MS', 20_000, 0, 600_000),
  maxSpreadAtr: numEnv('MAX_SPREAD_ATR', 0.22, 0.01, 2),
  maxFeedDivergenceAtr: numEnv('MAX_FEED_DIVERGENCE_ATR', 0.45, 0.05, 5),
  scanLogSeconds: numEnv('SCAN_LOG_SECONDS', 5, 1, 60),
  mt5OfflineMs: numEnv('MT5_OFFLINE_MS', 15_000, 3_000, 300_000),
  wsStaleMs: numEnv('WS_STALE_MS', 8_000, 2_000, 60_000)
});

export function allWsSymbols() {
  const values = config.wsSymbols.length ? config.wsSymbols : [config.primarySymbol];
  return [...new Set(values.filter(Boolean))].slice(0, 8);
}
