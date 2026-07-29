import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCampaign, calculateLab, calculatePerformance, normaliseSettings } from './server.js';

test('profit target settings support OFF and any positive custom dollar amount', () => {
  const current = { version: 4, profitTargetEnabled: false, profitTargetMoney: 7 };
  const on = normaliseSettings({ profitTargetEnabled: true, profitTargetMoney: 16 }, true, current);
  assert.deepEqual({ enabled: on.profitTargetEnabled, money: on.profitTargetMoney, version: on.version }, { enabled: true, money: 16, version: 5 });
  const off = normaliseSettings({ profitTargetEnabled: false, profitTargetMoney: 1 }, true, on);
  assert.equal(off.profitTargetEnabled, false);
  assert.equal(off.profitTargetMoney, 1);
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
    { positionsOpened: 2, side: 'MIXED', exitReason: 'NEWEST BULLET FAILED BEFORE HALFWAY - CLOSE FULL CAMPAIGN' }
  ];
  const protections = [{ action: 'BE_ACTIVATED' }, { action: 'BE_ACTIVATED' }];
  const output = calculateLab(baskets, [], protections);
  assert.equal(output.averageBullets, 3);
  assert.equal(output.targetBanks, 1);
  assert.equal(output.newestFailures, 1);
  assert.equal(output.mixedCampaigns, 1);
  assert.equal(output.breakEvenActivations, 2);
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
