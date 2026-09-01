# Evaluator contract suite

Synthetic golden inputs owned by the evaluator — not by any corpus packet. This is the regression guard for canonical evaluation during gold migration.

## Running

```bash
pnpm run eval:contract
```

The same suite is required on every pull request via `pnpm run ci:smoke` (see `tests/benchmark/README.md` — CI validation policy).

## Coverage map

| File | Cases |
| --- | --- |
| `cases/eligibility.ts` | All 11 `EligibilityReason` values at the evaluator boundary |
| `cases/duplicate-findings.ts` | One finding → one gold row; duplicate findings → ambiguous |
| `cases/zero-positive-scope.ts` | Reviewed closed-world scope with zero evaluable positives |
| `cases/paths.ts` | Path normalization and contract rejection (absolute, traversing, malformed) |
| `cases/observed-tokens.ts` | Observed tokens do not rescue strict identity |
| `cases/closed-world.ts` | Closed-world precision denominator behaviour |

## Out of scope here

- Corpus fixture evals under `tests/eval/layers/*/eval.test.ts` (encode the implementation being replaced)
- Gherkin representation scenarios in `features/canonical-evaluation-representation.feature`
- Benchmark packet clones or materialization
