#!/usr/bin/env python3
"""Evaluate a layer score CSV dataset without GraphQL or the Plexus CLI."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

import pandas as pd
from ruamel.yaml import YAML

from plexus.cli.shared import get_score_yaml_path
from plexus.scores import resolve_score_class
from plexus.scores.Score import Score


def _load_score(scorecard_dir: str, scorecard_name: str, score_name: str, findings_command: str):
    os.environ["SCORECARD_CACHE_DIR"] = scorecard_dir
    yaml_path = get_score_yaml_path(scorecard_name, score_name)
    if not yaml_path.exists():
        raise FileNotFoundError(f"Score YAML not found: {yaml_path}")

    with open(yaml_path, encoding="utf-8") as handle:
        config = YAML(typ="safe").load(handle)

    if not isinstance(config, dict):
        raise ValueError(f"Invalid score configuration in {yaml_path}")

    score_class_name = config.get("class")
    if not score_class_name:
        raise ValueError(f"Score YAML missing class field: {yaml_path}")

    score_class = resolve_score_class(score_class_name)
    parameters = {key: value for key, value in config.items() if key != "class"}
    parameters["findings_command"] = findings_command
    parameters["scorecard_name"] = scorecard_name
    parameters["score_name"] = score_name
    return score_class(**parameters)


def _normalize_label(value: object) -> str:
    return str(value or "").strip().lower()


def _parse_metadata(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        return json.loads(raw)
    return {}


async def _predict_row(score: Score, text: str, metadata: dict) -> dict:
    item = Score.Input(text=text or "", metadata=metadata)
    try:
        result = await score.predict(item)
        return {
            "skipped": False,
            "predicted": str(result.value),
            "error": None,
        }
    except Score.SkippedScoreException as exc:
        return {
            "skipped": True,
            "predicted": None,
            "error": str(exc),
        }


async def _evaluate(args: argparse.Namespace) -> dict:
    score = _load_score(
        args.scorecard_dir,
        args.scorecard_name,
        args.score_name,
        args.findings_command,
    )

    frame = pd.read_csv(args.dataset_file)
    if args.score_name not in frame.columns:
        raise ValueError(
            f"Dataset missing gold label column '{args.score_name}': {frame.columns.tolist()}"
        )

    rows: list[dict] = []
    for _, sample in frame.iterrows():
        metadata = _parse_metadata(sample.get("metadata"))
        gold = _normalize_label(sample.get(args.score_name))
        prediction = await _predict_row(score, str(sample.get("text", "")), metadata)
        rows.append(
            {
                "content_id": str(sample.get("content_id", "")),
                "gold": gold,
                **prediction,
            }
        )

    scored = [row for row in rows if not row["skipped"]]
    positive_gold = [row for row in scored if row["gold"] == "yes"]
    true_positives = sum(
        1 for row in positive_gold if _normalize_label(row["predicted"]) == "yes"
    )
    false_negatives = len(positive_gold) - true_positives
    recall_denominator = len(positive_gold)
    recall = (true_positives / recall_denominator * 100.0) if recall_denominator else 0.0

    evaluation_id = str(uuid.uuid4())
    summary_lines = [
        f"Created initial Evaluation record with ID: {evaluation_id}",
        "Marked evaluation as COMPLETED",
        f"Recall: {recall:.2f}%",
        f'Metrics: [{{"name": "Recall", "value": {recall:.2f}}}]',
        f"{true_positives}/{recall_denominator} correct",
        f"yes | {recall_denominator} {true_positives}",
    ]

    return {
        "id": evaluation_id,
        "status": "COMPLETED",
        "metrics": [{"name": "Recall", "value": recall}],
        "recall": recall,
        "rows": rows,
        "truePositives": true_positives,
        "falseNegatives": false_negatives,
        "recallDenominator": recall_denominator,
        "output": "\n".join(summary_lines),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scorecard-dir", required=True)
    parser.add_argument("--scorecard-name", required=True)
    parser.add_argument("--score-name", required=True)
    parser.add_argument("--dataset-file", required=True)
    parser.add_argument("--findings-command", required=True)
    args = parser.parse_args()

    payload = asyncio.run(_evaluate(args))
    json.dump(payload, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
