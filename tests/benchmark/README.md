# Scanner evaluation benchmark corpus

Imported from the public `dataparade-cli` snapshot (2026-08-31) so a CLI release sync cannot delete this gold. The canonical home is this repo (`DataParade-io/scanner`), not the GPL publish mirror.

Versioned ground-truth data for deterministic scanner evaluation. Labels are curated independently of scanner output. Headline denominators use `review_state: accepted`.

On load, corpus layer `pii_signals` normalizes to `mentions` for legacy type compat only. Gold subject keys use `mention:<rule_id>` (canonical) or `mention:<taxonomy_suffix>` (adjudication bookmarks).

Canonical corpus layers are `components`, `data_flows`, `mentions`, and `data_items`.

As of 2026-08-30 accepted positives: components 519, data_flows 419, pii_signals 325, data_items 302. Original-ten packets still have leftover proposed non-positive or unaccepted records from earlier curation.


## Layout

```text
tests/benchmark/
  schema.ts           # TypeScript types mirroring ground-truth-schema.md
  manifest.ts         # load/validate manifests and annotations
  repos/
    <repo-key>/
      manifest.yaml   # pinned commit, scope, coverage metadata
      layer-scopes.yaml  # reviewed closed-world precision scope per layer
      annotations/
        components.yaml
        data_flows.yaml
        mentions.yaml
        data_items.yaml
  scripts/
    materialize-repo.ts   # optional local clone helper (not run in CI)
  .cache/               # materialized clones (gitignored)
```

## Current corpus packets

Twenty-nine pinned packets live under `repos/`: the original ten (gitea, saleor, keycloak, hyperswitch-vault, medusa-customer, posthog-user, yjdh-employee, vgs-django, easy-school, ory-kratos-password) plus 19 expansion repos (discourse, redmine, wordpress, magento, nopcommerce, orchard-core, spring-petclinic, pocketbase, ghost, directus, spree, strapi, flask-login, exposed, vapor, supabase-js, auth0-express, drupal, medusa).

`vgs-django` and `easy-school` remain the starter packets for unit tests. License notes in those manifests are unchanged.


## Annotation workflow

1. Proposed annotations start in `review_state: proposed`.
2. A reviewer inspects pinned source at the evidence location (Grok span-check for the 2026-08-30 expansion fill; Ryan accepted that gold without a second pass) and sets `review_state` to `accepted` or `rejected`.
3. Only `accepted` annotations count toward headline evaluation denominators. Reviewed closed-world precision scope lives in `layer-scopes.yaml` per layer (`review_state: accepted` only).

Component subject keys use the evaluator identity convention: `type:name` with a lowercase name (for example `asset:database`, `third_party:checkr`).

## Serialization alignment

These YAML files are the human-review source of truth during corpus curation. Final runtime serialization will align with `tests/eval/types.ts` once DATAP-c7dd46 lands. Until then, `schema.ts` and `manifest.ts` define the committed corpus contract.

## Eval integration

`to-eval-cases.ts` converts loaded `AnnotationRecord[]` values into `EvalCase[]` for the evaluator in `tests/eval/types.ts`.

- Maps `subject.key`, evidence line pointers, and `expected.status` / `expected.labels` directly.
- Skips `rejected` annotations; includes `accepted` by default.
- Proposed (and `needs_adjudication`) annotations are omitted unless `includeProposed: true` is passed.
- Benchmark annotations do not set `documentedGap` on eval cases.

Example:

```typescript
import { loadAnnotations } from "./manifest";
import { annotationsToEvalCases } from "./to-eval-cases";

const annotations = loadAnnotations(repoDir, "components");
const evalCases = annotationsToEvalCases(annotations, "vgs-django");
```

## Local materialization (optional)

Clone pinned repositories for local benchmark development:

```bash
pnpm run benchmark:materialize hyperswitch-vault
pnpm run benchmark:materialize --all
```

Clones land in `tests/benchmark/.cache/repos/<key>@<commit>/`. The script is idempotent and uses sparse checkout when scope paths are listed in the manifest.

`pnpm run benchmark:materialize` compiles with `tsc` then executes `dist/tests/benchmark/scripts/materialize-repo.js`.

## Candidate inventory

`candidates.yaml` preserves the repository research queue separately from executable
benchmark ground truth. A pinned commit and observed license do not make a candidate
accepted: each candidate still needs a manageable exhaustive scope, scanner-blind
proposed annotations, and human review before it may enter evaluation denominators.

**This script is not part of `pnpm test`.** CI validates committed YAML only; it does not clone upstream repositories.

## Running the benchmark (opt-in)

After materializing one or more repositories locally, run the component-layer benchmark against pinned clones:

```bash
pnpm run benchmark:materialize vgs-django
pnpm run benchmark:run vgs-django

# all materialized starter repos
pnpm run benchmark:materialize --all
pnpm run benchmark:run

# include proposed annotations (not headline denominators)
pnpm run benchmark:run --include-proposed vgs-django
```

`benchmark:run` materializes nothing. It scans `tests/benchmark/.cache/repos/<key>@<commit>/`, loads **accepted** annotations by default, and scores **each layer separately** via `tests/eval/score.ts` (see `tests/eval/README.md` for the identity and unread contract). The report prints per-layer recall, label accuracy, precision, and unread counts. Raw hits are labeled diagnostic. There is no cross-layer overall score.

The corpus runner tags findings by layer (`scanRepoByManifestLayers`) so PII regex hits cannot pollute component precision. `pnpm run benchmark:run` compiles with `tsc` then executes `dist/tests/benchmark/run-benchmark.js`.

## Four-layer scorecard vector (opt-in)

`benchmark:scorecard` emits the headline evaluation vector: `mentions`, `data-items`, `components`, and `data-flows`. Raw hits are included only as a diagnostic sidecar and never participate in headline gates.

```bash
pnpm run benchmark:materialize vgs-django
pnpm run benchmark:scorecard vgs-django

# write JSON + Markdown under tests/benchmark/reports/
pnpm run benchmark:scorecard -- --write-report tests/benchmark/reports/scorecard-vector.json
```

### Contract (`scorecard-vector/1`)

| Field | Meaning |
| --- | --- |
| `layers` | One entry per headline layer with per-layer `scores`, `computability`, and `gate` |
| `diagnostic.raw-hits` | Diagnostic-only raw pattern-hit metrics |
| `packets` | Per-repository rows used to build corpus totals |

**Aggregation:** corpus metrics within each layer sum denominators across packets and recompute rates (pooled counts). The vector never publishes a cross-layer scalar, overall score, or blended average.

**Gates (this slice):** per-layer computability gates only — `scorable`, `pending`, `skip`, or `provisional`. Numeric recall/precision floors belong to the baseline-readiness epic.

| Layer | Typical gate |
| --- | --- |
| `mentions`, `data-items`, `components` | `scorable` when eval cases exist and the run is accepted-only |
| `data-flows` | `pending` — canonical compat marks legacy flow gold `needs_adjudication`, so recall is honestly `null` until adjudication lands |
| any layer, provisional run | `provisional` |
| layer with no eval cases | `skip` |

`pnpm run benchmark:scorecard` compiles with `tsc` then executes `dist/tests/benchmark/run-four-layer-scorecard.js`.

**This script is not part of `pnpm test`.** Unit tests mock scans and use temporary fixtures — no network or git clones in CI.

## Detection coverage census (opt-in)

Before forecasting what structured component identity buys, measure per-packet detection coverage: files ingested, components emitted, data flows emitted, and accepted component gold matched under three identity schemes (`type:name`, `type:subType`, hybrid). No spans, no scoring.

```bash
pnpm run benchmark:materialize -- --all
pnpm run benchmark:census -- --write-report
```

Reports land in `tests/benchmark/reports/detection-coverage-census.{json,md}`. Materialized clones stay in `tests/benchmark/.cache/` (gitignored — never commit them).

If materialization cannot finish (network/disk), land the runner and unit tests, list failed packets, and escalate — do not invent census numbers.

**This script is not part of `pnpm test`.** CI validates the runner via mocked unit tests only.

## Adding a repository

1. Create `repos/<key>/manifest.yaml` per [ground-truth-schema.md](../eval/ground-truth-schema.md).
2. Add layer annotation files under `annotations/`.
3. Extend `tests/unit/benchmark/manifest.spec.ts`.
4. Materialize locally to verify evidence pointers against the pinned commit.
