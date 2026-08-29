# Four-layer scanner evaluation

The scanner measures detection quality at multiple **grades** of abstraction. Personal-data grades stack from raw pattern hits through rolled-up data items; graph grades cover architecture (components and data flows).

## Evaluation grades

| Grade | Layer key | What it measures | Identity prefix |
|-------|-----------|------------------|-----------------|
| Raw pattern hit | `raw-hits` | One YAML heuristic rule firing on one file line, before roll-up | `raw_hit:<ruleId>` |
| Mention | `mentions` | File+line receipt that a personal-data concept was seen | `mention:<ruleId>` |
| Data item | `data-items` | Unique personal-data concept in a fixture (rolled up across lines/files) | `data_item:<ruleId>` |
| Component | `components` | Detected asset or third party from the scan pipeline | `<type>:<name>` (lowercase) |
| Data flow | `data-flows` | Directed edge between two components | `flow:<sourceKey>-><targetKey>` |

`<ruleId>` is the id from `patterns/pii-signals.rules.yaml` and maps 1:1 to a data-item concept (`dataItemConceptId` in `src/eval-layers/identities.ts`).

### Personal-data roll-up

```text
raw_hit:email (line 9) ─┐
raw_hit:email (line 42) ─┼─► mention:email (per line) ──► data_item:email (one per fixture)
```

- **Raw hits** — one finding per matching line; evidence must overlap the annotated span.
- **Mentions** — same line-level matching as raw hits, but keyed as mentions.
- **Data items** — identity-only matching: any hit with the rolled-up key satisfies the case; evidence anchors unread detection only.

### Graph grades

- **Component** keys use `${type}:${name.toLowerCase()}` (for example `third_party:stripe`, `asset:pg`).
- **Data flow** keys use `flow:${sourceComponentKey}->${targetComponentKey}`.

## Identity key conventions

Helpers live in `src/eval-layers/identities.ts`:

```ts
rawHitIdentity(ruleId)    // raw_hit:username
mentionIdentity(ruleId)   // mention:username
dataItemIdentity(ruleId)  // data_item:username
```

Component and data-flow adapters derive keys from `scan()` output; see `tests/eval/layers/components/adapter.ts` and `tests/eval/layers/data-flows/adapter.ts`.

Ground-truth case shape is defined in [tests/eval/ground-truth-schema.md](../../tests/eval/ground-truth-schema.md) and `tests/eval/types.ts`.

## Jest vs Plexus

| Concern | Jest (`tests/eval/`) | Plexus Gherkin (`features/`) |
|---------|----------------------|------------------------------|
| Spec source | TypeScript cases in `layers/*/cases.ts` | `.feature` files under `features/` |
| Runner | `jest tests/eval/**/*.test.ts` | `pnpm test:features` (Cucumber) |
| Scanner bridge | Layer `adapter.ts` files call ingest/scan or PII matchers | Steps spawn local GraphQL, load gold Items, run `plexus evaluate accuracy` |
| Layers exercised today | All five Jest layers (components, data-flows, raw-hits, mentions, data-items) | Recall scenarios via Span Overlap score; SubjectIdentityScore planned for identity-key grades |
| Metrics | Shared `tests/eval/score.ts` (recall, label accuracy, precision, negatives) | Plexus Evaluation record + headline recall from scorecard metrics |

Jest stays the fast, deterministic fixture harness. Plexus exercises end-to-end evaluation storage and scorecard integration against a local GraphQL process.

### Commands

```bash
pnpm test tests/eval/                    # all layer eval tests
pnpm run eval:components
pnpm run eval:data-flows
pnpm test tests/eval/layers/raw-hits/
pnpm test tests/eval/layers/mentions/
pnpm test tests/eval/layers/data-items/
pnpm test:features                       # Gherkin / Plexus scenarios
```

## Layout

```text
tests/eval/
  types.ts
  score.ts
  ground-truth-schema.md
  layers/
    raw-hits/     adapter.ts  cases.ts  eval.test.ts
    mentions/     ...
    data-items/   ...
    components/   ...
    data-flows/   ...
```

See also [tests/eval/README.md](../../tests/eval/README.md) for metrics definitions.
