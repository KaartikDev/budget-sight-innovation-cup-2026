"""Regression test for categories corrupting the tracker's tabular list output."""

import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import expense_tracker_fixed as tracker  # noqa: E402


class CategoryControlCharacterRegression(unittest.TestCase):
    def test_add_rejects_newline_category_without_persisting(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "expenses.json"
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = tracker.main([
                    "--file", str(data_path), "add", "5.00", "Food\nTravel",
                    "--date", "2026-09-27",
                ])

            self.assertEqual(result, 2)
            self.assertIn("category must not contain control characters", stderr.getvalue())
            self.assertFalse(data_path.exists())

    def test_tab_category_is_rejected_too(self):
        with self.assertRaisesRegex(tracker.ExpenseError, "control characters"):
            tracker.valid_category("Food\tTravel")


if __name__ == "__main__":
    unittest.main()
