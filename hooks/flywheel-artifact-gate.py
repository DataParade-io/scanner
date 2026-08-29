#!/usr/bin/env python3
"""Fail-closed artifact gates for finding and annotation status transitions."""

from __future__ import annotations

import json
import sys
from pathlib import Path

FINDING_WORKFLOW: dict[str, list[str]] = {
    "open": ["proposed", "closed"],
    "proposed": ["decomposed", "closed"],
    "decomposed": ["gold-authored", "proposed"],
    "gold-authored": ["verified", "decomposed"],
    "verified": ["closed", "gold-authored"],
    "closed": ["verified", "open"],
}

ANNOTATION_WORKFLOW: dict[str, list[str]] = {
    "open": ["labeling", "closed"],
    "labeling": ["awaiting-review", "closed"],
    "awaiting-review": ["accepted", "labeling", "rejected"],
    "accepted": ["awaiting-review", "closed"],
    "rejected": ["labeling", "closed"],
    "closed": ["open"],
}

FINDING_ARTIFACT: dict[str, str] = {
    "decomposed": "proposal.md",
    "gold-authored": "decomposition.md",
    "verified": "decomposition.md",
}

ANNOTATION_ARTIFACT: dict[str, str] = {
    "awaiting-review": "pass.md",
    "accepted": "pass.md",
}

PLACEHOLDER_MARKERS = (
    "Which `tests/fixtures/*`",
    "Describe the data-flow detail",
    "| components |  |  |  |  |  |",
    "Which files were reviewed?",
    "List finding issue IDs",
)


def _filled(path: Path) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return False
    return not any(marker in text for marker in PLACEHOLDER_MARKERS)


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

    artifact_name = (
        FINDING_ARTIFACT.get(target_status)
        if issue_type == "finding"
        else ANNOTATION_ARTIFACT.get(target_status)
    )
    if not artifact_name:
        return 0

    folder = "findings" if issue_type == "finding" else "annotations"
    project_root = Path(payload["mode"]["project_root"])
    artifact_path = project_root / folder / issue_id / artifact_name
    if _filled(artifact_path):
        return 0

    print(
        f"flywheel-artifact-gate: refuse {current} → {target_status}\n"
        f"Write a non-placeholder {artifact_name} under {folder}/{issue_id}/ first.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
