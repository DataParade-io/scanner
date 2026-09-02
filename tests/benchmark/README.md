# Scanner evaluation benchmark corpus

Imported from the public `dataparade-cli` snapshot (2026-08-31) so a CLI release sync cannot delete this gold. The canonical home is this repo (`DataParade-io/scanner`), not the GPL publish mirror.

Versioned ground-truth data for deterministic scanner evaluation. Labels are curated independently of scanner output. Headline denominators use `review_state: accepted`.

Canonical corpus layers are `components`, `data_flows`, `mentions`, and `data_items`. Gold subject keys use `mention:<rule_id>` when rule-aligned, or `mention:<taxonomy_suffix>` for adjudication bookmarks.

As of 2026-08-30 accepted positives: components 519, data_flows 419, mentions 325, data_items 302. Original-ten packets still have leftover proposed non-positive or unaccepted records from earlier curation.


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

`benchmark:run` materializes nothing. It scans `tests/benchmark/.cache/repos/<key>@<commit>/`, loads **accepted** annotations by default, and scores **each layer separately** via `tests/eval/score.ts` (see `tests/eval/README.md` for the identity and unread contract). The report prints per-layer recall, label accuracy, precision, and unread counts. Raw hits are labeled diagnostic. Fixture eval also has a diagnostic `data-actions` layer (privacy verbs); it is not a scorecard headline gate. There is no cross-layer overall score.

The corpus runner tags findings by layer (`scanRepoByManifestLayers`) so PII regex hits cannot pollute component precision. `pnpm run benchmark:run` compiles with `tsc` then executes `dist/tests/benchmark/run-benchmark.js`.

## Four-layer scorecard vector (opt-in)

`benchmark:scorecard` emits the headline evaluation vector: `mentions`, `data-items`, `components`, and `data-flows`. Raw hits are included only as a diagnostic sidecar and never participate in headline gates. The fixture `data-actions` diagnostic layer is also excluded from `scorecard-vector/2` headlines (and is not part of the `diagnostic.raw-hits` sidecar).

```bash
pnpm run benchmark:materialize vgs-django
pnpm run benchmark:scorecard vgs-django

# write JSON + Markdown under tests/benchmark/reports/
pnpm run benchmark:scorecard -- --write-report tests/benchmark/reports/scorecard-vector.json
```

### Contract (`scorecard-vector/2`)

| Field | Meaning |
| --- | --- |
| `layers` | One entry per headline layer with per-layer `scores`, structured `computability` (per-metric state + scope counts), `gate`, and `accounting` |
| `accounting` | Per-layer population counts, coverage (entity-weighted + distinct-file), eligibility by reason, migration-incomplete blockers, gate exceptions, and diagnostic slices (capability + language) |
| `computability.metrics` | Per-metric `{ state, value, numerator, denominator }` for recall, ancestor-category recall, precision, and negative pass rate |
| `computability.scope` | `reviewedScopeFileCount` and `processedScopeFileCount` retained even when rates are null |
| `diagnostic.raw-hits` | Diagnostic-only raw pattern-hit metrics |
| `packets` | Per-repository rows with the same per-layer fields used to build corpus totals |

**Metric states:** `no_reviewed_scope`, `reviewed_scope_unprocessed`, `processed_scope_zero_predictions`, `migration_incomplete_or_not_ready`, `unscorable_provenance`, `computable`. An empty processed prediction denominator is not the same as absent scope.

**Aggregation:** corpus metrics within each layer sum denominators and scope counts across packets, then recompute rates and per-metric states (pooled counts). The vector never publishes a cross-layer scalar, overall score, or blended average.

**Gates (rollup only):** per-layer `gate.status` — `scorable`, `pending`, `skip`, or `provisional`. Per-metric computability is authoritative; a computable recall is not hidden when precision is `no_reviewed_scope`. Numeric recall/precision floors belong to the baseline-readiness epic.

| Layer | Typical gate |
| --- | --- |
| `mentions`, `data-items`, `components` | `scorable` when eval cases exist and the run is accepted-only |
| `data-flows` | `pending` — canonical compat marks legacy flow gold `needs_adjudication`, so recall is honestly `null` until adjudication lands |
| any layer, provisional run | `provisional` |
| layer with no eval cases | `skip` |

`pnpm run benchmark:scorecard` compiles with `tsc` then executes `dist/tests/benchmark/run-four-layer-scorecard.js`.

**This script is not part of `pnpm test`.** Unit tests mock scans and use temporary fixtures — no network or git clones in CI.

## Baseline artifact (schema)

The immutable corpus baseline is defined under `tests/benchmark/baseline/` as versioned JSON (`baseline-artifact/1`) with a deterministic Markdown renderer. JSON is the source artifact; Markdown is generated from it.

| Piece | Location |
| --- | --- |
| Types + Zod schema | `tests/benchmark/baseline/types.ts` |
| Fingerprint collector | `tests/benchmark/baseline/fingerprint.ts` |
| Artifact builder | `tests/benchmark/baseline/build-baseline-artifact.ts` |
| Markdown renderer | `tests/benchmark/baseline/render-markdown.ts` |
| Fixture round-trip | `tests/fixtures/baseline/minimal-baseline-artifact.{json,md}` |

The artifact embeds a `scorecard-vector/2` payload verbatim (no second scorer, no cross-layer scalar), a fingerprint block (scanner commit, corpus/gold digest, contract and taxonomy digests, materialization status per packet, deterministic config with `enableAiInference: false`), gold-population and migration-incomplete accounting, capability coverage as diagnostic-only metadata, and a readiness stub (`not_evaluated`). Series 1 uses `predecessor: null`.

## CI validation policy

Two lanes keep pull requests fast while still exercising the full pinned corpus offline.

| Lane | Trigger | Clones upstream packets? | Commands |
| --- | --- | --- | --- |
| PR smoke | every pull request (`.github/workflows/ci.yml`) | **No** | `pnpm run ci:smoke` |
| Full corpus | weekly schedule, manual dispatch, optional release hook (`.github/workflows/baseline-corpus.yml`) | **Yes** (all 29) | `benchmark:materialize -- --all` then `benchmark:validate-materializations` |

**PR smoke** runs an allowlisted Jest subset only:

- `tests/eval/contract/contract.spec.ts` — synthetic evaluator contract fixtures
- `tests/unit/benchmark/baseline-artifact.spec.ts` — `baseline-artifact/1` schema + JSON↔MD round-trip
- `tests/unit/benchmark/scorecard-vector.spec.ts` and `run-four-layer-scorecard.spec.ts` — `scorecard-vector/2`
- `tests/unit/eval/canonical-computability.spec.ts` — per-metric computability states
- `tests/unit/benchmark/ci-smoke-digests.spec.ts` — pinned corpus/taxonomy/concept-map/adapter digests under `tests/fixtures/baseline/pins/`
- `tests/unit/docs/evaluation-docs-contract.spec.ts` — evaluation prose aligned with layer constants and contract versions

Corpus YAML for all 29 packets is still validated offline via `tests/unit/benchmark/corpus-gold.spec.ts` inside the regular `pnpm test` job. Lockfile drift is enforced by `pnpm install --frozen-lockfile` in CI (no separate lock digest pin).

**Full corpus** materializes every pinned packet, then requires `validationStatus: valid` and matching `validatedHeadSha` for each packet. Partial manual dispatches may skip validation when `repo_keys` is set.

Published baselines (future series 1) use:

```bash
pnpm run benchmark:validate-baseline -- <path/to/baseline.json> \
  --require-valid-materializations --verify-digests --verify-markdown
```

Freezing series 1 and readiness numeric floors remain separate issues (`KDATAP-3b935c`, `KDATAP-b87baf`).

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
