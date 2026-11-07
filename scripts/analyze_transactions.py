#!/usr/bin/env python3
"""Simple off-chain anomaly detector for exported ContributionReceived events.

Input format: a JSON array with sender, amountWei, timestamp, and txHash fields.
The script uses only Python's standard library so it is easy to run in CI.
"""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def analyze(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not events:
        return findings

    amounts = [int(event["amountWei"]) for event in events]
    repeated = Counter(amounts)
    for amount, count in repeated.items():
        if count >= 4:
            findings.append(
                {
                    "kind": "repeated_amount",
                    "severity": "medium",
                    "amountWei": str(amount),
                    "occurrences": count,
                }
            )

    totals_by_sender: dict[str, int] = defaultdict(int)
    for event in events:
        totals_by_sender[event["sender"].lower()] += int(event["amountWei"])
    grand_total = sum(totals_by_sender.values())
    for sender, total in totals_by_sender.items():
        share = total / grand_total if grand_total else 0
        if share >= 0.6:
            findings.append(
                {
                    "kind": "address_concentration",
                    "severity": "high",
                    "sender": sender,
                    "share": round(share, 4),
                    "amountWei": str(total),
                }
            )

    buckets: dict[int, int] = defaultdict(int)
    for event in events:
        buckets[int(event["timestamp"]) // 3600] += int(event["amountWei"])
    volumes = list(buckets.values())
    if len(volumes) >= 3:
        median = statistics.median(volumes)
        if median > 0:
            for hour, volume in buckets.items():
                if volume >= median * 4:
                    findings.append(
                        {
                            "kind": "contribution_spike",
                            "severity": "medium",
                            "hourStart": hour * 3600,
                            "amountWei": str(volume),
                            "medianHourlyWei": str(int(median)),
                        }
                    )

    return findings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("events", type=Path, help="JSON file containing contribution events")
    parser.add_argument("--output", type=Path, help="Optional output JSON file")
    args = parser.parse_args()

    events = json.loads(args.events.read_text(encoding="utf-8"))
    if not isinstance(events, list):
        raise SystemExit("Input must be a JSON array")

    report = {"eventCount": len(events), "findings": analyze(events)}
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(f"{rendered}\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
