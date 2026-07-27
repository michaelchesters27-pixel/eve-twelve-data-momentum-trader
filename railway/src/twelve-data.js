import { allWsSymbols, config } from './config.js';
import { computeTimeframeContext } from './context.js';
import { finite, normalizeTimestamp, nowIso } from './utils.js';

const INTERVALS = [
  { interval: '1min', everyMs: 60_000, outputsize: 240, stagger: 4_000 },
  { interval: '5min', everyMs: 300_000, outputsize: 240, stagger: 12_000 },
  { interval: '15min', everyMs: 900_000, outputsize: 240, stagger: 22_000 },
  { interval: '1h', everyMs: 3_600_000, outputsize: 240, stagger: 32_000 }
];

export class TwelveDataClient {
  constructor({ onTick = () => {}, onContext = () => {}, onStatus = () => {} } = {}) {
    this.onTick = onTick;
    this.onContext = onContext;
    this.onStatus = onStatus;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.pollTimers = [];
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.status = {
      ws: 'OFFLINE', rest: 'WARMING', subscribedSymbols: [], lastTickAt: null,
      lastRestAt: null, lastError: null, restCalls: 0, wsMessages: 0
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
    this.pollTimers.forEach(clearInterval);
    try { this.ws?.close(); } catch {}
  }
  emitStatus() { this.onStatus({ ...this.status }); }
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
      const timestamp = normalizeTimestamp(message.timestamp || message.datetime || Date.now());
      this.status.lastTickAt = new Date(timestamp).toISOString();
      this.status.ws = 'CONNECTED';
      this.onTick({ source: 'TWELVE_DATA_WS', symbol, price, timestamp, raw: message });
      return;
    }
    if (message.status === 'error' || Number(message.code) >= 400) {
      this.status.lastError = message.message || JSON.stringify(message);
      this.emitStatus();
    }
  }
  startRestPolling() {
    for (const task of INTERVALS) {
      setTimeout(() => {
        void this.fetchContext(config.primarySymbol, task);
        const timer = setInterval(() => void this.fetchContext(config.primarySymbol, task), task.everyMs);
        this.pollTimers.push(timer);
      }, task.stagger);
    }
  }
  async fetchContext(symbol, task) {
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
      const body = await response.json();
      if (!response.ok || body.status === 'error') throw new Error(body.message || `HTTP ${response.status}`);
      const context = computeTimeframeContext(body.values || [], task.interval);
      this.status.rest = context.ready ? 'READY' : 'WARMING';
      this.status.lastRestAt = nowIso();
      this.onContext({ source: 'TWELVE_DATA_REST', symbol, interval: task.interval, context, meta: body.meta || null, capturedAt: nowIso() });
      this.emitStatus();
    } catch (error) {
      this.status.rest = 'ERROR';
      this.status.lastError = `${task.interval}: ${error.message}`;
      this.emitStatus();
    }
  }
}
