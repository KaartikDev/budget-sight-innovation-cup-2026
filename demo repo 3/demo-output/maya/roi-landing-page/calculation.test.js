import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateHoursSaved } from './calculation.js';

test('estimates monthly hours using complete runs only', () => {
  assert.equal(estimateHoursSaved(1200, 15, 8), 276);
});

test('returns zero when every run is incomplete', () => {
  assert.equal(estimateHoursSaved(1200, 15, 100), 0);
});

test('rejects invalid values and rates above 100 percent', () => {
  assert.throws(() => estimateHoursSaved(-1, 15, 8), RangeError);
  assert.throws(() => estimateHoursSaved(10, Infinity, 8), RangeError);
  assert.throws(() => estimateHoursSaved(10, 15, 101), RangeError);
});
