"""Regression check: malformed persisted amount types should fail cleanly."""

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

# Resolve the project module when this standalone file is run from any directory.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT))

import expense_tracker  # noqa: E402


class MalformedPersistedAmountTest(unittest.TestCase):
    def test_numeric_amount_returns_cli_error_without_traceback_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            data_path = Path(directory) / "expenses.json"
            original = json.dumps({
                "next_id": 2,
                "expenses": [{
                    "id": 1,
                    "date": "2026-09-02",
                    "amount": 1.25,
                    "category": "Food",
                    "description": "Lunch",
                }],
            })
            data_path.write_text(original, encoding="utf-8")
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = expense_tracker.main(["--file", str(data_path), "list"])

            self.assertEqual(result, 2)
            self.assertIn("error:", stderr.getvalue())
            self.assertNotIn("Traceback", stderr.getvalue())
            self.assertEqual(data_path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
