import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { combinedContext } from './context.js';
import { LiveFeatureEngine } from './features.js';
import { JsonlStore } from './storage.js';
import { finite, integer, nowIso, round, sessionForTimestamp, toCsv } from './utils.js';
import { TwelveDataClient } from './twelve-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const store = new JsonlStore(config.dataDir, config.dataNamespace);
const features = new LiveFeatureEngine();
const contexts = {};

let twelveStatus = { ws: 'WARMING', rest: 'WARMING', lastTickAt: null, lastMarketTickAt: null, lastRestAt: null, lastError: null };
let latestFeature = null;
let lastScanLoggedAt = 0;
let mt5 = {
  account: null, symbol: null, bid: 0, ask: 0, spreadPoints: 0, atrM1: 0,
  terminalConnected: false, algoAllowed: false, autonomous: false,
  positionCount: 0, pendingCount: 0, side: 'NONE', lastSeenAt: null,
  engineState: 'WAITING FOR MT5', directionLocked: false, directionLegs: 0,
  lastEvent: 'Waiting for MT5 EA'
};
let control = { autonomous: config.autonomousAtStart, emergency: false };
let command = { id: 0, action: 'NONE', createdAt: null, consumedAt: null, result: null };

function latestContext() { return combinedContext(contexts, config.primarySymbol); }
function currentMt5(now = Date.now()) {
  const last = Date.parse(mt5.lastSeenAt || '');
  return { ...mt5, fresh: Number.isFinite(last) && now - last <= config.mt5OfflineMs };
}
function liveDirection(feature = latestFeature) {
  const v1 = finite(feature?.velocity1Atr);
  const v3 = finite(feature?.velocity3Atr);
  if (v1 > 0.01 && v3 > 0) return 'UP';
  if (v1 < -0.01 && v3 < 0) return 'DOWN';
  return 'MIXED';
}
function maybeLogTwelveScan(tick) {
  const now = finite(tick.receivedAt, Date.now());
  if (now - lastScanLoggedAt < config.scanLogSeconds * 1000) return;
  lastScanLoggedAt = now;
  const broker = currentMt5(now);
  const context = latestContext();
  store.append('scans', {
    at: new Date(now).toISOString(), source: 'TWELVE_DATA', symbol: tick.symbol, price: tick.price,
    liveDirection: liveDirection(), velocity1Atr: finite(latestFeature?.velocity1Atr),
    velocity3Atr: finite(latestFeature?.velocity3Atr), velocity10Atr: finite(latestFeature?.velocity10Atr),
    tickExpansion: finite(latestFeature?.tickExpansion), acceleration: finite(latestFeature?.acceleration),
    efficiency: finite(latestFeature?.efficiency), regime: context.regime,
    m1Direction: context.m1?.direction || '—', m5Direction: context.m5?.direction || '—',
    m15Direction: context.m15?.direction || '—', h1Direction: context.h1?.direction || '—',
    mt5Fresh: broker.fresh, engineState: broker.engineState, positions: integer(broker.positionCount),
    pending: integer(broker.pendingCount), side: broker.side || 'NONE', floatingProfit: finite(broker.floatingProfit),
    lastEvent: broker.lastEvent || '', note: 'Twelve Data is telemetry only. MT5 bullet geometry controls entries.'
  }, 'scan');
}
function onTick(tick) {
  const receivedAt = finite(tick.receivedAt, Date.now());
  features.ingest(tick.symbol, tick.price, receivedAt);
  latestFeature = features.snapshot(tick.symbol, latestContext(), currentMt5(receivedAt));
  maybeLogTwelveScan(tick);
}

const twelve = new TwelveDataClient({
  onTick,
  onContext: payload => {
    contexts[payload.symbol] ||= {};
    contexts[payload.symbol][payload.interval] = payload.context;
    if (payload.interval === '1min') store.append('contexts', payload, 'context');
  },
  onStatus: status => { twelveStatus = status; }
});
twelve.start();
store.event('startup', `${config.serviceName} started`, { version: config.version, mode: config.mode, dataNamespace: config.dataNamespace });

export function calculatePerformance(rows) {
  const closed = rows.filter(row => String(row.status || 'CLOSED').toUpperCase() === 'CLOSED');
  const profits = closed.map(row => finite(row.netProfit));
  const wins = profits.filter(value => value > 0), losses = profits.filter(value => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    baskets: closed.length, wins: wins.length, losses: losses.length,
    winRate: closed.length ? round(wins.length / closed.length * 100, 1) : 0,
    netProfit: round(profits.reduce((sum, value) => sum + value, 0), 2),
    grossProfit: round(grossProfit, 2), grossLoss: round(-grossLossAbs, 2),
    profitFactor: grossLossAbs > 0 ? round(grossProfit / grossLossAbs, 2) : grossProfit > 0 ? 999 : 0,
    averageBasket: closed.length ? round(profits.reduce((sum, value) => sum + value, 0) / closed.length, 2) : 0,
    bestBasket: profits.length ? round(Math.max(...profits), 2) : 0,
    worstBasket: profits.length ? round(Math.min(...profits), 2) : 0
  };
}
function overview() {
  const tickAt = Date.parse(twelveStatus.lastTickAt || '');
  const tickAgeMs = Number.isFinite(tickAt) ? Math.max(0, Date.now() - tickAt) : null;
  return {
    service: config.serviceName, version: config.version, mode: config.mode,
    control, config: { primarySymbol: config.primarySymbol, timezone: config.timezone, dataNamespace: config.dataNamespace },
    twelveData: { ...twelveStatus, tickAgeMs, priceFresh: tickAgeMs !== null && tickAgeMs <= config.wsStaleMs, staleAfterMs: config.wsStaleMs },
    mt5: currentMt5(), feature: latestFeature, context: latestContext(),
    engine: {
      name: 'AGGRESSIVE TWO-SIDED BULLET ENGINE',
      entryPermission: 'MT5 LOCAL — NO QUALITY FILTER',
      twelveDataRole: 'LIVE TELEMETRY AND HISTORY ONLY',
      liveDirection: liveDirection(),
      velocity1Atr: finite(latestFeature?.velocity1Atr), velocity3Atr: finite(latestFeature?.velocity3Atr),
      velocity10Atr: finite(latestFeature?.velocity10Atr), tickExpansion: finite(latestFeature?.tickExpansion),
      acceleration: finite(latestFeature?.acceleration)
    },
    performance: calculatePerformance(store.all('baskets')),
    counts: Object.fromEntries(['scans','signals','baskets','legs','orders','banks','events'].map(name => [name, store.all(name).length])),
    recentScans: store.list('scans', 150), recentSignals: store.list('signals', 50),
    recentBaskets: store.list('baskets', 100), recentLegs: store.list('legs', 200),
    recentOrders: store.list('orders', 200), recentBanks: store.list('banks', 100), recentEvents: store.list('events', 100)
  };
}
function parseBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; if (raw.length > 2_000_000) request.destroy(); });
    request.on('end', () => {
      if (!raw) return resolve({});
      try { return resolve(String(request.headers['content-type'] || '').includes('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}
function tokenFrom(request, url, body = {}) { return String(request.headers['x-bot-token'] || url.searchParams.get('token') || body.token || '').trim(); }
function authorised(request, url, body = {}) { return config.botToken !== 'CHANGE-ME' && tokenFrom(request, url, body) === config.botToken; }
function headers(contentType = 'application/json; charset=utf-8') {
  return {
    'Access-Control-Allow-Origin': config.dashboardOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Bot-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store', 'Content-Type': contentType
  };
}
function send(response, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  const payload = Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, { ...headers(contentType), 'Content-Length': Buffer.byteLength(payload), ...extra });
  response.end(payload);
}
function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  send(response, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  return true;
}
function queueCommand(action) {
  command = { id: Date.now(), action, createdAt: nowIso(), consumedAt: null, result: null };
  store.event('command', `${action} queued`, { id: command.id });
  return command;
}
function controlText() {
  return [
    `command_id=${command.consumedAt ? 0 : command.id || 0}`,
    `action=${command.consumedAt ? 'NONE' : command.action || 'NONE'}`,
    `autonomous=${control.autonomous ? 'true' : 'false'}`,
    `emergency=${control.emergency ? 'true' : 'false'}`,
    'settings_version=0', 'fixed_lot=0', 'use_equity_scaling=false', 'equity_per_001_lot=1000',
    'decision_id=LOCAL_BULLET_ENGINE', 'decision_action=LOCAL', 'decision_direction=NONE',
    'decision_quality=0', 'decision_buy_quality=0', 'decision_sell_quality=0',
    'decision_add_allowed=true', `decision_valid_until=${Date.now() + 60_000}`,
    'decision_ttl_remaining_ms=60000', `server_now_ms=${Date.now()}`,
    'decision_reason=MT5 TWO-SIDED BULLET ENGINE CONTROLS ENTRIES',
    'decision_regime=LOCAL', 'decision_m5=TELEMETRY', 'decision_m15=TELEMETRY', 'decision_h1=TELEMETRY'
  ].join('\n');
}

export function createHttpServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      if (request.method === 'OPTIONS') return send(response, 204, '');
      if (pathname === '/health') return send(response, 200, { ok: true, service: config.serviceName, version: config.version, mode: config.mode, twelveWs: twelveStatus.ws, twelveRest: twelveStatus.rest });
      if (request.method === 'GET' && serveStatic(response, pathname)) return;
      const body = ['POST','PUT','PATCH'].includes(request.method) ? await parseBody(request) : {};
      if (pathname === '/api/auth' && request.method === 'POST') return send(response, authorised(request, url, body) ? 200 : 401, { ok: authorised(request, url, body) });
      if (!authorised(request, url, body)) return send(response, 401, { ok: false, error: 'UNAUTHORISED' });
      if (pathname === '/api/state' && request.method === 'GET') return send(response, 200, { ok: true, ...overview() });
      if (pathname === '/api/ea/control' && request.method === 'GET') return send(response, 200, controlText(), 'text/plain; charset=utf-8');
      if (pathname === '/api/ea/heartbeat' && request.method === 'POST') {
        mt5 = {
          ...mt5, ...body,
          bid: finite(body.bid, mt5.bid), ask: finite(body.ask, mt5.ask), spreadPoints: finite(body.spreadPoints, mt5.spreadPoints),
          atrM1: finite(body.atrM1, mt5.atrM1), balance: finite(body.balance, mt5.balance), equity: finite(body.equity, mt5.equity),
          floatingProfit: finite(body.floatingProfit, mt5.floatingProfit), peakBasketProfit: finite(body.peakBasketProfit, mt5.peakBasketProfit),
          positionCount: integer(body.positionCount, mt5.positionCount), pendingCount: integer(body.pendingCount, mt5.pendingCount),
          directionLegs: integer(body.directionLegs ?? body.positionsOpened, mt5.directionLegs),
          terminalConnected: String(body.terminalConnected) === 'true' || body.terminalConnected === true,
          algoAllowed: String(body.algoAllowed) === 'true' || body.algoAllowed === true,
          autonomous: String(body.autonomous) === 'true' || body.autonomous === true,
          directionLocked: String(body.directionLocked) === 'true' || body.directionLocked === true || String(body.engineState || '').includes('LOCKED'),
          lastSeenAt: nowIso()
        };
        if (integer(body.consumedCommandId) >= command.id && command.id > 0) {
          command.consumedAt = nowIso(); command.result = body.lastCommandResult || body.lastEvent || 'Consumed';
        }
        if (store.all('mt5').length === 0 || Date.now() - Date.parse(store.all('mt5')[0]?.receivedAt || 0) > 10_000) store.append('mt5', mt5, 'mt5');
        return send(response, 200, { ok: true, autonomous: control.autonomous });
      }
      const collectionRoutes = { basket: 'baskets', signal: 'signals', leg: 'legs', order: 'orders', bank: 'banks' };
      for (const [route, collection] of Object.entries(collectionRoutes)) {
        if (pathname === `/api/ea/${route}` && request.method === 'POST') {
          const record = route === 'basket' ? store.upsert(collection, body) : store.append(collection, body, route);
          if (route === 'basket') store.event('basket', `${record.side || 'BASKET'} closed ${finite(record.netProfit).toFixed(2)}`, { exitReason: record.exitReason });
          return send(response, 200, { ok: true, id: record.id, performance: calculatePerformance(store.all('baskets')) });
        }
      }
      if (pathname === '/api/ea/scan' && request.method === 'POST') return send(response, 200, { ok: true, id: store.append('scans', { ...body, source: 'MT5' }, 'scan').id });
      if (pathname === '/api/ea/event' && request.method === 'POST') return send(response, 200, { ok: true, id: store.event(body.type || 'ea', body.message || 'EA event', body.data || null).id });
      if (pathname === '/api/command' && request.method === 'POST') {
        const action = String(body.action || '').toUpperCase();
        if (action === 'ENABLE_AUTO') { control.autonomous = true; control.emergency = false; store.event('control', 'Autonomous enabled'); return send(response, 200, { ok: true }); }
        if (action === 'DISABLE_AUTO') { control.autonomous = false; store.event('control', 'Autonomous disabled'); return send(response, 200, { ok: true }); }
        if (action === 'EMERGENCY_STOP') { control.autonomous = false; control.emergency = true; return send(response, 200, { ok: true, command: queueCommand(action) }); }
        if (action === 'RESET_EMERGENCY') { control.emergency = false; return send(response, 200, { ok: true, command: queueCommand(action) }); }
        const supported = new Set(['CLOSE_BASKET','PAUSE_EA','RESUME_EA','PAUSE_ADDING','RESUME_ADDING','REBUILD_BRACKET']);
        if (!supported.has(action)) return send(response, 400, { ok: false, error: 'UNSUPPORTED_COMMAND' });
        return send(response, 200, { ok: true, command: queueCommand(action) });
      }
      const match = pathname.match(/^\/api\/export\/(scans|signals|baskets|legs|orders|banks|events|contexts|mt5)\.csv$/);
      if (match && request.method === 'GET') {
        const collection = match[1];
        return send(response, 200, toCsv([...store.all(collection)].reverse()), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="eve-bullet-storm-${collection}.csv"` });
      }
      return send(response, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
      console.error(error);
      return send(response, 500, { ok: false, error: error.message || 'INTERNAL_ERROR' });
    }
  });
}

if (process.env.NODE_ENV !== 'test') {
  const server = createHttpServer();
  server.listen(config.port, '0.0.0.0', () => console.log(`${config.serviceName} v${config.version} listening on ${config.port}`));
  process.on('SIGTERM', () => { twelve.stop(); server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { twelve.stop(); server.close(() => process.exit(0)); });
}

export { overview, currentMt5, onTick };
