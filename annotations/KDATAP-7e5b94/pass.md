# Annotation pass

## Task

KDATAP-7e5b94 — Promote accepted flows to canonical blocks with typed endpoints.

Parent: KDATAP-baca471 (corpus gold migration readiness).

## Scope

146 adjudicated accept rows across 29 `data_flows.yaml` packets.

## Method

Mechanical script `tests/benchmark/scripts/promote-flow-canonical-gold.ts`:

1. Read `annotations/KDATAP-47e331/adjudication-ledger.json` accept rows
2. Synthesize typed endpoints from accepted component `canonical` blocks via entity ids
3. Write `flow_canonical` on each row; preserve `review_state`, `candidate`, legacy `subject.key`
4. Recompute `corpus-gold.digest` on `--write`

## Counts

| Metric | Value |
| --- | ---: |
| Accept rows promoted | 146 |
| Loader disposition accepted after | 146 |

Ledger: `annotations/KDATAP-7e5b94/migration-ledger.json`.

## Inversion table

| Dimension | Before | After |
| --- | --- | --- |
| Accepted flows with `flow_canonical` | 0 | 146 |
| Canonical loader accepts (data-flows) | 0 | 146 |
| `LOADER_EXEMPTION` (data-flows) | 146 | 0 |
| `FLOW_NO_CANONICAL_ACCEPTS` | 3 | 0 |

Digest after: `sha256:df4103c78c53fd97c722f6e6fe91684b94eb8b6581c0021e3433d857863b83ff`
