import assert from 'node:assert/strict';
import { calculateCost } from './app.js';

const sample = calculateCost({ uncached: 12_000, cached: 8_000, output: 3_000, inputRate: 3, cacheRate: 0.3, outputRate: 15 });
assert.equal(sample.input, 0.036);
assert.equal(sample.cache, 0.0024);
assert.equal(sample.output, 0.045);
assert.ok(Math.abs(sample.total - 0.0834) < 1e-12);
assert.throws(() => calculateCost({ uncached: -1, cached: 0, output: 0, inputRate: 1, cacheRate: 1, outputRate: 1 }), RangeError);
console.log('Cost calculation smoke test passed.');
