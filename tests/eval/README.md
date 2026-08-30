# Fixture evaluation harness

Deterministic evaluation against committed `tests/fixtures/*` trees. Ground truth lives beside layer adapters under `tests/eval/layers/`; shared scoring lives in `tests/eval/score.ts`. See `ground-truth-schema.md` for identity and matching rules across all five grades.

## Five evaluation grades

Three personal-data grades share heuristic rules but differ in roll-up; two graph grades use the deterministic `scan()` pipeline:

| Grade | Layer | Script | Identity prefix | Match semantics |
| --- | --- | --- | --- | --- |
| Raw hits | `raw-hits` | `pnpm run eval:raw-hits` | `raw_hit:` | key + span + labels |
| Mentions | `mentions` | `pnpm run eval:mentions` | `mention:` | key + span + labels |
| Data items | `data-items` | `pnpm run eval:data-items` | `data_item:` | identity only |
| Components | `components` | `pnpm run eval:components` | `${type}:${name}` | key + span + labels |
| Data flows | `data-flows` | `pnpm run eval:data-flows` | `flow:…` | key + span + labels |

## Layout

```text
tests/eval/
  types.ts                # Eval case and score report types
  score.ts                # Shared recall / label / precision metrics
  ground-truth-schema.md  # Identity and matching rules for all five grades
  layers/
    raw-hits/
      adapter.ts          # Pattern-hit bridge with raw_hit: identity
      cases.ts
      eval.test.ts
    mentions/
      adapter.ts          # Mention bridge with mention: identity
      cases.ts
      eval.test.ts
    data-items/
      adapter.ts          # Rolled-up data-item bridge with data_item: identity
      cases.ts
      eval.test.ts
    components/
      adapter.ts          # scan() bridge with component identity
      cases.ts
      eval.test.ts
    data-flows/
      adapter.ts
      cases.ts
      eval.test.ts
```

Do not add empty layer stubs. Add cases only when committed fixtures provide ground truth.

## Component identity

Subject keys use `${type}:${name.toLowerCase()}`, aligned with `scan()` component names from the deterministic pipeline (for example `asset:main (aws_db_instance)`, `third_party:stripe`).

## Metrics (`score.ts`)

| Metric | Definition |
| --- | --- |
| `recall` | Matched evaluable positives ÷ all evaluable positives |
| `labelAccuracy` | Correctly labelled matches ÷ matched positives |
| `correctLabelRecall` | Correctly labelled matches ÷ evaluable positives |
| `precision` | Scanner findings in `exhaustiveScopeFiles` that match an accepted **positive** ÷ all scanner findings in those files. Extra hits (including a Stripe finding in a repo that does not use Stripe) are false positives. Explicit negatives are not the precision denominator. |
| `negativeCasePassRate` | Clean explicit negatives ÷ negative cases (span-level must-not-fire checks, not precision) |
| `unreadCount` | Cases whose evidence file was not scanned and is not in that case's exhaustive file list |

Positives marked `documentedGap` remain in recall denominators as measured misses; CI gates may exclude them when asserting pass/fail. Metrics with empty denominators return `null`, not `1`.

## Running

```bash
pnpm test tests/eval/
pnpm run eval:components
pnpm run eval:raw-hits
pnpm run eval:mentions
pnpm run eval:data-items
pnpm run eval:data-flows
```

Scans use `createDefaultScanConfiguration({ enableAiInference: false })` for graph layers — the same deterministic path as `tests/unit/core/orchestrator.spec.ts`. Personal-data layers use `matchPiiSignalsInFiles` via `src/eval-layers/collect-personal-data-findings.ts`.
