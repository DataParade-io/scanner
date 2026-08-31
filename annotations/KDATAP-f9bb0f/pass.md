# Annotation pass

## Task

KDATAP-f9bb0f — Relocate closed-world precision scope from per-positive annotations into reviewed packet-and-layer metadata (`layer-scopes.yaml`).

## Scope

All 29 corpus packets under `tests/benchmark/repos/`.

## Migration method

Mechanical union and deduplication of legacy `expected.exhaustive_scope_files` on positive annotations, bucketed per `(repo, canonical layer)`:

- `pii_signals` scopes merge into `mentions`
- Union semantics match pre-migration `collectExhaustiveScopesByLayer` in `tests/benchmark/precision.ts`
- Verification: old union equals new `layer-scopes.yaml` entry for every repo/layer pair before stripping annotations

## Counts (pre-migration)

| Metric | Value |
| --- | ---: |
| Positive annotations carrying scope | 1,565 |
| Duplicated path entries | 18,881 |
| Unique repo/layer unions | 114 |
| Unique paths after union | ~1,205 |
| Repo/layers with inconsistent per-positive lists | 35 |

Inconsistent lists (e.g. discourse, magento) are unioned — the broader closed world matches what the scorer already applied.

## Baseline note (no action in this task)

After a future intersect with successfully processed files (KDATAP-baca47), scope lists are dominated by `.php` and `.rb` paths that ingest cannot open. Report only; do not invent language ingest.

## Human review

Accepted. Mechanical dedup preserves existing scorer semantics; layer scope provenance recorded in each packet's `layer-scopes.yaml`.
