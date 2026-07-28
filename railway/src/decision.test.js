import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAssessment } from './decision.js';

const score={
  buy:{score:92,components:{breakout:18},metrics:{breakout:true,breakoutDistanceAtr:.06,persistence:.82}},
  sell:{score:12,components:{breakout:0},metrics:{breakout:false,breakoutDistanceAtr:0,persistence:.18}}
};
const context={
  ready:true,atr:2,regime:'BREAKOUT',
  m1:{ready:true,regime:'BREAKOUT',extensionAtr:.8,breakout:'UP',closedBreakoutConfirmed:true},
  m5:{direction:'BUY'},m15:{direction:'BUY'},h1:{direction:'BUY'}
};
const feature={price:4000,spreadAtr:.05,efficiency:.7,tickExpansion:1.8,breakoutReferenceReady:true};
const mt5={fresh:true,bid:3999.98,ask:4000.02,atrM1:2,algoAllowed:true,terminalConnected:true};
const twelveStatus={lastTickAt:new Date().toISOString()};

test('confirmed high quality breakout becomes eligible and allows continuation',()=>{
  const a=chooseAssessment({score,feature,context,mt5,twelveStatus,now:Date.now()});
  assert.equal(a.best.direction,'BUY');
  assert.equal(a.best.eligible,true);
  assert.equal(a.best.addAllowed,true);
});

test('high score without a real breakout is blocked',()=>{
  const noBreakout={...score,buy:{...score.buy,score:95,metrics:{...score.buy.metrics,breakout:false,breakoutDistanceAtr:0}}};
  const a=chooseAssessment({score:noBreakout,feature,context,mt5,twelveStatus,now:Date.now()});
  assert.equal(a.buy.eligible,false);
  assert.ok(a.buy.hardBlocks.includes('NO_CONFIRMED_BUY_BREAKOUT'));
});

test('compression is blocked until a closed expansion exists',()=>{
  const compression={...context,regime:'COMPRESSION',m1:{...context.m1,regime:'COMPRESSION',breakout:'NONE',closedBreakoutConfirmed:false}};
  const a=chooseAssessment({score,feature,context:compression,mt5,twelveStatus,now:Date.now()});
  assert.equal(a.buy.eligible,false);
  assert.ok(a.buy.hardBlocks.includes('COMPRESSION_WAIT_FOR_CLOSED_EXPANSION'));
});

test('wide spread blocks the burst',()=>{
  const a=chooseAssessment({score,feature:{...feature,spreadAtr:.5},context,mt5,twelveStatus,now:Date.now()});
  assert.equal(a.buy.eligible,false);
  assert.ok(a.buy.hardBlocks.some(x=>x.startsWith('SPREAD_')));
});

test('stale Twelve Data receipt timestamp blocks entry',()=>{
  const now=Date.now();
  const a=chooseAssessment({score,feature,context,mt5,twelveStatus:{lastTickAt:new Date(now-20_000).toISOString()},now});
  assert.equal(a.buy.eligible,false);
  assert.ok(a.buy.hardBlocks.includes('TWELVE_DATA_PRICE_STALE'));
  assert.equal(a.buy.twelvePriceFresh,false);
  assert.ok(a.buy.twelveTickAgeMs>=20_000);
});


test('incomplete breakout reference blocks trade but still permits assessment',()=>{
  const a=chooseAssessment({score,feature:{...feature,breakoutReferenceReady:false},context,mt5,twelveStatus,now:Date.now()});
  assert.equal(a.buy.eligible,false);
  assert.ok(a.buy.hardBlocks.includes('BREAKOUT_REFERENCE_WARMING'));
});
