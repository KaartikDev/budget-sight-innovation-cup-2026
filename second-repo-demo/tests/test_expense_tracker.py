import contextlib
import csv
from decimal import Decimal
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import expense_tracker as tracker


class ExpenseTrackerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "nested" / "expenses.json"

    def run_cli(self, *args):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = tracker.main(["--file", str(self.path), *args])
        return code, output.getvalue(), errors.getvalue()

    def add(self, amount="12.50", category="Food", day="2026-09-02", description="Lunch"):
        return self.run_cli("add", amount, category, "--date", day, "--description", description)

    def test_missing_file_lists_without_creating_storage(self):
        self.assertEqual(self.run_cli("list"), (0, "No expenses found.\n", ""))
        self.assertFalse(self.path.exists())

    def test_add_persists_normalized_values_and_increasing_ids(self):
        self.assertEqual(self.add("1", " Food ", description=" Lunch ")[0], 0)
        self.assertEqual(self.add("2.3")[0], 0)
        data = json.loads(self.path.read_text())
        self.assertEqual(data["next_id"], 3)
        self.assertEqual([row["id"] for row in data["expenses"]], [1, 2])
        self.assertEqual(data["expenses"][0], {
            "id": 1, "date": "2026-09-02", "amount": "1.00",
            "category": "Food", "description": "Lunch",
        })

    def test_list_sorts_and_filters(self):
        self.add("3", "Travel", "2026-10-01")
        self.add("2", "Food", "2026-09-03")
        self.add("1", "Food", "2026-09-01")
        code, output, _ = self.run_cli("list", "--month", "2026-09", "--category", "Food")
        self.assertEqual(code, 0)
        self.assertEqual([line.split("\t")[0] for line in output.splitlines()[1:]], ["3", "2"])
        self.assertNotIn("Travel", output)

    def test_delete_preserves_remaining_ids_and_missing_id_is_error(self):
        self.add()
        self.add()
        self.assertEqual(self.run_cli("delete", "1")[0], 0)
        self.assertEqual(self.run_cli("delete", "1")[0], 2)
        self.assertIn("not found", self.run_cli("delete", "1")[2])
        self.add()
        self.assertEqual([row["id"] for row in tracker.load(self.path)["expenses"]], [2, 3])

    def test_monthly_and_category_summaries_use_decimal(self):
        self.add("0.10", "Food", "2026-09-01")
        self.add("0.20", "Food", "2026-09-02")
        self.add("2", "Travel", "2026-10-01")
        self.assertEqual(self.run_cli("summary", "monthly")[1],
                         "Month\tTotal\n2026-09\t0.30\n2026-10\t2.00\nTotal\t2.30\n")
        self.assertEqual(self.run_cli("summary", "monthly", "--year", "2026")[0], 0)
        self.assertEqual(self.run_cli("summary", "category", "--month", "2026-09")[1],
                         "Category\tTotal\nFood\t0.30\nTotal\t0.30\n")

    def test_export_quotes_csv_fields_and_has_header_when_empty(self):
        output = Path(self.directory.name) / "out.csv"
        self.assertEqual(self.run_cli("export", str(output))[0], 0)
        with output.open(newline="") as handle:
            self.assertEqual(list(csv.reader(handle)), [["id", "date", "amount", "category", "description"]])
        self.add("1", "Food, drink", description='A "quoted" item')
        self.assertEqual(self.run_cli("export", str(output))[0], 0)
        with output.open(newline="") as handle:
            self.assertEqual(list(csv.reader(handle))[1],
                             ["1", "2026-09-02", "1.00", "Food, drink", 'A "quoted" item'])

    def test_rejects_bad_inputs_without_changing_file(self):
        self.add()
        original = self.path.read_bytes()
        invalid = [
            ("add", "0", "Food"), ("add", "-1", "Food"),
            ("add", "1.234", "Food"), ("add", "NaN", "Food"),
            ("add", "1", "  "), ("add", "1", "Food", "--date", "2026-02-30"),
            ("list", "--month", "2026-13"),
            ("summary", "monthly", "--year", "26"),
            ("summary", "category", "--month", "2026-00"),
            ("delete", "0"), ("export", str(self.path)),
        ]
        for args in invalid:
            with self.subTest(args=args):
                self.assertEqual(self.run_cli(*args)[0], 2)
                self.assertEqual(self.path.read_bytes(), original)

    def test_corrupt_or_invalid_json_is_rejected_without_overwrite(self):
        self.path.parent.mkdir(parents=True)
        for content in ["{bad", '{"next_id": 2, "expenses": [{"id": 1}]}',
                        '{"next_id": 1, "expenses": [], "extra": 1}']:
            with self.subTest(content=content):
                self.path.write_text(content)
                self.assertEqual(self.run_cli("add", "1", "Food")[0], 2)
                self.assertEqual(self.path.read_text(), content)

    def test_atomic_replace_failure_keeps_original_and_removes_temp(self):
        self.add()
        original = self.path.read_bytes()
        with mock.patch.object(tracker.os, "replace", side_effect=OSError("replace failed")):
            code, _, error = self.add("2")
        self.assertEqual(code, 2)
        self.assertIn("replace failed", error)
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_money_helpers_and_invalid_persisted_amount(self):
        self.assertEqual(tracker.valid_amount("0.01"), Decimal("0.01"))
        self.assertRaises(tracker.ExpenseError, tracker.valid_date, "20260902")
        self.add()
        document = tracker.load(self.path)
        document["expenses"][0]["amount"] = "1.234"
        self.assertRaises(tracker.ExpenseError, tracker.save, self.path, document)

    def test_large_decimal_totals_remain_exact(self):
        amount = "999999999999999999999999999999.99"
        self.assertEqual(self.add(amount)[0], 0)
        self.assertEqual(self.add("0.01")[0], 0)
        self.assertEqual(self.run_cli("summary", "monthly")[1],
                         "Month\tTotal\n2026-09\t1000000000000000000000000000000.00\n"
                         "Total\t1000000000000000000000000000000.00\n")


if __name__ == "__main__":
    unittest.main()
