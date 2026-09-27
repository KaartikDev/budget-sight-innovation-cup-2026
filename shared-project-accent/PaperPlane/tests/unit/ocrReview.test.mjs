import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateKey, reviewEntry, reviewErrors, saveReviewRows } from '../../lib/ocrReview.ts';

test('OCR rows stay editable and missing required fields are flagged', () => {
  const entry = reviewEntry({ date: '', tailNumber: '', srcIcao: 'kapa', destIcao: '', totalFlightTime: 1.2 });
  assert.equal(entry.srcIcao, 'KAPA');
  assert.deepEqual(reviewErrors(entry), [
    'Enter a real date (YYYY-MM-DD)', 'Tail number is required', 'To must be a four-letter ICAO code'
  ]);
  assert.deepEqual(reviewErrors({ ...entry, date: '2026-02-30', tailNumber: 'N123', destIcao: 'KCOS' }), ['Enter a real date (YYYY-MM-DD)']);
  assert.deepEqual(reviewErrors({ ...entry, date: '2026-02-28', tailNumber: 'N123', destIcao: 'KCOS', dayLandings: 1.5 }), ['dayLandings must be a nonnegative whole number']);
});

test('OCR dates in the AWS sample format can be reviewed and confirmed', () => {
  const entry = reviewEntry({ date: '1/10/2025', tailNumber: 'N54321', srcIcao: 'KSMO', destIcao: 'KSBA' });
  assert.equal(entry.date, '2025-01-10');
  assert.deepEqual(reviewErrors(entry), []);
  assert.deepEqual(reviewErrors(reviewEntry({ ...entry, date: '2/30/2025' })), ['Enter a real date (YYYY-MM-DD)']);
});

test('duplicate signature ignores casing but includes duration', () => {
  const first = reviewEntry({ date: '2026-05-01', tailNumber: 'n123', srcIcao: 'kapa', destIcao: 'kcos', totalFlightTime: 1.2 });
  assert.equal(duplicateKey(first), duplicateKey({ ...first, tailNumber: 'N123' }));
  assert.notEqual(duplicateKey(first), duplicateKey({ ...first, totalFlightTime: 1.3 }));
});

test('three recognized rows save only the corrected, selected flights after confirmation', async () => {
  const records = [
    { date: '2026-05-01', tailNumber: 'N1', srcIcao: 'KAPA', destIcao: 'KCOS' },
    { date: '', tailNumber: 'N2', srcIcao: 'KAPA', destIcao: 'KCOS' },
    { date: '2026-05-03', tailNumber: 'N3', srcIcao: 'KAPA', destIcao: 'KCOS' },
  ];
  let rows = records.map((record, index) => ({ number: index + 1, entry: reviewEntry(record), status: 'pending' }));
  const saved = [];
  assert.equal(saved.length, 0);
  assert.deepEqual(reviewErrors(rows[1].entry), ['Enter a real date (YYYY-MM-DD)']);

  rows[1].entry.date = '2026-05-02';
  rows[2].status = 'discarded';
  assert.deepEqual(await saveReviewRows(rows, async entry => saved.push(entry.tailNumber),
    row => { rows = rows.map(current => current.number === row.number ? row : current); }),
  { saved: 2, failed: 0 });
  assert.deepEqual(saved, ['N1', 'N2']);
});

test('confirmation saves only pending rows and retry skips successful and discarded rows', async () => {
  let rows = [1, 2, 3].map(number => ({ number, entry: reviewEntry({ date: '2026-05-01', tailNumber: `N${number}`, srcIcao: 'KAPA', destIcao: 'KCOS' }), status: number === 3 ? 'discarded' : 'pending' }));
  const calls = [];
  let failSecond = true;
  const save = async entry => {
    calls.push(entry.tailNumber);
    if (entry.tailNumber === 'N2' && failSecond) throw new Error('network error');
  };
  const update = row => { rows = rows.map(current => current.number === row.number ? row : current); };
  assert.deepEqual(await saveReviewRows(rows, save, update), { saved: 1, failed: 1 });
  assert.equal(rows[0].status, 'saved');
  assert.equal(rows[1].error, 'network error');
  failSecond = false;
  assert.deepEqual(await saveReviewRows(rows, save, update), { saved: 1, failed: 0 });
  assert.deepEqual(calls, ['N1', 'N2', 'N2']);
});
