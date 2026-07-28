import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveFeatureEngine, roundedTelemetry } from './features.js';

const context = { ready: true, atr: 2, m1: { ready: true, atr: 2 } };

test('live telemetry reports sustained upward movement without granting trade permission', () => {
  const engine = new LiveFeatureEngine();
  const start = Date.now() - 15_000;
  for (let index = 0; index < 80; index++) engine.ingest('XAU/USD', 4000 + index * 0.01, start + index * 180);
  const feature = engine.snapshot('XAU/USD', context, { atrM1: 2 });
  assert.equal(feature.ready, true);
  assert.ok(feature.velocity1Atr > 0);
  assert.ok(feature.velocity3Atr > 0);
  assert.equal(feature.liveDirection, 'UP');
  assert.match(feature.note, /Telemetry only/);
});

test('repeated quotes are retained as arrival-rate telemetry', () => {
  const engine = new LiveFeatureEngine();
  const start = Date.now() - 2_000;
  for (let index = 0; index < 5; index++) engine.ingest('XAU/USD', 4000, start + index * 500);
  const feature = engine.snapshot('XAU/USD', context, { atrM1: 2 });
  assert.equal(feature.tickCount, 5);
  assert.equal(feature.ready, true);
  assert.equal(feature.liveDirection, 'MIXED');
});

test('rounded telemetry exposes only descriptive live measurements', () => {
  const output = roundedTelemetry({ velocity1Atr: 0.0123456, velocity3Atr: -0.1, tickExpansion: 2.3456, acceleration: 1.2345, efficiency: 0.8765 });
  assert.deepEqual(output, {
    velocity1Atr: 0.01235,
    velocity3Atr: -0.1,
    velocity10Atr: 0,
    tickExpansion: 2.346,
    acceleration: 1.235,
    efficiency: 0.877
  });
});
