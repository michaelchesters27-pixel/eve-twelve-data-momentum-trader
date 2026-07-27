import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveFeatureEngine } from './features.js';
const tf={ready:true,atr:2,direction:'BUY',regime:'BREAKOUT',extensionAtr:0.7,candle:{bodyAtr:0.35,closeLocation:0.9}};
const context={ready:true,atr:2,m1:tf,m5:tf,m15:tf,h1:tf};
test('live feature engine scores a persistent upward burst higher for BUY',()=>{const e=new LiveFeatureEngine();const start=Date.now()-15000;for(let i=0;i<80;i++)e.ingest('XAU/USD',4000+i*0.035,start+i*180);const f=e.snapshot('XAU/USD',context,{fresh:true,bid:4002.76,ask:4002.80,atrM1:2});assert.equal(f.ready,true);assert.ok(f.buy.score>f.sell.score);assert.ok(f.buy.score>60);});
