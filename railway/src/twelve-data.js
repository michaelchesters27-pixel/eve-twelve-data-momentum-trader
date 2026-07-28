import { allWsSymbols, config } from './config.js';
import { computeTimeframeContext } from './context.js';
import { finite, normalizeTimestamp, nowIso } from './utils.js';

const INTERVALS = [
  { interval: '1min', unitMs: 60_000, outputsize: 120, closeDelayMs: 2_500, bootstrapDelayMs: 1_000 },
  { interval: '5min', unitMs: 300_000, outputsize: 120, closeDelayMs: 5_000, bootstrapDelayMs: 6_000 },
  { interval: '15min', unitMs: 900_000, outputsize: 120, closeDelayMs: 8_000, bootstrapDelayMs: 11_000 },
  { interval: '1h', unitMs: 3_600_000, outputsize: 120, closeDelayMs: 12_000, bootstrapDelayMs: 16_000 }
];

export function closedValues(values, intervalMs, now = Date.now(), graceMs = 1_500) {
  return (values || []).filter(row => {
    const openTime = Date.parse(String(row.datetime || '').replace(' ', 'T') + (String(row.datetime || '').includes('Z') ? '' : 'Z'));
    return Number.isFinite(openTime) && openTime + intervalMs <= now - graceMs;
  });
}

function nextClosedBoundaryDelay(unitMs, closeDelayMs, now = Date.now()) {
  const next = Math.floor(now / unitMs) * unitMs + unitMs + closeDelayMs;
  return Math.max(250, next - now);
}

export class TwelveDataClient {
  constructor({ onTick = () => {}, onContext = () => {}, onStatus = () => {} } = {}) {
    this.onTick = onTick;
    this.onContext = onContext;
    this.onStatus = onStatus;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.pollTimers = new Map();
    this.inFlight = new Set();
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.status = {
      ws: 'OFFLINE', rest: 'WARMING', subscribedSymbols: [], lastTickAt: null,
      lastMarketTickAt: null, lastRestAt: null, lastError: null, restCalls: 0, wsMessages: 0,
      restCallsByInterval: {}, nextRefreshAt: {}
    };
  }
  start() {
    if (!config.twelveDataApiKey) {
      this.status.ws = 'NO_API_KEY';
      this.status.rest = 'NO_API_KEY';
      this.status.lastError = 'TWELVE_DATA_API_KEY is missing';
      this.emitStatus();
      return;
    }
    this.connectWs();
    this.startRestPolling();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    for (const timer of this.pollTimers.values()) clearTimeout(timer);
    this.pollTimers.clear();
    try { this.ws?.close(); } catch {}
  }
  emitStatus() { this.onStatus({ ...this.status, restCallsByInterval: { ...this.status.restCallsByInterval }, nextRefreshAt: { ...this.status.nextRefreshAt } }); }
  connectWs() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(config.twelveDataApiKey)}`;
    this.status.ws = 'CONNECTING';
    this.emitStatus();
    try {
      this.ws = new WebSocket(url);
      this.ws.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        const symbols = allWsSymbols();
        this.status.ws = 'CONNECTED';
        this.status.subscribedSymbols = symbols;
        this.ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: symbols.join(',') } }));
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ action: 'heartbeat' }));
        }, 10_000);
        this.emitStatus();
      });
      this.ws.addEventListener('message', event => this.handleWsMessage(event.data));
      this.ws.addEventListener('error', () => {
        this.status.lastError = 'WebSocket transport error';
        this.emitStatus();
      });
      this.ws.addEventListener('close', event => {
        this.status.ws = 'OFFLINE';
        this.status.lastError = `WebSocket closed ${event.code || ''} ${event.reason || ''}`.trim();
        this.emitStatus();
        this.scheduleReconnect();
      });
    } catch (error) {
      this.status.ws = 'OFFLINE';
      this.status.lastError = error.message;
      this.emitStatus();
      this.scheduleReconnect();
    }
  }
  scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(6, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(() => this.connectWs(), delay);
  }
  handleWsMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    this.status.wsMessages++;
    if (message.event === 'price' || message.price !== undefined) {
      const symbol = String(message.symbol || message.meta?.symbol || '').trim();
      const price = finite(message.price, NaN);
      if (!symbol || !Number.isFinite(price) || price <= 0) return;
      const receivedAt = Date.now();
      const marketTimestamp = normalizeTimestamp(message.timestamp || message.datetime || receivedAt);
      this.status.lastTickAt = new Date(receivedAt).toISOString();
      this.status.lastMarketTickAt = new Date(marketTimestamp).toISOString();
      this.status.ws = 'CONNECTED';
      this.status.lastError = null;
      this.emitStatus();
      this.onTick({ source: 'TWELVE_DATA_WS', symbol, price, timestamp: marketTimestamp, receivedAt, raw: message });
      return;
    }
    if (message.status === 'error' || Number(message.code) >= 400) {
      this.status.lastError = message.message || JSON.stringify(message);
      this.emitStatus();
    }
  }
  startRestPolling() {
    for (const task of INTERVALS) {
      const bootstrap = setTimeout(async () => {
        await this.fetchContext(config.primarySymbol, task);
        this.scheduleNext(task);
      }, task.bootstrapDelayMs);
      this.pollTimers.set(`bootstrap:${task.interval}`, bootstrap);
    }
  }
  scheduleNext(task) {
    if (this.stopped) return;
    const delay = nextClosedBoundaryDelay(task.unitMs, task.closeDelayMs);
    this.status.nextRefreshAt[task.interval] = new Date(Date.now() + delay).toISOString();
    this.emitStatus();
    const timer = setTimeout(async () => {
      await this.fetchContext(config.primarySymbol, task);
      this.scheduleNext(task);
    }, delay);
    this.pollTimers.set(task.interval, timer);
  }
  async fetchContext(symbol, task) {
    const key = `${symbol}:${task.interval}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    const params = new URLSearchParams({
      symbol, interval: task.interval, outputsize: String(task.outputsize), order: 'asc', timezone: 'UTC'
    });
    const url = `https://api.twelvedata.com/time_series?${params}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `apikey ${config.twelveDataApiKey}` },
        signal: AbortSignal.timeout(12_000)
      });
      this.status.restCalls++;
      this.status.restCallsByInterval[task.interval] = (this.status.restCallsByInterval[task.interval] || 0) + 1;
      const body = await response.json();
      if (!response.ok || body.status === 'error') throw new Error(body.message || `HTTP ${response.status}`);
      const completeBars = closedValues(body.values || [], task.unitMs);
      const context = computeTimeframeContext(completeBars, task.interval);
      this.status.rest = context.ready ? 'READY' : 'WARMING';
      this.status.lastRestAt = nowIso();
      this.status.lastError = null;
      this.onContext({
        source: 'TWELVE_DATA_REST', symbol, interval: task.interval, context,
        meta: body.meta || null, capturedAt: nowIso(), completeBars: completeBars.length
      });
      this.emitStatus();
    } catch (error) {
      this.status.rest = 'ERROR';
      this.status.lastError = `${task.interval}: ${error.message}`;
      this.emitStatus();
    } finally {
      this.inFlight.delete(key);
    }
  }
}
