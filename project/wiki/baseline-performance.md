# Scanner performance baseline history

This page tracks pinned four-layer scorecard runs used as the reference for scanner-improvement slices. The reference artifact is immutable; improvement slices append rows below — never overwrite the reference JSON.

Artifact: [`tests/fixtures/baseline/series-1-performance-baseline.json`](../../tests/fixtures/baseline/series-1-performance-baseline.json) (schema `performance-baseline/1`).

## Reference (pinned — do not overwrite)

| Captured | Commit | Mentions R/P | Data-items R/P | Components R/P | Data-flows R/P | Artifact |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-03T13:00:43Z | `6d241f8` | 41.8% / 0.9% (33/79 · 33/3693) | 27.1% / 36.5% (38/140 · 38/104) | 0.6% / 13.6% (3/519 · 3/22) | 0.0% / 0.0% (0/158 · 0/13) | `series-1-performance-baseline.json` |

## Improvement slices (append only)

| Slice | Commit | Δ recall | Δ precision | PR | Notes |
| --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | |

### Diff policy

Improvement-slice PRs must re-run `pnpm run benchmark:scorecard` against all 29 materialized packets (accepted-only) and show per-layer deltas against the reference row above:

- **Recall:** candidate rate ≥ reference rate (numerator/denominator from `headlineMetrics`).
- **Precision:** candidate rate must not crater — target ≥ 90% of reference rate per layer.

Append a row to this table when a slice lands; do not modify the reference artifact.
