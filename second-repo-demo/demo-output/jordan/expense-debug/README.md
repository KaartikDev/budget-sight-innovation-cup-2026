# Expense tracker category edge case

## Reproduced defect

The original `expense_tracker.py` accepts category names containing line breaks. Since `list` prints tab-separated rows without escaping category text, adding `Food\nTravel` produces a second apparent row (`Travel`) and corrupts the listing layout. Tabs likewise shift the displayed columns.

## Corrected standalone variant

`expense_tracker_fixed.py` rejects Unicode control characters in category names while retaining ordinary category whitespace trimming. This also causes malformed persisted categories with control characters to be rejected by the existing data validator.

## Regression check

Run from the repository root:

```sh
python3 -m unittest discover -s demo-output/jordan/expense-debug -p 'test_*.py' -v
```
