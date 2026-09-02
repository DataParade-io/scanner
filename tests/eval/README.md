# Fixture evaluation harness

Deterministic evaluation against committed `tests/fixtures/*` trees. Ground truth lives beside layer adapters under `tests/eval/layers/`; shared scoring lives in `tests/eval/score.ts` and delegates to the published boundary in `src/eval/` (`@dataparade/scanner/eval`). See `ground-truth-schema.md` for layer identity and matching rules, and `canonical-representation.md` for the versioned canonical contract (KDATAP-b18135).

Four **headline layers** form the evaluation vector. `raw-hits` and `data-actions` are **diagnostic only** — scanned and reported but excluded from headline gates. There is **no cross-layer scalar**.

## Headline layers

| Layer | Script | Identity prefix | Match semantics |
| --- | --- | --- | --- |
| Mentions | `pnpm run eval:mentions` | `mention:` | key + span + labels |
| Data items | `pnpm run eval:data-items` | `data_item:` | identity only |
| Components | `pnpm run eval:components` | `${type}:${name}` | key + span + labels |
| Data flows | `pnpm run eval:data-flows` | `flow:…` | key + span + labels |

## Diagnostic layers

| Layer | Script | Identity prefix | Match semantics |
| --- | --- | --- | --- |
| Raw hits | `pnpm run eval:raw-hits` | `raw_hit:` | key + span + labels (diagnostic; not a headline gate) |
| Data actions | `pnpm run eval:data-actions` | `${type}:${name}` | key + span + asserted verb labels (diagnostic; not a `scorecard-vector/2` headline gate) |

Personal-data layers share heuristic rules but differ in roll-up. Graph layers and `data-actions` use the deterministic `scan()` pipeline. Do not add empty layer stubs under `layers/data-actions/` until gold cases land.

## Layout

```text
src/eval/                 # Published @dataparade/scanner/eval boundary
tests/eval/
  types.ts                # Fixture eval case and score report types
  score.ts                # Fixture wrapper over evaluateLayerBucket
  ground-truth-schema.md  # Layer identity, matching, computability, eligibility
  canonical-representation.md  # Canonical evaluation representation behaviour spec
  docs-invariants.ts      # Constants checked by evaluation-docs-contract.spec.ts
  layers/
    raw-hits/             # Diagnostic layer
      adapter.ts
      cases.ts
      eval.test.ts
    mentions/
      adapter.ts
      cases.ts
      eval.test.ts
    data-items/
      adapter.ts
      cases.ts
      eval.test.ts
    components/
      adapter.ts
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

Positives marked `documentedGap` remain in recall denominators as measured misses; CI gates may exclude them when asserting pass/fail. Metrics with empty denominators return `null`, not `1`. Per-metric computability states are defined in `ground-truth-schema.md`.

## Running

```bash
pnpm test tests/eval/
pnpm run eval:components
pnpm run eval:raw-hits
pnpm run eval:data-actions
pnpm run eval:mentions
pnpm run eval:data-items
pnpm run eval:data-flows
```

Scans use `createDefaultScanConfiguration({ enableAiInference: false })` for graph layers — the same deterministic path as `tests/unit/core/orchestrator.spec.ts`. Personal-data layers use `matchPiiSignalsInFiles` via `src/eval-layers/collect-personal-data-findings.ts`.
