import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCampaign, calculateLab, calculatePerformance, ladderOrderSnapshots, normaliseBasketRecord, normaliseSettings } from './server.js';

test('profit target settings support OFF and any positive custom dollar amount', () => {
  const current = { version: 4, profitTargetEnabled: false, profitTargetMoney: 7, dailyLossEnabled: false, dailyLossMoney: 20, dailyLossResetAtMs: 0, basketPeakProtectionEnabled: true, basketPeakActivationMoney: 4, basketPeakGivebackMoney: 1 };
  const on = normaliseSettings({ profitTargetEnabled: true, profitTargetMoney: 16 }, true, current);
  assert.deepEqual({ enabled: on.profitTargetEnabled, money: on.profitTargetMoney, version: on.version }, { enabled: true, money: 16, version: 5 });
  const off = normaliseSettings({ profitTargetEnabled: false, profitTargetMoney: 1 }, true, on);
  assert.equal(off.profitTargetEnabled, false);
  assert.equal(off.profitTargetMoney, 1);
});

test('daily loss settings can be turned on off changed and reset without changing profit target', () => {
  const current = { version: 8, profitTargetEnabled: true, profitTargetMoney: 2, dailyLossEnabled: false, dailyLossMoney: 20, dailyLossResetAtMs: 0, basketPeakProtectionEnabled: true, basketPeakActivationMoney: 4, basketPeakGivebackMoney: 1 };
  const enabled = normaliseSettings({ dailyLossEnabled: true, dailyLossMoney: 35 }, true, current);
  assert.equal(enabled.profitTargetEnabled, true);
  assert.equal(enabled.profitTargetMoney, 2);
  assert.equal(enabled.dailyLossEnabled, true);
  assert.equal(enabled.dailyLossMoney, 35);
  const reset = normaliseSettings({ dailyLossResetAtMs: 1_785_345_678_901 }, true, enabled);
  assert.equal(reset.dailyLossResetAtMs, 1_785_345_678_901);
  assert.equal(reset.dailyLossEnabled, true);
  const disabled = normaliseSettings({ dailyLossEnabled: false }, true, reset);
  assert.equal(disabled.dailyLossEnabled, false);
  assert.equal(disabled.dailyLossMoney, 35);
});

test('legacy v2.50 settings gain the v2.61 audit defaults without losing the target', () => {
  const legacy = { version: 19, profitTargetEnabled: true, profitTargetMoney: 5, dailyLossEnabled: false, dailyLossMoney: 20, dailyLossResetAtMs: 0 };
  const upgraded = normaliseSettings(legacy, false);
  assert.equal(upgraded.profitTargetEnabled, true);
  assert.equal(upgraded.profitTargetMoney, 5);
  assert.equal(upgraded.basketPeakProtectionEnabled, true);
  assert.equal(upgraded.basketPeakActivationMoney, 4);
  assert.equal(upgraded.basketPeakGivebackMoney, 1);
});

test('basket peak protection can be turned on off and configured without changing other controls', () => {
  const current = { version: 3, profitTargetEnabled: true, profitTargetMoney: 5, dailyLossEnabled: false, dailyLossMoney: 20, dailyLossResetAtMs: 0, basketPeakProtectionEnabled: true, basketPeakActivationMoney: 4, basketPeakGivebackMoney: 1 };
  const changed = normaliseSettings({ basketPeakProtectionEnabled: true, basketPeakActivationMoney: 4.25, basketPeakGivebackMoney: 0.8 }, true, current);
  assert.equal(changed.basketPeakProtectionEnabled, true);
  assert.equal(changed.basketPeakActivationMoney, 4.25);
  assert.equal(changed.basketPeakGivebackMoney, 0.8);
  assert.equal(changed.profitTargetMoney, 5);
  const off = normaliseSettings({ basketPeakProtectionEnabled: false }, true, changed);
  assert.equal(off.basketPeakProtectionEnabled, false);
  assert.equal(off.basketPeakActivationMoney, 4.25);
  assert.equal(off.basketPeakGivebackMoney, 0.8);
});

test('campaign performance uses closed campaign P/L', () => {
  const output = calculatePerformance([{ status: 'CLOSED', netProfit: 3 }, { status: 'CLOSED', netProfit: -1 }, { status: 'OPEN', netProfit: 99 }]);
  assert.equal(output.baskets, 2);
  assert.equal(output.netProfit, 2);
  assert.equal(output.profitFactor, 3);
});

test('campaign laboratory counts targets, newest-bullet exits and BE activations', () => {
  const baskets = [
    { positionsOpened: 4, side: 'BUY', exitReason: 'CAMPAIGN PROFIT TARGET 7.00 REACHED' },
    { positionsOpened: 2, side: 'MIXED', exitReason: 'NEWEST BULLET FAILED BEFORE HALFWAY - CLOSE FULL CAMPAIGN' },
    { positionsOpened: 1, side: 'BUY', exitReason: 'FIRST BULLET QUICK CUT 0.750 ADVERSE - CLOSE FULL CAMPAIGN' },
    { positionsOpened: 2, side: 'SELL', exitReason: 'BASKET PEAK PROTECTION FLOOR 2.73 AFTER 3.73 PEAK' }
  ];
  const protections = [{ action: 'BE_ACTIVATED' }, { action: 'BE_ACTIVATED' }];
  const output = calculateLab(baskets, [], protections);
  assert.equal(output.averageBullets, 2.25);
  assert.equal(output.targetBanks, 1);
  assert.equal(output.newestFailures, 1);
  assert.equal(output.firstBulletQuickCuts, 1);
  assert.equal(output.mixedCampaigns, 1);
  assert.equal(output.breakEvenActivations, 2);
  assert.equal(output.basketPeakProtectionExits, 1);
});

test('campaign audit catches the exact mismatch seen in v2.20', () => {
  const basket = { uniqueBulletsFired: 2 };
  const legs = [
    { action: 'OPEN', positionId: 'A' },
    { action: 'CLOSE', positionId: 'A' }
  ];
  const output = auditCampaign(basket, legs);
  assert.equal(output.reportedBullets, 2);
  assert.equal(output.uniqueOpenBullets, 1);
  assert.equal(output.status, 'COUNT MISMATCH');
});

test('campaign audit is consistent when unique OPEN and CLOSE records agree', () => {
  const basket = { uniqueBulletsFired: 2 };
  const legs = [
    { action: 'OPEN', positionId: 'A' }, { action: 'OPEN', positionId: 'B' },
    { action: 'CLOSE', positionId: 'A' }, { action: 'CLOSE', positionId: 'B' }
  ];
  const output = auditCampaign(basket, legs);
  assert.equal(output.status, 'CONSISTENT');
  assert.equal(output.closedUniqueBullets, 2);
});


test('basket normalisation prevents realised profit exceeding recorded peak', () => {
  const output = normaliseBasketRecord({ id: 'C1', campaignId: 'C1', netProfit: 2.4, peakBasketProfit: 1.1, profitGiveback: 99 });
  assert.equal(output.peakBasketProfit, 2.4);
  assert.equal(output.profitGiveback, 0);
});

test('ladder report guarantees sixteen deterministic placement records', () => {
  const snapshots = ladderOrderSnapshots({
    id: 'C2', campaignId: 'C2', account: 1, symbol: 'XAUUSD', version: '2.61', at: 10,
    lot: 0.01, eventSequence: 20,
    buyPrices: [1,2,3,4,5,6,7,8], sellPrices: [-1,-2,-3,-4,-5,-6,-7,-8]
  });
  assert.equal(snapshots.length, 16);
  assert.equal(new Set(snapshots.map(row => row.id)).size, 16);
  assert.equal(snapshots[0].id, 'C2-BUY_STOP-01-PLACED');
  assert.equal(snapshots[15].id, 'C2-SELL_STOP-08-PLACED');
});
