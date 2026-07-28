import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveFeatureEngine } from './features.js';
const tf={ready:true,atr:2,direction:'BUY',regime:'BREAKOUT',extensionAtr:0.7,breakout:'UP',closedBreakoutConfirmed:true,candle:{bodyAtr:0.35,closeLocation:0.9}};
const context={ready:true,atr:2,m1:tf,m5:tf,m15:tf,h1:tf};

test('live feature engine requires and rewards a sustained upward micro-breakout',()=>{
  const e=new LiveFeatureEngine();
  const start=Date.now()-15_000;
  for(let i=0;i<70;i++) e.ingest('XAU/USD',4000+i*0.004,start+i*180);
  for(let i=70;i<85;i++) e.ingest('XAU/USD',4000.28+(i-70)*0.02,start+i*180);
  const f=e.snapshot('XAU/USD',context,{fresh:true,bid:4000.56,ask:4000.60,atrM1:2});
  assert.equal(f.ready,true);
  assert.equal(f.breakoutBuy,true);
  assert.ok(f.breakoutBuyDistanceAtr>=0.015);
  assert.ok(f.buy.score>f.sell.score);
});

test('score is capped below entry threshold when no breakout exists',()=>{
  const e=new LiveFeatureEngine();
  const start=Date.now()-15_000;
  for(let i=0;i<90;i++) e.ingest('XAU/USD',4000+Math.sin(i/3)*0.03,start+i*160);
  const f=e.snapshot('XAU/USD',context,{fresh:true,bid:3999.98,ask:4000.02,atrM1:2});
  assert.equal(f.breakoutBuy,false);
  assert.ok(f.buy.score<=69);
});


test('received quotes start scanning without waiting for a full breakout reference window',()=>{
  const e=new LiveFeatureEngine();
  const start=Date.now()-2_000;
  for(let i=0;i<4;i++) e.ingest('XAU/USD',4000+i*0.001,start+i*550);
  const f=e.snapshot('XAU/USD',context,{fresh:true,bid:3999.98,ask:4000.02,atrM1:2});
  assert.equal(f.ready,true);
  assert.equal(f.tickCount,4);
  assert.equal(f.breakoutReferenceReady,false);
  assert.ok(f.buy.score<80);
});

test('sparse received quotes build a fallback breakout reference',()=>{
  const e=new LiveFeatureEngine();
  const start=Date.now()-16_000;
  [4000.00,4000.01,4000.02,4000.01,4000.00,4000.08].forEach((price,index)=>e.ingest('XAU/USD',price,start+index*3_000));
  const f=e.snapshot('XAU/USD',context,{fresh:true,bid:4000.06,ask:4000.10,atrM1:2});
  assert.equal(f.ready,true);
  assert.equal(f.breakoutReferenceReady,true);
  assert.equal(f.breakoutBuy,true);
});
