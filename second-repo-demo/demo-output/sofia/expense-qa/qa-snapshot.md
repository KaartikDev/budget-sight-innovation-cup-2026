# Expense tracker QA snapshot

**Scope:** `expense_tracker.py` and `tests/test_expense_tracker.py`  
**Run:** `python3 -m unittest tests.test_expense_tracker -v`  
**Result:** **11/11 passed** (0.033s). The standalone malformed-field check also passes.

## Covered behavior

- Missing-file reads; add normalization, persistence, and monotonic IDs.
- Date, amount, category, month/year, and delete-ID input validation; rejected CLI input preserves stored bytes.
- Sorted listing and combined month/category filtering.
- Monthly and category summaries, decimal-safe arithmetic, including very large totals.
- Deletion, missing IDs, and non-reused IDs.
- CSV headers for empty data and quoting of commas/quotes.
- Corrupt and structurally invalid JSON rejection without overwrite; invalid stored amount format.
- Atomic replace failure preserves the original and cleans up the temporary file.

## Uncovered edge cases

- Broader wrong JSON value types inside otherwise valid expense records (the included numeric-amount case is now checked; null and malformed types in other fields are not).
- Unreadable files, invalid UTF-8, and filesystem failures at directory creation, flush, or cleanup.
- Export ordering and output-path aliases through symlinks/hard links; concurrent writers to the same data file.
- Boundary calendar years and leap days, and exact behavior for whitespace or unusual Unicode in categories/descriptions.

## Five high-value next tests

1. **Malformed stored field types:** null amount and malformed date/category/description types return a clean CLI error, never a traceback, and preserve source bytes. (Numeric amount is covered by the included focused check.)
2. **Unreadable/invalid-encoding storage:** load reports a controlled error and never modifies the file.
3. **Export ordering and alias protection:** deterministic date/ID row order; resolved aliases of the JSON path are rejected before writing.
4. **Atomic-write failures by stage:** writer/flush failure leaves prior data intact and removes any temp file.
5. **Calendar boundaries:** leap day accepted, impossible dates rejected, and month/year filters include only intended records.
