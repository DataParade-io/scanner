# Four-layer scanner evaluation

The scanner measures detection quality at four **headline layers** — `mentions`, `data-items`, `components`, and `data-flows` — assembled into a `scorecard-vector/2` payload. There is **no cross-layer scalar**: each layer is scored independently and metrics pool within a layer only.

A fifth Jest layer, `raw-hits`, is **diagnostic only**. It is scanned, reported in fixture eval, and included as a scorecard sidecar (`diagnostic.raw-hits`), but it does not participate in headline gates.

A sixth Jest layer, `data-actions`, is also **diagnostic only** (privacy verbs on nodes). It is exercised in fixture eval via `pnpm run eval:data-actions` and is **not** a `scorecard-vector/2` headline gate or part of the `diagnostic.raw-hits` sidecar.

## Headline layers

| Layer | Layer key | What it measures | Identity prefix |
|-------|-----------|------------------|-----------------|
| Mentions | `mentions` | File+line receipt that a personal-data concept was seen | `mention:<key>` |
| Data items | `data-items` | Unique personal-data concept in a fixture (rolled up across lines/files) | `data_item:<key>` |
| Components | `components` | Detected asset or third party from the scan pipeline | `<type>:<name>` (lowercase) |
| Data flows | `data-flows` | Directed edge between two components | `flow:<sourceKey>-><targetKey>` |

### Personal-data roll-up

```text
mention:email (line 9)  ─┐
mention:email (line 42) ─┼─► data_item:email (one per fixture)
```

- **Mentions** — one finding per matching line; evidence must overlap the annotated span.
- **Data items** — identity-only matching: any hit with the rolled-up key satisfies the case; evidence anchors unread detection only.

### Diagnostic raw-hits

```text
raw_hit:email (line 9)  ──► diagnostic span check (not a headline gate)
raw_hit:email (line 42) ──► diagnostic span check (not a headline gate)
```

Raw hits use the same heuristic matcher as mentions today but carry `raw_hit:` identity and feed the diagnostic sidecar only.

### Diagnostic data-actions

```text
asset:pg     + label store    ──► diagnostic verb presence (not a headline gate)
third_party:stripe + disclose ──► diagnostic verb presence (not a headline gate)
```

Data-actions reuse component identity (`${type}:${name}`); expected labels are asserted canonical verbs from `properties.dataActions`. Candidates (`status: candidate`) are never gold-positive labels.

### Graph layers

- **Component** keys use `${type}:${name.toLowerCase()}` (for example `third_party:stripe`, `asset:pg`).
- **Data flow** keys use `flow:${sourceComponentKey}->${targetComponentKey}`.

## Identity key conventions

Helpers live in `src/eval-layers/identities.ts`:

```ts
rawHitIdentity(ruleId)    // raw_hit:username  (diagnostic)
mentionIdentity(ruleId)   // mention:username
dataItemIdentity(ruleId)  // data_item:username
```

Component and data-flow adapters derive keys from `scan()` output; see `tests/eval/layers/components/adapter.ts` and `tests/eval/layers/data-flows/adapter.ts`.

Ground-truth case shape is defined in [tests/eval/ground-truth-schema.md](../../tests/eval/ground-truth-schema.md) and `tests/eval/types.ts`. Canonical field groups are in [tests/eval/canonical-representation.md](../../tests/eval/canonical-representation.md).

## Jest vs Plexus

| Concern | Jest (`tests/eval/`) | Plexus Gherkin (`features/`) |
|---------|----------------------|------------------------------|
| Spec source | TypeScript cases in `layers/*/cases.ts` | `.feature` files under `features/` |
| Runner | `jest tests/eval/**/*.test.ts` | `pnpm test:features` (Cucumber) |
| Scanner bridge | Layer `adapter.ts` files call ingest/scan or PII matchers | Steps spawn local GraphQL, load gold Items, run `plexus evaluate accuracy` |
| Layers exercised today | All Jest layers including diagnostic `raw-hits` and `data-actions` | Span Overlap recall (`scanner-recall-evaluation.feature`); personal-data recall via Raw Hit Span, Mention Span, and Subject Identity (`scanner-layer-evaluation.feature`, skipped when a score class is not installed) |
| Metrics | Shared `tests/eval/score.ts` (per-layer recall, label accuracy, precision, negatives) | Plexus Evaluation record + headline recall from scorecard metrics |

Jest stays the fast, deterministic fixture harness. Plexus exercises end-to-end evaluation storage and scorecard integration against a local GraphQL process.

### Commands

```bash
pnpm test tests/eval/                    # all layer eval tests
pnpm run eval:components
pnpm run eval:data-flows
pnpm test tests/eval/layers/raw-hits/    # diagnostic layer
pnpm run eval:data-actions               # diagnostic layer (after adapter/cases land)
pnpm test tests/eval/layers/mentions/
pnpm test tests/eval/layers/data-items/
pnpm test:features                       # Gherkin / Plexus scenarios (layer eval skips without SubjectIdentityScore)
```

Layer findings for Plexus SubjectIdentityScore:

```bash
node -r ts-node/register scripts/scan-layer-findings.ts --root tests/fixtures/jvm-manifests-basic --layer raw-hits
```

## Layout

```text
tests/eval/
  types.ts
  score.ts
  ground-truth-schema.md
  layers/
    raw-hits/     adapter.ts  cases.ts  eval.test.ts  (diagnostic)
    mentions/     ...
    data-items/   ...
    components/   ...
    data-flows/   ...
```

See also [tests/eval/README.md](../../tests/eval/README.md) for metrics definitions and [tests/benchmark/README.md](../../tests/benchmark/README.md) for `scorecard-vector/2` and `baseline-artifact/1`.
