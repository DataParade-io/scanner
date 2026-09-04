#!/usr/bin/env python3
"""Bridge: read annotations + findings JSON from stdin, print recall metrics.

Used by scripts/run-corpus-eval.ts to call plexus.scoring.evaluate_recall
without starting a GraphQL server.

Usage:
    python3 scripts/score-corpus-recall.py < input.json

Input JSON shape:
    {"annotations": [...], "findings": [...]}

Output: metrics dict as JSON on stdout.
"""
import json
import sys

from plexus.scoring import evaluate_recall


def main():
    payload = json.load(sys.stdin)
    annotations = payload.get("annotations", [])
    findings = payload.get("findings", [])
    report = evaluate_recall(annotations, findings)
    json.dump(report, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
