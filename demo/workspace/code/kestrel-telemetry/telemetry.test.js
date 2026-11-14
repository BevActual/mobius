import { test } from 'node:test';
import assert from 'node:assert/strict';
import { average, kmh, packTemperature } from './telemetry.js';

test('kmh', () => {
  assert.equal(kmh(10), 36);
});

test('pack temperature', () => {
  assert.equal(packTemperature(650), 25);
});

test('average', () => {
  assert.equal(average([1, 2, 3]), 2);
  assert.equal(average([]), 0);
});
