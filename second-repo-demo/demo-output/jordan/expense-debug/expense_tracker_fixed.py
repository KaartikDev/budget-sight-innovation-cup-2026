"""A small, standard-library-only expense tracker."""

from __future__ import annotations

import argparse
import csv
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata


DEFAULT_FILE = Path.home() / ".expense_tracker.json"
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
MONTH_PATTERN = re.compile(r"\d{4}-(0[1-9]|1[0-2])\Z")
AMOUNT_PATTERN = re.compile(r"\d+(?:\.\d{1,2})?\Z")
CENT = Decimal("0.01")


class ExpenseError(ValueError):
    """Invalid input or expense data."""


def valid_date(value: str) -> str:
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise ExpenseError("date must be in YYYY-MM-DD format")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ExpenseError("date must be a valid calendar date") from exc
    return value


def valid_month(value: str) -> str:
    if not isinstance(value, str) or not MONTH_PATTERN.fullmatch(value):
        raise ExpenseError("month must be in YYYY-MM format")
    return value


def valid_amount(value: str) -> Decimal:
    if not isinstance(value, str) or not AMOUNT_PATTERN.fullmatch(value):
        raise ExpenseError("amount must be a positive decimal with at most two places")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ExpenseError("invalid amount") from exc
    if amount <= 0:
        raise ExpenseError("amount must be greater than zero")
    with localcontext() as context:
        context.prec = max(28, len(value) + 2)
        return amount.quantize(CENT)


def valid_category(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ExpenseError("category must not be empty")
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ExpenseError("category must not contain control characters")
    return value.strip()


def valid_description(value: str) -> str:
    if not isinstance(value, str):
        raise ExpenseError("description must be text")
    return value.strip()


def _validate_document(document: object) -> dict:
    if not isinstance(document, dict) or set(document) != {"next_id", "expenses"}:
        raise ExpenseError("data file has an invalid structure")
    next_id = document["next_id"]
    expenses = document["expenses"]
    if type(next_id) is not int or next_id < 1 or not isinstance(expenses, list):
        raise ExpenseError("data file has an invalid structure")
    seen = set()
    for entry in expenses:
        if not isinstance(entry, dict) or set(entry) != {"id", "date", "amount", "category", "description"}:
            raise ExpenseError("data file contains an invalid expense")
        identifier = entry["id"]
        if type(identifier) is not int or identifier < 1 or identifier >= next_id or identifier in seen:
            raise ExpenseError("data file contains an invalid expense ID")
        seen.add(identifier)
        try:
            valid_date(entry["date"])
            valid_amount(entry["amount"])
            if entry["amount"] != str(valid_amount(entry["amount"])):
                raise ExpenseError("amount must be stored with two decimal places")
            if valid_category(entry["category"]) != entry["category"]:
                raise ExpenseError("category must be stored without surrounding whitespace")
            if valid_description(entry["description"]) != entry["description"]:
                raise ExpenseError("description must be stored without surrounding whitespace")
        except ExpenseError as exc:
            raise ExpenseError(f"data file contains an invalid expense: {exc}") from exc
    return document


def load(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return _validate_document(json.load(handle))
    except FileNotFoundError:
        return {"next_id": 1, "expenses": []}
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ExpenseError(f"cannot read data file {path}: {exc}") from exc


def _atomic_write(path: Path, writer) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as handle:
            temp_path = Path(handle.name)
            writer(handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def save(path: Path, document: dict) -> None:
    _validate_document(document)

    def write(handle):
        json.dump(document, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    _atomic_write(path, write)


def select(expenses: list[dict], month: str | None = None,
           category: str | None = None) -> list[dict]:
    if month is not None:
        valid_month(month)
    if category is not None:
        category = valid_category(category)
    return sorted((entry for entry in expenses
                   if (month is None or entry["date"].startswith(month + "-"))
                   and (category is None or entry["category"] == category)),
                  key=lambda entry: (entry["date"], entry["id"]))


def totals(expenses: list[dict], key) -> list[tuple[str, Decimal]]:
    grouped: dict[str, list[Decimal]] = {}
    for entry in expenses:
        group = key(entry)
        grouped.setdefault(group, []).append(Decimal(entry["amount"]))
    return sorted((group, sum_amounts(amounts)) for group, amounts in grouped.items())


def sum_amounts(amounts: list[Decimal]) -> Decimal:
    with localcontext() as context:
        context.prec = max(28, sum(len(str(amount)) for amount in amounts) + 2)
        return sum(amounts, Decimal("0.00"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Track expenses in a local JSON file")
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE, help="JSON data file")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="Add an expense")
    add.add_argument("amount", help="Positive amount, at most two decimal places")
    add.add_argument("category")
    add.add_argument("--date", default=date.today().isoformat(), help="YYYY-MM-DD (default: today)")
    add.add_argument("--description", default="")

    listing = commands.add_parser("list", help="List expenses")
    listing.add_argument("--month", help="Filter by YYYY-MM")
    listing.add_argument("--category", help="Filter by exact category")

    delete = commands.add_parser("delete", help="Delete an expense by ID")
    delete.add_argument("id", type=int)

    summary = commands.add_parser("summary", help="Show grouped totals")
    groups = summary.add_subparsers(dest="group", required=True)
    monthly = groups.add_parser("monthly", help="Totals by month")
    monthly.add_argument("--year", help="Filter by YYYY")
    categorical = groups.add_parser("category", help="Totals by category")
    categorical.add_argument("--month", help="Filter by YYYY-MM")

    export = commands.add_parser("export", help="Export all expenses to CSV")
    export.add_argument("output", type=Path, help="CSV output path")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        document = load(args.file)
        expenses = document["expenses"]
        if args.command == "add":
            amount = valid_amount(args.amount)
            entry = {"id": document["next_id"], "date": valid_date(args.date),
                     "amount": str(amount), "category": valid_category(args.category),
                     "description": valid_description(args.description)}
            expenses.append(entry)
            document["next_id"] += 1
            save(args.file, document)
            print(f"Added expense #{entry['id']}.")
        elif args.command == "list":
            rows = select(expenses, args.month, args.category)
            if not rows:
                print("No expenses found.")
            else:
                print("ID\tDate\tAmount\tCategory\tDescription")
                for row in rows:
                    print(f"{row['id']}\t{row['date']}\t{row['amount']}\t{row['category']}\t{row['description']}")
        elif args.command == "delete":
            if args.id < 1:
                raise ExpenseError("ID must be a positive integer")
            for index, entry in enumerate(expenses):
                if entry["id"] == args.id:
                    del expenses[index]
                    save(args.file, document)
                    print(f"Deleted expense #{args.id}.")
                    break
            else:
                raise ExpenseError(f"expense #{args.id} not found")
        elif args.command == "summary":
            if args.group == "monthly":
                if args.year is not None and not re.fullmatch(r"\d{4}", args.year):
                    raise ExpenseError("year must be in YYYY format")
                rows = [entry for entry in expenses if args.year is None or entry["date"].startswith(args.year + "-")]
                groups = totals(rows, lambda entry: entry["date"][:7])
                heading = "Month"
            else:
                rows = select(expenses, month=args.month)
                groups = totals(rows, lambda entry: entry["category"])
                heading = "Category"
            if not groups:
                print("No expenses found.")
            else:
                print(f"{heading}\tTotal")
                for group, amount in groups:
                    print(f"{group}\t{amount:.2f}")
                print(f"Total\t{sum_amounts([amount for _, amount in groups]):.2f}")
        elif args.command == "export":
            if args.output.resolve() == args.file.resolve():
                raise ExpenseError("CSV output must differ from the JSON data file")

            def write_csv(handle):
                writer = csv.writer(handle)
                writer.writerow(["id", "date", "amount", "category", "description"])
                for entry in select(expenses):
                    writer.writerow([entry[column] for column in ("id", "date", "amount", "category", "description")])

            _atomic_write(args.output, write_csv)
            print(f"Exported {len(expenses)} expenses to {args.output}.")
        return 0
    except (ExpenseError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
