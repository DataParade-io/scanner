#!/usr/bin/env python3
"""Scaffold finding/annotation workspaces and start flywheel statuses."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PROPOSAL_TEMPLATE = """# Proposal

## Fixture or repository

Which `tests/fixtures/*` tree or corpus repo is this about?

## What we expect to find

Describe the data-flow detail in plain English (example: the API sends customer email to Stripe).

## Human review

Findings stay **proposed** until a person advances them. Do not treat agent-authored gold as accepted.
"""

DECOMPOSITION_TEMPLATE = """# Decomposition

Fill one row per eval grade that applies. Leave a layer blank if it does not apply.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components |  |  |  |  |  |
| data-flows |  |  |  |  |  |
| raw-hits |  |  |  |  |  |
| mentions |  |  |  |  |  |
| data-items |  |  |  |  |  |
"""

PASS_TEMPLATE = """# Annotation pass

## Repository / fixture

## Scope

Which files were reviewed?

## Findings in this pass

List finding issue IDs (KDATAP-…) that belong to this labeling pass.

## Human review

This annotation stays in **awaiting-review** until a person moves it to **accepted**.
"""


def _run_kbs_status(issue_id: str, status: str) -> None:
    env = os.environ.copy()
    env["KANBUS_NO_HOOKS"] = "1"
    subprocess.run(
        ["kbs", "update", issue_id, "--status", status],
        check=False,
        env=env,
        capture_output=True,
        text=True,
    )


def main() -> int:
    payload = json.load(sys.stdin)
    issue = (payload.get("operation") or {}).get("issue") or {}
    issue_type = issue.get("type")
    issue_id = issue.get("id")
    if not issue_id:
        return 0

    project_root = Path(payload["mode"]["project_root"])

    if issue_type == "finding":
        workspace = project_root / "findings" / issue_id
        workspace.mkdir(parents=True, exist_ok=True)
        proposal = workspace / "proposal.md"
        if not proposal.exists():
            proposal.write_text(PROPOSAL_TEMPLATE, encoding="utf-8")
        decomposition = workspace / "decomposition.md"
        if not decomposition.exists():
            decomposition.write_text(DECOMPOSITION_TEMPLATE, encoding="utf-8")
        if issue.get("status") == "open":
            _run_kbs_status(issue_id, "proposed")
        return 0

    if issue_type == "annotation":
        workspace = project_root / "annotations" / issue_id
        workspace.mkdir(parents=True, exist_ok=True)
        pass_path = workspace / "pass.md"
        if not pass_path.exists():
            pass_path.write_text(PASS_TEMPLATE, encoding="utf-8")
        if issue.get("status") == "open":
            _run_kbs_status(issue_id, "labeling")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
