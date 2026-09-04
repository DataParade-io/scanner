# Annotation pass

## Task

KDATAP-8e7756 — Regold data flows against canonical endpoints.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/data_flows.yaml`.

## Migration method

Mechanical script `tests/benchmark/scripts/migrate-data-flow-gold.ts`:

1. Flip all 436 legacy `review_state: accepted` rows to `needs_adjudication`
2. Attach non-scoring `candidate.kind: flow` proposals from pinned evidence + component gold + rationale
3. Preserve legacy `subject.key`, `subject.name`, and `expected.labels` unchanged
4. No scanner output used as gold input; no component gold rewrites

## Counts

| Metric | Value |
| --- | ---: |
| Total flow rows migrated | 436 |
| graph_edge proposals | 1 |
| intra_component_lineage | 184 |
| rejection (negatives) | 17 |
| unresolved | 234 |

Ledger: `annotations/KDATAP-8e7756/migration-ledger.json`.

## Human review

Pending — Ryan Alyn Porter.
