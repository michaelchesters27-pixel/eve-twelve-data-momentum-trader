import test from 'node:test';
import assert from 'node:assert/strict';
import { combinedContext, computeTimeframeContext } from './context.js';
function bars(direction=1){let p=4000;return Array.from({length:80},(_,i)=>{const o=p;p+=direction*0.12+(i%4===0?0.03:-0.01);return {datetime:new Date(1700000000000+i*60000).toISOString(),open:o,high:Math.max(o,p)+0.08,low:Math.min(o,p)-0.08,close:p,volume:100+i};});}
test('timeframe context identifies directional series',()=>{const c=computeTimeframeContext(bars(1),'1min');assert.equal(c.ready,true);assert.equal(c.direction,'BUY');assert.ok(c.atr>0);});
test('combined context requires four timeframes',()=>{const c=computeTimeframeContext(bars(1),'1min');const all={'XAU/USD':{'1min':c,'5min':{...c,interval:'5min'},'15min':{...c,interval:'15min'},'1h':{...c,interval:'1h'}}};assert.equal(combinedContext(all,'XAU/USD').ready,true);});
