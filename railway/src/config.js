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
  version: '2.3.0',
  serviceName: 'EVE Fixed Ladder Flight Recorder',
  mode: 'FIXED_LADDER_FLIGHT_RECORDER_DEMO',
  port: numEnv('PORT', 3000, 1, 65535),
  botToken: String(process.env.BOT_TOKEN || 'CHANGE-ME').trim(),
  dashboardOrigin: String(process.env.DASHBOARD_ORIGIN || '*').trim(),
  dataDir: String(process.env.DATA_DIR || path.join(__dirname, '..', 'data')).trim(),
  dataNamespace: String(process.env.BULLET_DATA_NAMESPACE || 'v220').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'v220',
  timezone: String(process.env.TIMEZONE || 'Europe/London').trim(),
  autonomousAtStart: boolEnv('AUTO_ENABLED', true),
  twelveDataApiKey: String(process.env.TWELVE_DATA_API_KEY || '').trim(),
  primarySymbol: String(process.env.TWELVE_DATA_SYMBOL || 'XAU/USD').trim(),
  wsSymbols: listEnv('TWELVE_DATA_WS_SYMBOLS', []),
  scanLogSeconds: numEnv('SCAN_LOG_SECONDS', 2, 1, 60),
  mt5OfflineMs: numEnv('MT5_OFFLINE_MS', 15_000, 3_000, 300_000),
  wsStaleMs: numEnv('WS_STALE_MS', 8_000, 2_000, 60_000),
  // Live feature settings are telemetry only. They never grant or refuse an MT5 trade.
  featureWarmMinTicks: numEnv('FEATURE_WARM_MIN_TICKS', 4, 3, 50),
  featureWarmMinHistoryMs: numEnv('FEATURE_WARM_MIN_HISTORY_MS', 1_500, 250, 30_000)
});

export function allWsSymbols() {
  const values = config.wsSymbols.length ? config.wsSymbols : [config.primarySymbol];
  return [...new Set(values.filter(Boolean))].slice(0, 8);
}
