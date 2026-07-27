import test from 'node:test';
import assert from 'node:assert/strict';
import { TwelveDataClient } from './twelve-data.js';

test('price message publishes a fresh receipt timestamp before scoring the tick', () => {
  const order = [];
  let status;
  let tick;
  const client = new TwelveDataClient({
    onStatus: value => { status = value; order.push('status'); },
    onTick: value => { tick = value; order.push('tick'); }
  });
  const before = Date.now();
  client.handleWsMessage(JSON.stringify({ event: 'price', symbol: 'XAU/USD', price: '4000.25', timestamp: 1_700_000_000 }));
  const after = Date.now();
  const receipt = Date.parse(status.lastTickAt);
  assert.deepEqual(order, ['status', 'tick']);
  assert.ok(receipt >= before && receipt <= after);
  assert.equal(Date.parse(status.lastMarketTickAt), 1_700_000_000_000);
  assert.equal(tick.receivedAt, receipt);
  assert.equal(tick.timestamp, 1_700_000_000_000);
});
