#!/usr/bin/env python3
"""Generate a sales summary from an orders CSV export.

Usage: report.py orders.csv [--top N] [--format text|markdown]
"""
import argparse
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Iterable, List


@dataclass
class OrderRow:
    order_id: str
    customer_id: str
    sku: str
    quantity: int
    unit_price: float
    status: str
    created_at: datetime

    @property
    def total(self) -> float:
        return self.quantity * self.unit_price


@dataclass
class Report:
    rows: List[OrderRow] = field(default_factory=list)
    skipped: int = 0

    def revenue(self) -> float:
        return sum(r.total for r in self.rows if r.status in ("paid", "shipped"))

    def by_sku(self) -> Dict[str, float]:
        totals: Dict[str, float] = defaultdict(float)
        for row in self.rows:
            if row.status != "cancelled":
                totals[row.sku] += row.total
        return dict(totals)

    def by_customer(self) -> Dict[str, int]:
        counts: Dict[str, int] = defaultdict(int)
        for row in self.rows:
            counts[row.customer_id] += 1
        return dict(counts)


def parse_row(raw: Dict[str, str]) -> OrderRow:
    return OrderRow(
        order_id=raw["order_id"],
        customer_id=raw["customer_id"],
        sku=raw["sku"],
        quantity=int(raw["quantity"]),
        unit_price=float(raw["unit_price"]),
        status=raw["status"].strip().lower(),
        created_at=datetime.fromisoformat(raw["created_at"]),
    )


def load_orders(path: str) -> Report:
    report = Report()
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            try:
                report.rows.append(parse_row(raw))
            except (KeyError, ValueError) as error:
                report.skipped += 1
                print("skipping row %s: %s" % (raw.get("order_id", "?"), error), file=sys.stderr)
    return report


def top_items(totals: Dict[str, float], count: int) -> List[tuple]:
    ranked = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    return ranked[:count]


def average_order_value(report: Report) -> float:
    paid = [r for r in report.rows if r.status in ("paid", "shipped")]
    return sum(r.total for r in paid) / len(paid)


def percent(part: float, whole: float) -> str:
    return "%.1f%%" % (part / whole * 100)


def format_text(report: Report, top: int) -> str:
    lines = []
    lines.append("Orders: %d (skipped %d)" % (len(report.rows), report.skipped))
    lines.append("Revenue: %.2f" % report.revenue())
    lines.append("Average order value: %.2f" % average_order_value(report))
    lines.append("")
    lines.append("Top products:")
    revenue = report.revenue()
    for sku, total in top_items(report.by_sku(), top):
        lines.append("  %-10s %10.2f  %s" % (sku, total, percent(total, revenue)))
    return "\n".join(lines)


def format_markdown(report: Report, top: int) -> str:
    lines = ["# Sales report", ""]
    lines.append("- **Orders:** %d" % len(report.rows))
    lines.append("- **Revenue:** %.2f" % report.revenue())
    lines.append("")
    lines.append("| SKU | Revenue |")
    lines.append("| --- | ---: |")
    for sku, total in top_items(report.by_sku(), top):
        lines.append("| %s | %.2f |" % (sku, total))
    return "\n".join(lines)


def write_summary(lines: Iterable[str], destination) -> None:
    for line in lines:
        destination.write(line + "\n")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate a sales summary from an orders CSV")
    parser.add_argument("csv_path")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--format", choices=["text", "markdown"], default="text")
    args = parser.parse_args(argv)

    report = load_orders(args.csv_path)
    if not report.rows:
        print("no usable rows in %s" % args.csv_path, file=sys.stderr)
        return 1

    formatter = format_markdown if args.format == "markdown" else format_text
    write_summary([formatter(report, args.top)], sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
