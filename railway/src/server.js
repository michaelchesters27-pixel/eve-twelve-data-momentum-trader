import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { combinedContext } from './context.js';
import { LiveFeatureEngine } from './features.js';
import { chooseAssessment } from './decision.js';
import { JsonlStore } from './storage.js';
import { finite, integer, nowIso, round, toCsv, uid } from './utils.js';
import { TwelveDataClient } from './twelve-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const store = new JsonlStore(config.dataDir, config.dataNamespace);
const features = new LiveFeatureEngine();
const contexts = {};
const holds = new Map();
const lastSignalAt = new Map();
let twelveStatus = { ws: 'WARMING', rest: 'WARMING', lastTickAt: null, lastMarketTickAt: null, lastRestAt: null, lastError: null };
let latestFeature = null;
let latestAssessment = null;
let lastScanLoggedAt = 0;
let mt5 = {
  account: null, symbol: null, bid: 0, ask: 0, spreadPoints: 0, atrM1: 0,
  terminalConnected: false, algoAllowed: false, autonomous: false,
  positionCount: 0, pendingCount: 0, side: 'NONE', lastSeenAt: null,
  consumedDecisionId: '', lastEvent: 'Waiting for MT5 EA'
};
let control = { autonomous: config.autonomousAtStart, emergency: false };
let command = { id: 0, action: 'NONE', createdAt: null, consumedAt: null, result: null };
let decision = waitDecision('WARMING');

function waitDecision(reason, assessment = latestAssessment, timestamp = Date.now()) {
  const best = assessment?.best;
  return {
    id: `wait-${timestamp}`,
    action: 'WAIT', direction: best?.direction || 'NONE', quality: best?.quality || 0,
    buyQuality: assessment?.buy?.quality || 0, sellQuality: assessment?.sell?.quality || 0,
    addAllowed: false, createdAt: new Date(timestamp).toISOString(), validUntil: timestamp + 3_000,
    reason, rejectionReasons: [...(best?.hardBlocks || []), ...(best?.reasons || [])],
    regime: latestContext()?.regime || 'UNKNOWN', m5: latestContext()?.m5?.direction || 'UNKNOWN',
    m15: latestContext()?.m15?.direction || 'UNKNOWN', h1: latestContext()?.h1?.direction || 'UNKNOWN'
  };
}
function latestContext() { return combinedContext(contexts, config.primarySymbol); }
function currentMt5(now = Date.now()) {
  const last = Date.parse(mt5.lastSeenAt || '');
  return { ...mt5, fresh: Number.isFinite(last) && now - last <= config.mt5OfflineMs };
}
function decisionFresh(now = Date.now()) { return decision.action !== 'WAIT' && now <= finite(decision.validUntil, 0); }
function issueDecision(assessment, tick) {
  const best = assessment.best;
  const id = uid('signal');
  decision = {
    id, action: best.direction, direction: best.direction, quality: best.quality,
    buyQuality: assessment.buy.quality, sellQuality: assessment.sell.quality,
    addAllowed: best.addAllowed, createdAt: new Date(tick.timestamp).toISOString(),
    validUntil: tick.timestamp + config.signalTtlMs,
    reason: `${best.direction} QUALITY ${best.quality}/100 - CONFIRMED BREAKOUT HELD ${Math.max(config.signalHoldMs, config.breakoutConfirmMs)}MS`,
    rejectionReasons: [], regime: latestContext().regime,
    m5: latestContext().m5?.direction || 'UNKNOWN', m15: latestContext().m15?.direction || 'UNKNOWN',
    h1: latestContext().h1?.direction || 'UNKNOWN'
  };
  store.append('signals', {
    ...decision, symbol: tick.symbol, price: tick.price, session: best.session,
    feature: latestFeature, assessment, context: latestContext()
  }, 'signal');
  store.event('signal', `${best.direction} decision ${best.quality}/100 issued`, { id, addAllowed: best.addAllowed, regime: decision.regime });
}
function updateDecision(tick, assessment) {
  const now = tick.timestamp;
  const broker = currentMt5(now);
  const campaignActive = integer(broker.positionCount) > 0 || integer(broker.pendingCount) > 0;
  if (!control.autonomous || control.emergency) {
    decision = waitDecision(control.emergency ? 'EMERGENCY_STOP_ACTIVE' : 'AUTONOMOUS_DISABLED', assessment, now);
    holds.clear();
    return;
  }
  if (campaignActive) {
    const best = assessment.best;
    decision = {
      id: decisionFresh(now) ? decision.id : `manage-${now}`,
      action: 'MANAGE', direction: best.direction, quality: best.quality,
      buyQuality: assessment.buy.quality, sellQuality: assessment.sell.quality,
      addAllowed: best.addAllowed, createdAt: new Date(now).toISOString(), validUntil: now + config.signalTtlMs,
      reason: best.eligible ? 'CAMPAIGN QUALITY SUPPORT' : 'CAMPAIGN QUALITY FADED',
      rejectionReasons: [...best.hardBlocks, ...best.reasons], regime: latestContext().regime,
      m5: latestContext().m5?.direction || 'UNKNOWN', m15: latestContext().m15?.direction || 'UNKNOWN',
      h1: latestContext().h1?.direction || 'UNKNOWN'
    };
    holds.clear();
    return;
  }
  if (decisionFresh(now) && !broker.consumedDecisionId) return;
  if (decisionFresh(now) && broker.consumedDecisionId !== decision.id) return;
  const best = assessment.best;
  if (!best.eligible) {
    holds.delete('BUY'); holds.delete('SELL');
    decision = waitDecision([...best.hardBlocks, ...best.reasons].join(' | ') || 'QUALITY_NOT_CONFIRMED', assessment, now);
    return;
  }
  const opposite = best.direction === 'BUY' ? 'SELL' : 'BUY';
  holds.delete(opposite);
  const previous = holds.get(best.direction);
  const requiredHoldMs = Math.max(config.signalHoldMs, config.breakoutConfirmMs);
  if (!previous) {
    holds.set(best.direction, { startedAt: now, bestQuality: best.quality });
    decision = waitDecision(`${best.direction}_BREAKOUT_HOLDING_${requiredHoldMs}MS`, assessment, now);
    return;
  }
  previous.bestQuality = Math.max(previous.bestQuality, best.quality);
  const cooldownReady = now - (lastSignalAt.get(best.direction) || 0) >= config.signalCooldownMs;
  if (now - previous.startedAt < requiredHoldMs) {
    decision = waitDecision(`${best.direction}_SIGNAL_HOLD_NOT_COMPLETE`, assessment, now);
    return;
  }
  if (!cooldownReady) {
    decision = waitDecision(`${best.direction}_SIGNAL_COOLDOWN`, assessment, now);
    return;
  }
  issueDecision(assessment, tick);
  lastSignalAt.set(best.direction, now);
  holds.delete(best.direction);
}
function flattenScan(record) {
  return {
    id: record.id, at: record.at, symbol: record.symbol, price: record.price,
    bid: record.bid, ask: record.ask, spreadPoints: record.spreadPoints, spreadAtr: record.spreadAtr,
    session: record.session, decisionAction: record.decisionAction, decisionDirection: record.decisionDirection,
    buyQuality: record.buyQuality, sellQuality: record.sellQuality, addAllowed: record.addAllowed,
    regime: record.regime, m1Direction: record.m1Direction, m5Direction: record.m5Direction,
    m15Direction: record.m15Direction, h1Direction: record.h1Direction,
    velocity1Atr: record.velocity1Atr, velocity3Atr: record.velocity3Atr, velocity10Atr: record.velocity10Atr,
    tickExpansion: record.tickExpansion, acceleration: record.acceleration, efficiency: record.efficiency,
    breakoutBuy: record.breakoutBuy, breakoutSell: record.breakoutSell,
    breakoutBuyDistanceAtr: record.breakoutBuyDistanceAtr, breakoutSellDistanceAtr: record.breakoutSellDistanceAtr,
    breakoutConfirmed: record.breakoutConfirmed, postBreakoutPersistence: record.postBreakoutPersistence,
    rejectionReason: record.rejectionReason, twelveWs: record.twelveWs, twelveRest: record.twelveRest,
    mt5Fresh: record.mt5Fresh, feedDivergenceAtr: record.feedDivergenceAtr,
    twelveTickAgeMs: record.twelveTickAgeMs, twelvePriceFresh: record.twelvePriceFresh,
    buyVelocityScore: record.buyVelocityScore, buyPersistenceScore: record.buyPersistenceScore,
    buyBreakoutScore: record.buyBreakoutScore, buyEfficiencyScore: record.buyEfficiencyScore,
    sellVelocityScore: record.sellVelocityScore, sellPersistenceScore: record.sellPersistenceScore,
    sellBreakoutScore: record.sellBreakoutScore, sellEfficiencyScore: record.sellEfficiencyScore
  };
}
function maybeLogScan(tick, assessment) {
  if (tick.timestamp - lastScanLoggedAt < config.scanLogSeconds * 1_000) return;
  lastScanLoggedAt = tick.timestamp;
  const broker = currentMt5(tick.timestamp);
  const context = latestContext();
  const best = assessment.best;
  store.append('scans', {
    at: new Date(tick.timestamp).toISOString(), symbol: tick.symbol, price: tick.price,
    bid: broker.bid, ask: broker.ask, spreadPoints: broker.spreadPoints, spreadAtr: latestFeature?.spreadAtr,
    session: best.session, decisionAction: decision.action, decisionDirection: decision.direction,
    buyQuality: assessment.buy.quality, sellQuality: assessment.sell.quality, addAllowed: best.addAllowed,
    regime: context.regime, m1Direction: context.m1?.direction, m5Direction: context.m5?.direction,
    m15Direction: context.m15?.direction, h1Direction: context.h1?.direction,
    velocity1Atr: latestFeature?.velocity1Atr, velocity3Atr: latestFeature?.velocity3Atr,
    velocity10Atr: latestFeature?.velocity10Atr, tickExpansion: latestFeature?.tickExpansion,
    acceleration: latestFeature?.acceleration, efficiency: latestFeature?.efficiency,
    breakoutBuy: latestFeature?.breakoutBuy, breakoutSell: latestFeature?.breakoutSell,
    breakoutBuyDistanceAtr: latestFeature?.breakoutBuyDistanceAtr, breakoutSellDistanceAtr: latestFeature?.breakoutSellDistanceAtr,
    breakoutConfirmed: best.breakoutConfirmed, postBreakoutPersistence: best.postBreakoutPersistence,
    buyVelocityScore: latestFeature?.buy?.components?.velocity, buyPersistenceScore: latestFeature?.buy?.components?.persistence,
    buyBreakoutScore: latestFeature?.buy?.components?.breakout, buyEfficiencyScore: latestFeature?.buy?.components?.efficiency,
    sellVelocityScore: latestFeature?.sell?.components?.velocity, sellPersistenceScore: latestFeature?.sell?.components?.persistence,
    sellBreakoutScore: latestFeature?.sell?.components?.breakout, sellEfficiencyScore: latestFeature?.sell?.components?.efficiency,
    rejectionReason: decision.action === 'WAIT' ? decision.reason : '',
    buyRejections: [...assessment.buy.hardBlocks, ...assessment.buy.reasons],
    sellRejections: [...assessment.sell.hardBlocks, ...assessment.sell.reasons],
    twelveWs: twelveStatus.ws, twelveRest: twelveStatus.rest, mt5Fresh: broker.fresh,
    feedDivergenceAtr: best.feedDivergenceAtr,
    twelveTickAgeMs: best.twelveTickAgeMs, twelvePriceFresh: best.twelvePriceFresh
  }, 'scan');
}
function onTick(tick) {
  const context = latestContext();
  const processingNow = finite(tick.receivedAt, Date.now());
  // Market sequencing uses the provider timestamp; freshness and TTL use this server's clock.
  features.ingest(tick.symbol, tick.price, tick.timestamp);
  latestFeature = features.snapshot(tick.symbol, context, currentMt5(processingNow));
  const decisionTick = { ...tick, marketTimestamp: tick.timestamp, timestamp: processingNow };
  if (!latestFeature?.ready) {
    decision = waitDecision('LIVE_FEATURE_ENGINE_WARMING', null, processingNow);
    return;
  }
  latestAssessment = chooseAssessment({
    score: { buy: latestFeature.buy, sell: latestFeature.sell }, feature: latestFeature,
    context, mt5: currentMt5(processingNow), twelveStatus, now: processingNow
  });
  updateDecision(decisionTick, latestAssessment);
  maybeLogScan(decisionTick, latestAssessment);
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
store.event('startup', `${config.serviceName} started`, { version: config.version, symbol: config.primarySymbol, mode: config.mode, dataNamespace: config.dataNamespace });

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
  const twelveTickAgeMs = Number.isFinite(tickAt) ? Math.max(0, Date.now() - tickAt) : null;
  const twelvePriceFresh = twelveTickAgeMs !== null && twelveTickAgeMs <= config.wsStaleMs;
  return {
    service: config.serviceName, version: config.version, mode: config.mode,
    control, config: {
      primarySymbol: config.primarySymbol, initialQualityMin: config.initialQualityMin,
      continuationQualityMin: config.continuationQualityMin, signalHoldMs: config.signalHoldMs,
      maxSpreadAtr: config.maxSpreadAtr, timezone: config.timezone, dataNamespace: config.dataNamespace,
      breakoutConfirmMs: config.breakoutConfirmMs, breakoutMinAtr: config.breakoutMinAtr,
      breakoutPersistenceMin: config.breakoutPersistenceMin, breakoutEfficiencyMin: config.breakoutEfficiencyMin
    },
    twelveData: { ...twelveStatus, tickAgeMs: twelveTickAgeMs, priceFresh: twelvePriceFresh, staleAfterMs: config.wsStaleMs },
    mt5: currentMt5(), decision, feature: latestFeature,
    assessment: latestAssessment, context: latestContext(),
    performance: calculatePerformance(store.all('baskets')),
    counts: Object.fromEntries(['scans','signals','baskets','legs','orders','banks','events'].map(name => [name, store.all(name).length])),
    recentScans: store.list('scans', 120).map(flattenScan), recentSignals: store.list('signals', 50),
    recentBaskets: store.list('baskets', 100), recentLegs: store.list('legs', 150),
    recentOrders: store.list('orders', 150), recentBanks: store.list('banks', 100), recentEvents: store.list('events', 100)
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
  const d = decision;
  return [
    `command_id=${command.consumedAt ? 0 : command.id || 0}`,
    `action=${command.consumedAt ? 'NONE' : command.action || 'NONE'}`,
    `autonomous=${control.autonomous ? 'true' : 'false'}`,
    `emergency=${control.emergency ? 'true' : 'false'}`,
    `decision_id=${d.id || ''}`,
    `decision_action=${d.action || 'WAIT'}`,
    `decision_direction=${d.direction || 'NONE'}`,
    `decision_quality=${finite(d.quality)}`,
    `decision_buy_quality=${finite(d.buyQuality)}`,
    `decision_sell_quality=${finite(d.sellQuality)}`,
    `decision_add_allowed=${d.addAllowed ? 'true' : 'false'}`,
    `decision_valid_until=${integer(d.validUntil)}`,
    `decision_ttl_remaining_ms=${Math.max(0, integer(d.validUntil) - Date.now())}`,
    `server_now_ms=${Date.now()}`,
    `decision_reason=${String(d.reason || '').replace(/[\r\n=]/g, ' ')}`,
    `decision_regime=${d.regime || 'UNKNOWN'}`,
    `decision_m5=${d.m5 || 'UNKNOWN'}`,
    `decision_m15=${d.m15 || 'UNKNOWN'}`,
    `decision_h1=${d.h1 || 'UNKNOWN'}`,
    `initial_quality_min=${config.initialQualityMin}`,
    `continuation_quality_min=${config.continuationQualityMin}`
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
          positionCount: integer(body.positionCount, mt5.positionCount), pendingCount: integer(body.pendingCount, mt5.pendingCount),
          terminalConnected: String(body.terminalConnected) === 'true' || body.terminalConnected === true,
          algoAllowed: String(body.algoAllowed) === 'true' || body.algoAllowed === true,
          lastSeenAt: nowIso()
        };
        if (String(body.consumedDecisionId || '') === decision.id && decision.action !== 'WAIT') {
          decision.consumedAt = nowIso();
          mt5.consumedDecisionId = decision.id;
        }
        if (integer(body.consumedCommandId) >= command.id && command.id > 0) {
          command.consumedAt = nowIso(); command.result = body.lastCommandResult || body.lastEvent || 'Consumed';
        }
        if (store.all('mt5').length === 0 || Date.now() - Date.parse(store.all('mt5')[0]?.receivedAt || 0) > 10_000) store.append('mt5', mt5, 'mt5');
        return send(response, 200, { ok: true, decisionId: decision.id, autonomous: control.autonomous });
      }
      const collectionRoutes = { basket: 'baskets', leg: 'legs', order: 'orders', bank: 'banks' };
      for (const [route, collection] of Object.entries(collectionRoutes)) {
        if (pathname === `/api/ea/${route}` && request.method === 'POST') {
          const record = route === 'basket' ? store.upsert(collection, body) : store.append(collection, body, route);
          if (route === 'basket') store.event('basket', `${record.side || 'BASKET'} closed ${finite(record.netProfit).toFixed(2)}`, { exitReason: record.exitReason });
          return send(response, 200, { ok: true, id: record.id, performance: calculatePerformance(store.all('baskets')) });
        }
      }
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
        const rows = collection === 'scans' ? store.all(collection).map(flattenScan) : store.all(collection);
        return send(response, 200, toCsv([...rows].reverse()), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="eve-twelve-data-trader-${collection}.csv"` });
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
