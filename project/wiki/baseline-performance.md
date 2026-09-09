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
| Enable data-flows metric | `e9b8bb6` | flows 0→0 (gate scorable) | — | #63 | Policy: count `intra_component_lineage` |
| flow_canonical round-trip | `6d241f8` | flows 0→0 (denominator fixed) | — | #64 | Eval loader bug fix |
| Pin performance baseline | `d5604f9` | — | — | #65 | Reference artifact at 6d241f8 |
| Intra-component lineage detector | `08a5206` | flows 0→1/158 | 1/48 | #66 | First self-loop flow |
| Widen flow detection | `faec1b3` | flows 1→~10/158 | tightened | #67 | Patterns, dedupe, precision gates |
| Component subtype identity | `81ad021` | components 3→16/519 | up | #68 | type:subType + Go/PHP patterns |
| Ruby/Rails analyzer | `b3a342e` | components 16→136/519 | up | #69 | discourse/redmine/spree |
| Ruby flow detection | `86873e5` | flows ~10→20/158 | held | #70 | Rails intra-component flows |
| PII alias matching (Phase 1) | `0fd2b5a` | mentions 45→62/79; data-items flat | held | #71 | Line-level; rollup blocked |
| Data-action classification | `998fb12` | diagnostic layer | — | develop | Tier A/B/C gold + scan wiring |
| Data-items Phase 2 assignment | spike-inc | data-items 43→48/140 (+5) | 37.8% (48/127) | this branch | Evidence-scoped `assignDataItemsOneToOne`; identity monopoly caps multi-location gold |
| Data-items monopoly removal | `fix/data-items-recall-60` | data-items 48→134/140 (+86) | 64.3% (83/129) | pending | Per-slice collapse + candidate round-trip + slice tie-break assignment |
| Flow assignment + route widening | `fix/data-items-recall-60` | flows 14→31/158 (+17) | 2.9% (31/1057) | pending | Endpoint enrichment, route widening, `assignDataFlowsOneToOne` tie-break |
| Flow detection widening (iter 3) | `fix/data-items-recall-60` | flows 19→31/158 (+12) | held | pending | Route-block interior, PHP Controller→api, function-scope evidence ranges, auth patterns |
| Full four-layer scorecard (v1) | `fix/data-items-recall-60` | mentions 61/79; items 134/140; comp 136/519; flows 31/158 | all layers up vs series-1 | pending | `scorecard-fix-data-items-recall-60.json` @ 2026-09-09 |
| Mentions slice assignment | `fix/data-items-recall-60` | mentions 61→79/79 (+18) | 1.5% (79/5392) held | pending | `assignMentionsOneToOne` + same-line duplicate guard; evidence-scoped slices |
| Data-items final 6 | `fix/data-items-recall-60` | data-items 134→140/140 (+6) | 64.4% (85/132) | pending | Co-location credit, Swift ingest, PII span fixes |
| Full four-layer scorecard (v2) | `fix/data-items-recall-60` | mentions 79/79; items 140/140; comp 136/519; flows 31/158 | mentions/items recall maxed | pending | `scorecard-fix-data-items-recall-60-v2.json` @ 2026-09-09T12:24Z |
| Zero-component census + patterns | spike-inc | components 136→135/519; zero-comp 8→2/29 | held | this branch | django_model_class (easy-school); magento/php; census report refreshed |
| Flow route PII widening | spike-inc | flows held ~20/158 (path patterns only) | held | this branch | PERSONAL_DATA_ROUTE_PATH_PATTERNS; route_declaration slice deferred |
| NPM_TOKEN semantic-release | ops | — | — | — | GitHub secret must be valid npm token for `@dataparade` publish on main merge |

### Diff policy

Improvement-slice PRs must re-run `pnpm run benchmark:scorecard` against all 29 materialized packets (accepted-only) and show per-layer deltas against the reference row above:

- **Recall:** candidate rate ≥ reference rate (numerator/denominator from `headlineMetrics`).
- **Precision:** candidate rate must not crater — target ≥ 90% of reference rate per layer.

Append a row to this table when a slice lands; do not modify the reference artifact.
