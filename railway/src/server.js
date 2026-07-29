import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { combinedContext } from './context.js';
import { LiveFeatureEngine } from './features.js';
import { JsonlStore } from './storage.js';
import { finite, integer, nowIso, round, toCsv } from './utils.js';
import { TwelveDataClient } from './twelve-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const settingsFile = path.join(config.dataDir, `${config.dataNamespace}-settings.json`);
const store = new JsonlStore(config.dataDir, config.dataNamespace);
const features = new LiveFeatureEngine();
const contexts = {};

let twelveStatus = { ws: 'WARMING', rest: 'WARMING', lastTickAt: null, lastMarketTickAt: null, lastRestAt: null, lastError: null };
let latestFeature = null;
let lastScanLoggedAt = 0;
let mt5 = {
  account: null, symbol: null, bid: 0, ask: 0, spreadPoints: 0,
  terminalConnected: false, algoAllowed: false, autonomous: false,
  positionCount: 0, pendingCount: 0, campaignId: '', campaignCurrentSide: 'NONE',
  campaignBuyLegs: 0, campaignSellLegs: 0, campaignBuyBulletsFired: 0, campaignSellBulletsFired: 0, uniqueBulletsFired: 0, heartbeatSequence: 0, floatingProfit: 0, peakBasketProfit: 0,
  dailyLossEnabled: false, dailyLossMoney: 20, dailyLossPnl: 0, dailyLossRemaining: 20, dailyLossBlocked: false, dailyLossResetAt: 0,
  engineState: 'WAITING FOR MT5', lastSeenAt: null, lastEvent: 'Waiting for MT5 EA', lastHttpStatus: 'Not connected'
};
let control = { autonomous: config.autonomousAtStart, emergency: false };
let command = { id: 0, action: 'NONE', createdAt: null, consumedAt: null, result: null };

function defaultSettings() {
  return {
    version: 1,
    profitTargetEnabled: false,
    profitTargetMoney: 7,
    dailyLossEnabled: false,
    dailyLossMoney: 20,
    dailyLossResetAtMs: 0,
    updatedAt: nowIso()
  };
}
function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile)) return defaultSettings();
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return normaliseSettings(parsed, false);
  } catch (error) {
    console.error('Could not load settings:', error.message);
    return defaultSettings();
  }
}
function saveSettings(value) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function settingBoolean(input, key, fallback) {
  if (!(key in input) || input[key] === undefined || input[key] === null || input[key] === '') return Boolean(fallback);
  return input[key] === true || ['1', 'true', 'yes', 'on'].includes(String(input[key]).toLowerCase());
}

export function normaliseSettings(input = {}, increment = true, current = defaultSettings()) {
  const targetEnabled = settingBoolean(input, 'profitTargetEnabled', current.profitTargetEnabled ?? false);
  const targetRaw = Number(input.profitTargetMoney ?? current.profitTargetMoney ?? 7);
  const targetMoney = Number.isFinite(targetRaw) ? Math.min(100_000, Math.max(0.01, targetRaw)) : 7;
  const dailyLossEnabled = settingBoolean(input, 'dailyLossEnabled', current.dailyLossEnabled ?? false);
  const dailyLossRaw = Number(input.dailyLossMoney ?? current.dailyLossMoney ?? 20);
  const dailyLossMoney = Number.isFinite(dailyLossRaw) ? Math.min(100_000, Math.max(0.01, dailyLossRaw)) : 20;
  const resetRaw = Number(input.dailyLossResetAtMs ?? current.dailyLossResetAtMs ?? 0);
  const dailyLossResetAtMs = Number.isFinite(resetRaw) ? Math.max(0, Math.trunc(resetRaw)) : 0;
  return {
    version: increment ? integer(current.version, 0) + 1 : Math.max(1, integer(input.version, 1)),
    profitTargetEnabled: targetEnabled,
    profitTargetMoney: round(targetMoney, 2),
    dailyLossEnabled,
    dailyLossMoney: round(dailyLossMoney, 2),
    dailyLossResetAtMs,
    updatedAt: nowIso()
  };
}
let settings = loadSettings();

function latestContext() { return combinedContext(contexts, config.primarySymbol); }
function currentMt5(now = Date.now()) {
  const last = Date.parse(mt5.lastSeenAt || '');
  const heartbeatAgeMs = Number.isFinite(last) ? Math.max(0, now - last) : null;
  return { ...mt5, heartbeatAgeMs, fresh: heartbeatAgeMs !== null && heartbeatAgeMs <= config.mt5OfflineMs };
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
    mt5Fresh: broker.fresh, engineState: broker.engineState, campaignId: broker.campaignId || '',
    positions: integer(broker.positionCount), pending: integer(broker.pendingCount),
    floatingProfit: finite(broker.floatingProfit), lastEvent: broker.lastEvent || '',
    note: 'Twelve Data is telemetry only. MT5 fixed-ladder geometry controls all entries.'
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
if (process.env.NODE_ENV !== 'test') twelve.start();
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

export function calculateLab(baskets, legs, protections) {
  const closedLegs = legs.filter(row => String(row.action).toUpperCase() === 'CLOSE');
  const campaigns = baskets.length;
  const targetBanks = baskets.filter(row => String(row.exitReason || '').includes('PROFIT TARGET')).length;
  const newestFailures = baskets.filter(row => String(row.exitReason || '').includes('NEWEST BULLET')).length;
  const mixed = baskets.filter(row => String(row.side || '').toUpperCase() === 'MIXED').length;
  const beCount = protections.filter(row => String(row.action || '').toUpperCase() === 'BE_ACTIVATED').length;
  const mfe = closedLegs.map(row => finite(row.mfePrice)).filter(value => value >= 0);
  const mae = closedLegs.map(row => finite(row.maePrice)).filter(value => value >= 0);
  return {
    campaigns,
    averageBullets: campaigns ? round(baskets.reduce((sum, row) => sum + integer(row.uniqueBulletsFired ?? row.positionsOpened), 0) / campaigns, 2) : 0,
    targetBanks,
    targetBankRate: campaigns ? round(targetBanks / campaigns * 100, 1) : 0,
    newestFailures,
    newestFailureRate: campaigns ? round(newestFailures / campaigns * 100, 1) : 0,
    mixedCampaigns: mixed,
    mixedCampaignRate: campaigns ? round(mixed / campaigns * 100, 1) : 0,
    breakEvenActivations: beCount,
    averageMfePrice: mfe.length ? round(mfe.reduce((a, b) => a + b, 0) / mfe.length, 3) : 0,
    averageMaePrice: mae.length ? round(mae.reduce((a, b) => a + b, 0) / mae.length, 3) : 0
  };
}


export function auditCampaign(basket, legs = []) {
  const openRows = legs.filter(row => String(row.action || '').toUpperCase() === 'OPEN');
  const closeRows = legs.filter(row => String(row.action || '').toUpperCase() === 'CLOSE');
  const key = row => String(row.positionId || row.ticket || row.id || '');
  const uniqueOpenKeys = new Set(openRows.map(key).filter(Boolean));
  const uniqueCloseKeys = new Set(closeRows.map(key).filter(Boolean));
  const reportedBullets = integer(basket?.uniqueBulletsFired ?? basket?.positionsOpened);
  const uniqueOpenBullets = uniqueOpenKeys.size;
  const closedUniqueBullets = [...uniqueOpenKeys].filter(value => uniqueCloseKeys.has(value)).length;
  let status = 'NO BULLET RECORDS';
  if (uniqueOpenBullets > 0 && reportedBullets === uniqueOpenBullets) {
    status = basket && closedUniqueBullets < uniqueOpenBullets ? 'SYNCING CLOSE RECORDS' : 'CONSISTENT';
  } else if (uniqueOpenBullets > 0 || reportedBullets > 0) {
    status = 'COUNT MISMATCH';
  }
  return { status, reportedBullets, uniqueOpenBullets, openRecords: openRows.length, closeRecords: closeRows.length, closedUniqueBullets };
}

function eventTime(row = {}) {
  const value = row.at ?? row.dealTime ?? row.exitTime ?? row.entryTime ?? row.receivedAt;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}
function timelineItem(type, row) {
  return {
    type,
    eventSequence: integer(row.eventSequence, 0),
    at: row.at ?? row.dealTime ?? row.exitTime ?? row.entryTime ?? row.receivedAt,
    action: row.action || (type === 'CAMPAIGN' ? 'CLOSED' : type),
    side: row.side || '', bulletNumber: integer(row.bulletNumber, 0), ticket: row.ticket || '',
    price: finite(row.price ?? row.entryPrice ?? row.anchorPrice), netProfit: finite(row.netProfit ?? row.basketProfit),
    reason: row.reason || row.exitReason || row.campaignExitReason || ''
  };
}
function campaignTimeline(records) {
  const rows = [
    ...(records.ladder ? [timelineItem('LADDER', records.ladder)] : []),
    ...records.orders.map(row => timelineItem('ORDER', row)),
    ...records.legs.map(row => timelineItem('BULLET', row)),
    ...records.protections.map(row => timelineItem('PROTECTION', row)),
    ...records.banks.map(row => timelineItem('BANKING', row)),
    ...(records.basket ? [timelineItem('CAMPAIGN', records.basket)] : [])
  ];
  return rows.sort((a, b) => {
    if (a.eventSequence && b.eventSequence && a.eventSequence !== b.eventSequence) return a.eventSequence - b.eventSequence;
    return eventTime(a) - eventTime(b);
  });
}

function enrichedRecentBaskets(limit = 100) {
  const rows = store.list('baskets', limit);
  const ids = new Set(rows.map(row => String(row.campaignId || row.id || '')));
  const legsByCampaign = new Map([...ids].map(id => [id, []]));
  for (const leg of store.all('legs')) {
    const id = String(leg.campaignId || '');
    if (legsByCampaign.has(id)) legsByCampaign.get(id).push(leg);
  }
  return rows.map(row => {
    const id = String(row.campaignId || row.id || '');
    return { ...row, audit: auditCampaign(row, legsByCampaign.get(id) || []) };
  });
}

function overview() {
  const tickAt = Date.parse(twelveStatus.lastTickAt || '');
  const tickAgeMs = Number.isFinite(tickAt) ? Math.max(0, Date.now() - tickAt) : null;
  return {
    service: config.serviceName, version: config.version, mode: config.mode,
    control, settings,
    config: { primarySymbol: config.primarySymbol, timezone: config.timezone, dataNamespace: config.dataNamespace },
    twelveData: { ...twelveStatus, tickAgeMs, priceFresh: tickAgeMs !== null && tickAgeMs <= config.wsStaleMs, staleAfterMs: config.wsStaleMs },
    mt5: currentMt5(), feature: latestFeature, context: latestContext(),
    engine: {
      name: 'FIXED 8×8 LADDER FLIGHT RECORDER',
      entryPermission: 'MT5 LOCAL — NO QUALITY FILTER',
      twelveDataRole: 'LIVE TELEMETRY AND HISTORY ONLY',
      liveDirection: liveDirection(),
      velocity1Atr: finite(latestFeature?.velocity1Atr), velocity3Atr: finite(latestFeature?.velocity3Atr),
      velocity10Atr: finite(latestFeature?.velocity10Atr), tickExpansion: finite(latestFeature?.tickExpansion),
      acceleration: finite(latestFeature?.acceleration)
    },
    performance: calculatePerformance(store.all('baskets')),
    lab: calculateLab(store.all('baskets'), store.all('legs'), store.all('protections')),
    counts: Object.fromEntries(['scans','signals','baskets','legs','orders','banks','ladders','replay','protections','events'].map(name => [name, store.all(name).length])),
    recentScans: store.list('scans', 100), recentSignals: store.list('signals', 100),
    recentBaskets: enrichedRecentBaskets(100), recentLegs: store.list('legs', 300),
    recentOrders: store.list('orders', 300), recentBanks: store.list('banks', 100),
    recentLadders: store.list('ladders', 50), recentProtections: store.list('protections', 200), recentEvents: store.list('events', 100)
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
    `settings_version=${settings.version}`,
    'fixed_lot=0.01',
    'use_equity_scaling=false',
    'equity_per_001_lot=1000',
    `profit_target_enabled=${settings.profitTargetEnabled ? 'true' : 'false'}`,
    `profit_target_money=${settings.profitTargetMoney.toFixed(2)}`,
    `daily_loss_enabled=${settings.dailyLossEnabled ? 'true' : 'false'}`,
    `daily_loss_money=${settings.dailyLossMoney.toFixed(2)}`,
    `daily_loss_reset_at_ms=${Math.trunc(settings.dailyLossResetAtMs || 0)}`,
    'decision_id=LOCAL_FIXED_LADDER', 'decision_action=LOCAL', 'decision_direction=NONE',
    `server_now_ms=${Date.now()}`,
    'decision_reason=MT5 FIXED 8X8 LADDER CONTROLS ALL ENTRIES'
  ].join('\n');
}
function campaignRecords(campaignId) {
  const id = String(campaignId || '');
  const match = row => String(row.campaignId || '') === id || String(row.id || '') === id;
  const byTime = (a, b) => eventTime(a) - eventTime(b);
  const records = {
    campaignId: id,
    basket: store.all('baskets').find(match) || null,
    ladder: store.all('ladders').find(match) || null,
    legs: store.all('legs').filter(match).sort(byTime),
    protections: store.all('protections').filter(match).sort(byTime),
    orders: store.all('orders').filter(match).sort(byTime),
    replay: store.all('replay').filter(match).sort(byTime),
    banks: store.all('banks').filter(match).sort(byTime)
  };
  return { ...records, audit: auditCampaign(records.basket, records.legs), timeline: campaignTimeline(records) };
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
      if (pathname === '/api/settings' && request.method === 'POST') {
        settings = normaliseSettings(body, true, settings);
        saveSettings(settings);
        const targetText = settings.profitTargetEnabled ? `profit target $${settings.profitTargetMoney.toFixed(2)}` : 'profit target OFF';
        const dailyText = settings.dailyLossEnabled ? `daily loss $${settings.dailyLossMoney.toFixed(2)}` : 'daily loss OFF';
        store.event('settings', `${targetText} | ${dailyText}`, settings);
        return send(response, 200, { ok: true, settings });
      }
      if (pathname === '/api/daily-loss/reset' && request.method === 'POST') {
        settings = normaliseSettings({ dailyLossResetAtMs: Date.now() }, true, settings);
        saveSettings(settings);
        store.event('settings', 'Daily loss counter reset from dashboard', settings);
        return send(response, 200, { ok: true, settings });
      }
      if (pathname === '/api/ea/heartbeat' && request.method === 'POST') {
        mt5 = {
          ...mt5, ...body,
          bid: finite(body.bid, mt5.bid), ask: finite(body.ask, mt5.ask), spreadPoints: finite(body.spreadPoints, mt5.spreadPoints),
          floatingProfit: finite(body.floatingProfit, mt5.floatingProfit), peakBasketProfit: finite(body.peakBasketProfit, mt5.peakBasketProfit),
          positionCount: integer(body.positionCount, mt5.positionCount), pendingCount: integer(body.pendingCount, mt5.pendingCount),
          campaignBuyLegs: integer(body.campaignBuyLegs, mt5.campaignBuyLegs), campaignSellLegs: integer(body.campaignSellLegs, mt5.campaignSellLegs),
          campaignBuyBulletsFired: integer(body.campaignBuyBulletsFired, mt5.campaignBuyBulletsFired),
          campaignSellBulletsFired: integer(body.campaignSellBulletsFired, mt5.campaignSellBulletsFired),
          uniqueBulletsFired: integer(body.uniqueBulletsFired ?? body.positionsOpened, mt5.uniqueBulletsFired),
          heartbeatSequence: integer(body.heartbeatSequence, mt5.heartbeatSequence),
          terminalConnected: String(body.terminalConnected) === 'true' || body.terminalConnected === true,
          algoAllowed: String(body.algoAllowed) === 'true' || body.algoAllowed === true,
          autonomous: String(body.autonomous) === 'true' || body.autonomous === true,
          profitTargetEnabled: String(body.profitTargetEnabled) === 'true' || body.profitTargetEnabled === true,
          dailyLossEnabled: String(body.dailyLossEnabled) === 'true' || body.dailyLossEnabled === true,
          dailyLossMoney: finite(body.dailyLossMoney, mt5.dailyLossMoney),
          dailyLossPnl: finite(body.dailyLossPnl, mt5.dailyLossPnl),
          dailyLossRemaining: finite(body.dailyLossRemaining, mt5.dailyLossRemaining),
          dailyLossBlocked: String(body.dailyLossBlocked) === 'true' || body.dailyLossBlocked === true,
          dailyLossResetAt: finite(body.dailyLossResetAt, mt5.dailyLossResetAt),
          lastSeenAt: nowIso()
        };
        if (integer(body.consumedCommandId) >= command.id && command.id > 0) {
          command.consumedAt = nowIso(); command.result = body.lastCommandResult || body.lastEvent || 'Consumed';
        }
        if (store.all('mt5').length === 0 || Date.now() - Date.parse(store.all('mt5')[0]?.receivedAt || 0) > 10_000) store.append('mt5', mt5, 'mt5');
        return send(response, 200, { ok: true, autonomous: control.autonomous, settings });
      }
      const collectionRoutes = {
        basket: 'baskets', signal: 'signals', leg: 'legs', order: 'orders', bank: 'banks',
        ladder: 'ladders', replay: 'replay', 'bullet-protection': 'protections'
      };
      for (const [route, collection] of Object.entries(collectionRoutes)) {
        if (pathname === `/api/ea/${route}` && request.method === 'POST') {
          const record = route === 'basket' || route === 'ladder' ? store.upsert(collection, body) : store.append(collection, body, route);
          if (route === 'basket') store.event('basket', `${record.side || 'CAMPAIGN'} closed ${finite(record.netProfit).toFixed(2)}`, { campaignId: record.campaignId, exitReason: record.exitReason });
          return send(response, 200, { ok: true, id: record.id });
        }
      }
      if (pathname === '/api/ea/scan' && request.method === 'POST') return send(response, 200, { ok: true, id: store.append('scans', { ...body, source: 'MT5' }, 'scan').id });
      if (pathname === '/api/ea/event' && request.method === 'POST') return send(response, 200, { ok: true, id: store.event(body.type || 'ea', body.message || 'EA event', body.data || null).id });
      const replayMatch = pathname.match(/^\/api\/replay\/(.+)$/);
      if (replayMatch && request.method === 'GET') return send(response, 200, { ok: true, ...campaignRecords(decodeURIComponent(replayMatch[1])) });
      if (pathname === '/api/command' && request.method === 'POST') {
        const action = String(body.action || '').toUpperCase();
        if (action === 'ENABLE_AUTO') { control.autonomous = true; control.emergency = false; store.event('control', 'Autonomous enabled'); return send(response, 200, { ok: true }); }
        if (action === 'DISABLE_AUTO') { control.autonomous = false; store.event('control', 'Autonomous disabled'); return send(response, 200, { ok: true }); }
        if (action === 'EMERGENCY_STOP') { control.autonomous = false; control.emergency = true; return send(response, 200, { ok: true, command: queueCommand(action) }); }
        if (action === 'RESET_EMERGENCY') { control.emergency = false; return send(response, 200, { ok: true, command: queueCommand(action) }); }
        const supported = new Set(['CLOSE_BASKET','PAUSE_EA','RESUME_EA','REBUILD_BRACKET']);
        if (!supported.has(action)) return send(response, 400, { ok: false, error: 'UNSUPPORTED_COMMAND' });
        return send(response, 200, { ok: true, command: queueCommand(action) });
      }
      const match = pathname.match(/^\/api\/export\/(scans|signals|baskets|legs|orders|banks|ladders|replay|protections|events|contexts|mt5)\.csv$/);
      if (match && request.method === 'GET') {
        const collection = match[1];
        return send(response, 200, toCsv([...store.all(collection)].reverse()), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="eve-fixed-ladder-${collection}.csv"` });
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

export { overview, currentMt5, onTick, controlText, campaignRecords };
