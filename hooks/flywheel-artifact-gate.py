#!/usr/bin/env python3
"""Fail-closed workflow gates for finding and annotation status transitions."""

from __future__ import annotations

import json
import sys

FINDING_WORKFLOW: dict[str, list[str]] = {
    "open": ["proposed", "closed"],
    "proposed": ["accepted", "rejected", "closed"],
    "accepted": ["rejected", "proposed", "closed"],
    "rejected": ["proposed", "accepted", "closed"],
    "closed": ["proposed", "open"],
}

ANNOTATION_WORKFLOW: dict[str, list[str]] = {
    "open": ["closed"],
    "closed": ["open"],
}


def main() -> int:
    payload = json.load(sys.stdin)
    operation = payload.get("operation") or {}
    before_issue = operation.get("before_issue") or {}
    target_status = operation.get("status")
    issue_id = operation.get("identifier") or before_issue.get("id")
    issue_type = before_issue.get("type")

    if issue_type not in {"finding", "annotation"} or not target_status or not issue_id:
        return 0

    current = before_issue.get("status")
    if not current or current == target_status:
        return 0

    workflow = FINDING_WORKFLOW if issue_type == "finding" else ANNOTATION_WORKFLOW
    allowed = workflow.get(current, [])
    if target_status not in allowed:
        print(
            f"flywheel-artifact-gate: refuse skip-ahead {current} → {target_status} "
            f"for {issue_type}. Walk the configured ladder.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
