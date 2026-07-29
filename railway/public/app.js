const $ = id => document.getElementById(id);
let token = localStorage.getItem('eve_td_token') || '';
$('token').value = token;
const money = n => `${Number(n) >= 0 ? '$' : '-$'}${Math.abs(Number(n) || 0).toFixed(2)}`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = n => Number(n) > 0 ? 'positive' : Number(n) < 0 ? 'negative' : '';
const timeValue = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const formatTime = value => {
  const raw = timeValue(value);
  return raw ? new Date(raw).toLocaleString('en-GB') : '—';
};
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Bot-Token': token, ...options.headers } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}
function row(key, value) { return `<div class="row"><span>${esc(key)}</span><b>${esc(value)}</b></div>`; }
function render(state) {
  $('version').textContent = `v${state.version}`;
  $('mode').textContent = state.mode;
  const td = state.twelveData || {};
  $('twelve').textContent = `${td.ws || 'WARMING'} / ${td.rest || 'WARMING'}`;
  $('twelve-detail').textContent = td.lastError || (td.tickAgeMs == null ? 'Waiting for price' : `${td.priceFresh ? 'FRESH' : 'STALE'} · ${(td.tickAgeMs / 1000).toFixed(1)}s old`);
  const mt5 = state.mt5 || {};
  $('mt5').textContent = mt5.fresh ? 'ONLINE' : 'OFFLINE';
  $('mt5').className = mt5.fresh ? 'positive' : 'negative';
  $('mt5-detail').textContent = mt5.fresh
    ? `${mt5.symbol || ''} · heartbeat #${mt5.heartbeatSequence || 0} · ${(Number(mt5.heartbeatAgeMs || 0) / 1000).toFixed(1)}s old · ${mt5.lastHttpStatus || 'syncing'}`
    : mt5.lastSeenAt ? `Last heartbeat ${(Number(mt5.heartbeatAgeMs || 0) / 1000).toFixed(1)}s ago · ${mt5.lastHttpStatus || 'no status'}` : 'Waiting for first heartbeat';
  $('auto').textContent = state.control.autonomous && !state.control.emergency ? 'ON' : 'OFF';
  $('auto').className = state.control.autonomous && !state.control.emergency ? 'positive' : 'negative';
  $('engine-state').textContent = mt5.engineState || 'WAITING FOR MT5';
  $('reason').textContent = mt5.lastEvent || 'Fixed ladder waiting to fire';
  $('positions').textContent = Number(mt5.positionCount || 0);
  $('pending').textContent = Number(mt5.pendingCount || 0);
  $('floating').textContent = money(mt5.floatingProfit || 0);
  $('floating').className = cls(mt5.floatingProfit);

  const p = state.performance || {};
  $('baskets').textContent = p.baskets || 0;
  $('wins').textContent = `${p.wins || 0} wins / ${p.losses || 0} losses`;
  $('net').textContent = money(p.netProfit); $('net').className = cls(p.netProfit);
  $('average').textContent = `${money(p.averageBasket)} average`;
  $('pf').textContent = Number(p.profitFactor || 0).toFixed(2);
  $('winrate').textContent = `${p.winRate || 0}% win rate`;
  $('worst').textContent = money(p.worstBasket); $('worst').className = cls(p.worstBasket);
  $('best').textContent = `Best ${money(p.bestBasket)}`;

  const settings = state.settings || {};
  $('target-enabled').checked = Boolean(settings.profitTargetEnabled);
  $('target-money').value = Number(settings.profitTargetMoney || 7).toFixed(2);
  $('target-status').textContent = settings.profitTargetEnabled ? `ON — bank ${money(settings.profitTargetMoney)} then rearm` : 'OFF — natural sentinel mode';

  $('execution').innerHTML = row('Campaign ID', mt5.campaignId || 'Waiting to start') +
    row('Campaign side', mt5.campaignCurrentSide || 'NONE') + row('Unique bullets fired', mt5.uniqueBulletsFired || 0) +
    row('BUY bullets fired', mt5.campaignBuyBulletsFired || 0) + row('SELL bullets fired', mt5.campaignSellBulletsFired || 0) +
    row('Live BUY positions', mt5.campaignBuyLegs || 0) + row('Live SELL positions', mt5.campaignSellLegs || 0) +
    row('Positions', mt5.positionCount || 0) + row('Pending orders', mt5.pendingCount || 0) + row('Anchor', Number(mt5.ladderAnchor || 0).toFixed(3)) +
    row('Grid spacing', Number(mt5.gridSpacing || 3).toFixed(3)) + row('Initial fallback', Number(mt5.fallbackDistance || 2).toFixed(3)) +
    row('Halfway BE trigger', Number(mt5.beTriggerPrice || 1.5).toFixed(3)) + row('BE + costs buffer', Number(mt5.beBufferPrice || 0.15).toFixed(3)) +
    row('Newest bullet', mt5.newestTicket || '—') + row('Floating P/L', money(mt5.floatingProfit || 0)) + row('Peak P/L', money(mt5.peakBasketProfit || 0));

  const engine = state.engine || {}, context = state.context || {};
  $('telemetry').innerHTML = row('Role', 'Telemetry only — never permission') + row('Live direction', engine.liveDirection || 'MIXED') +
    row('Velocity 1s', `${Number(engine.velocity1Atr || 0).toFixed(4)} ATR`) + row('Velocity 3s', `${Number(engine.velocity3Atr || 0).toFixed(4)} ATR`) +
    row('Velocity 10s', `${Number(engine.velocity10Atr || 0).toFixed(4)} ATR`) + row('Tick expansion', `${Number(engine.tickExpansion || 0).toFixed(2)}x`) +
    row('M1/M5/M15/H1', `${context.m1?.direction || '—'}/${context.m5?.direction || '—'}/${context.m15?.direction || '—'}/${context.h1?.direction || '—'}`) +
    row('History namespace', state.config?.dataNamespace || 'v220');

  const lab = state.lab || {};
  $('lab-bullets').textContent = Number(lab.averageBullets || 0).toFixed(2);
  $('lab-be').textContent = lab.breakEvenActivations || 0;
  $('lab-target').textContent = lab.targetBanks || 0;
  $('lab-target-rate').textContent = `${lab.targetBankRate || 0}% of campaigns`;
  $('lab-fails').textContent = lab.newestFailures || 0;
  $('lab-fail-rate').textContent = `${lab.newestFailureRate || 0}% of campaigns`;

  const baskets = state.recentBaskets || [];
  $('basket-rows').innerHTML = baskets.map(item => `<tr>
    <td>${esc(formatTime(item.exitTime || item.receivedAt))}</td><td class="mono">${esc(item.campaignId || item.id)}</td><td>${esc(item.side || '—')}</td>
    <td>${esc(item.uniqueBulletsFired ?? item.positionsOpened ?? 0)}</td><td>${esc(item.audit?.status || '—')}</td><td class="${cls(item.netProfit)}">${money(item.netProfit)}</td><td>${money(item.peakBasketProfit)}</td>
    <td>${money(item.profitGiveback)}</td><td>${item.profitTargetEnabled ? money(item.profitTargetMoney) : 'OFF'}</td><td class="reason">${esc(item.exitReason || '')}</td>
  </tr>`).join('');
  const selected = $('campaign-select').value;
  $('campaign-select').innerHTML = `<option value="">Choose a campaign</option>${baskets.map(item => `<option value="${esc(item.campaignId || item.id)}">${esc(formatTime(item.exitTime))} · ${esc(item.side)} · ${money(item.netProfit)}</option>`).join('')}`;
  if (selected && baskets.some(item => String(item.campaignId || item.id) === selected)) $('campaign-select').value = selected;

  $('scans').innerHTML = (state.recentScans || []).slice(0, 100).map(item => `<tr><td>${esc(formatTime(item.at || item.receivedAt))}</td><td>${esc(item.source || 'MT5')}</td><td>${esc(item.engineState || item.liveDirection || '—')}</td><td>${esc(item.positions ?? mt5.positionCount ?? 0)}</td><td>${esc(item.pending ?? mt5.pendingCount ?? 0)}</td><td class="reason">${esc(item.lastEvent || item.blockReason || item.note || '')}</td></tr>`).join('');
}
async function refresh() {
  if (!token) return;
  try { render(await api('/api/state')); }
  catch (error) { $('reason').textContent = error.message; }
}
$('connect').addEventListener('click', () => { token = $('token').value.trim(); localStorage.setItem('eve_td_token', token); refresh(); });
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  if (!confirm(`Send ${button.dataset.action}?`)) return;
  await api('/api/command', { method: 'POST', body: JSON.stringify({ action: button.dataset.action }) });
  refresh();
}));
document.querySelectorAll('[data-export]').forEach(link => link.addEventListener('click', () => {
  if (!token) return;
  window.open(`/api/export/${link.dataset.export}.csv?token=${encodeURIComponent(token)}`, '_blank');
}));
document.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => {
  $('target-enabled').checked = true;
  $('target-money').value = Number(button.dataset.target).toFixed(2);
}));
$('apply-target').addEventListener('click', async () => {
  const payload = { profitTargetEnabled: $('target-enabled').checked, profitTargetMoney: Number($('target-money').value) };
  if (!Number.isFinite(payload.profitTargetMoney) || payload.profitTargetMoney < 0.01) return alert('Enter a target of at least $0.01.');
  const result = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
  $('target-status').textContent = result.settings.profitTargetEnabled ? `ON — bank ${money(result.settings.profitTargetMoney)} then rearm` : 'OFF — natural sentinel mode';
  refresh();
});
$('load-replay').addEventListener('click', async () => {
  const id = $('campaign-select').value;
  if (!id) return;
  const result = await api(`/api/replay/${encodeURIComponent(id)}`);
  const basket = result.basket || {};
  const audit = result.audit || {};
  $('replay-summary').innerHTML = `<b>${esc(id)}</b> · ${esc(basket.side || '—')} · ${esc(basket.uniqueBulletsFired ?? basket.positionsOpened ?? 0)} bullets · ${money(basket.netProfit)} · <b>${esc(audit.status || 'NOT AUDITED')}</b> · ${esc(basket.exitReason || '')}`;
  $('timeline-rows').innerHTML = (result.timeline || []).map(item => `<tr><td>${esc(item.eventSequence || '—')}</td><td>${esc(formatTime(item.at))}</td><td>${esc(item.type || '')}</td><td>${esc(item.action || '')}</td><td>${esc(item.side || '')}</td><td>${esc(item.bulletNumber || '')}</td><td>${item.price ? Number(item.price).toFixed(3) : '—'}</td><td class="${cls(item.netProfit)}">${money(item.netProfit)}</td><td class="reason">${esc(item.reason || '')}</td></tr>`).join('');
  $('replay-rows').innerHTML = (result.replay || []).map(item => `<tr><td>${esc(formatTime(item.at || item.receivedAt))}</td><td>${Number(item.bid || 0).toFixed(3)}</td><td>${Number(item.ask || 0).toFixed(3)}</td><td>${esc(item.positions || 0)}</td><td>${esc(item.pending || 0)}</td><td class="${cls(item.floatingProfit)}">${money(item.floatingProfit)}</td><td>${money(item.peakProfit)}</td><td>${esc(item.newestTicket || '—')}</td><td class="reason">${esc(item.lastEvent || '')}</td></tr>`).join('');
});
setInterval(refresh, 2000);
refresh();
