"""Generate ticket action evaluation, with explicit unlabelled cases."""
from __future__ import annotations

import csv

from .config import DATA, OUTPUT, RESULTS
from .domain import extract_ticket_id
from .store import load_results_map, load_tickets


def main() -> None:
    rows = load_tickets()
    predictions = load_results_map(RESULTS)
    labels_file = DATA / "expected_actions.csv"
    labels: dict[str, dict[str, str]] = {}
    if labels_file.exists():
        with labels_file.open(newline="", encoding="utf-8") as f:
            labels = {r["ticket_id"]: r for r in csv.DictReader(f)}
    OUTPUT.mkdir(exist_ok=True, parents=True)
    with (OUTPUT / "evaluation.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["ticket_id", "expected_action", "actual_action", "correct", "notes"])
        writer.writeheader()
        for ticket in rows:
            tid = extract_ticket_id(ticket)
            expected = labels.get(tid, {}).get("expected_action", "")
            actual = (predictions.get(tid, {}).get("agent") or {}).get("action", "")
            writer.writerow(
                {
                    "ticket_id": tid,
                    "expected_action": expected,
                    "actual_action": actual,
                    "correct": str(expected == actual) if expected and actual else "",
                    "notes": labels.get(tid, {}).get("notes", ""),
                }
            )
    print("Saved output/evaluation.csv. Fill in expected labels in data/expected_actions.csv.")


if __name__ == "__main__":
    main()
