# Gherkin feature specs

Executable behavior specs for Plexus-backed evaluation. Gherkin files here are the spec source of truth.

## Commands

- `pnpm test:features` — run `.feature` files with Cucumber
- `pnpm test` — run Jest unit and eval tests (`tests/**/*.spec.ts`, `tests/eval/**/*.test.ts`)

Add new scenarios under `features/` and matching step definitions under `features/steps/`.

## Prerequisites

1. **`plexus` on PATH** — the installed Plexus CLI (for example via conda: `command -v plexus`)
2. **Virtuus-capable private-graphql-proxy** — for scenarios that start a local GraphQL host. The proxy must include `proxy/virtuus_store.py` and `proxy/store_factory.py` (Plexus PR #612). Discovery order: `PLEXUS_GRAPHQL_PROXY_DIR`, then `~/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy`, then other Plexus checkouts only when that working tree has Virtuus store files.

`PLEXUS_ROOT` is not required. Eval scenarios invoke:

```bash
plexus evaluate accuracy --yaml --scorecard "Local Eval" --score "Span Overlap" --dataset-file ...
```

## Plexus configuration

Local evaluation settings live in **`.plexus/config.yaml`** (Virtuus store, local backend mode, proxy auth). Do not drive those via `PLEXUS_STORE`, `PLEXUS_BACKEND_MODE`, or `PLEXUS_PROXY_*` environment variables.

Per-test **data directories** and **ports** are runtime overrides only (for example `PLEXUS_DATA_DIR` for a temp dir, or `PLEXUS_GRAPHQL_PORT` when binding an ephemeral port).

## Local GraphQL host process

Start Plexus GraphQL as a single uvicorn worker with Virtuus file storage (no Docker or Postgres). Static config is read from `.plexus/config.yaml`:

```bash
./scripts/start-local-graphql.sh
```

Use a temp data directory when you need an isolated store:

```bash
PLEXUS_DATA_DIR=/tmp/plexus-data ./scripts/start-local-graphql.sh
```

Then check readiness and create an Item:

```bash
curl -sS http://127.0.0.1:8000/readyz

curl -sS http://127.0.0.1:8000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation CreateItem($input: CreateItemInput!) { createItem(input: $input) { id accountId text } }","variables":{"input":{"id":"demo-item","accountId":"demo-account","text":"hello"}}}'
```

The `local-graphql-process` feature is skipped automatically when no Virtuus-capable proxy is available on disk.

## Layer evaluation scenarios

Gherkin specs exercise Plexus-backed recall; Jest fixture eval under `tests/eval/layers/` covers the same layers deterministically. See [project/wiki/four-layer-evaluation.md](../project/wiki/four-layer-evaluation.md) and [tests/eval/ground-truth-schema.md](../tests/eval/ground-truth-schema.md).

| Scenario file | Layer(s) | What it proves |
|---------------|----------|----------------|
| `scanner-recall-evaluation.feature` | Mentions (headline) | Gold Items evaluated with Span Overlap; unread files omitted from denominator; ingested misses count |
| `scanner-layer-evaluation.feature` | Raw hits (diagnostic) / mentions / data items | Gold Items evaluated with Raw Hit Identity, Mention Identity, Subject Identity (`SubjectIdentityScore`), Raw Hit Span, and Mention Span (`SubjectSpanOverlapScore`) via layer findings commands; unread skip and ingested miss behavior |
| `plexus-eval.feature` | Harness separation | Gherkin is the Plexus spec source; Jest patterns stay under `tests/` |
| `scan-findings.feature` | Components / pipeline | Scanner output shape for local fixtures |
| `gold-import.feature` | Gold corpus | Annotations import as labeled Items |
| `canonical-evaluation-representation.feature` | Canonical IR contract | Versioned representation behaviour spec (KDATAP-b18135); scenarios pending until KDATAP-06634c |

`scanner-layer-evaluation` scenarios are skipped automatically when a required Plexus score class (SubjectIdentityScore, SubjectSpanOverlapScore, or SourceSpanOverlapScore) is not installed.

### Layer evaluation scores and findings bridge

Layer evaluation invokes Plexus scores **directly as Python modules** (no GraphQL server, no `plexus evaluate accuracy` CLI). Step definitions call `features/scripts/run-layer-score-eval.py` via the Plexus venv Python (`PYTHON` env).

| Score | Plexus class | Identity prefix | Findings command |
|-------|--------------|-----------------|------------------|
| Subject Identity | SubjectIdentityScore | `data_item:` | `scripts/scan-layer-findings.ts` |
| Raw Hit Identity | SubjectIdentityScore | `raw_hit:` | `scripts/scan-layer-findings.ts` |
| Mention Identity | SubjectIdentityScore | `mention:` | `scripts/scan-layer-findings.ts` |
| Raw Hit Span | SubjectSpanOverlapScore | `raw_hit:` (span overlap) | `features/scripts/flatten-span-findings.ts` |
| Mention Span | SubjectSpanOverlapScore | `mention:` (span overlap) | `features/scripts/flatten-span-findings.ts` |

Identity scores match on `subjectKey` only. Span scores require flattened `filePath` / `startLine` / `endLine` on each finding; `flatten-span-findings.ts` expands `evidenceLocations` from the layer scanner payload.

### Gherkin datasets vs Jest `cases.ts` patterns

Representative parity (not one scenario per Jest case):

| Pattern | Jest reference | Gherkin dataset |
|---------|----------------|-----------------|
| Positive identity hit | `*-jvm-yaml-username`, `*-java-email-parameter` | `*-identity-hit.csv`, `data-item-hit.csv` on `scan-findings/app.py` |
| Ingested identity miss | `*-ts-passport-*`, `*-py-no-email` | `*-identity-miss.csv` with `*:passport` |
| Identity-only evidence | `data-item-jvm-username-identity-only` | `data-item-identity-only.csv` (evidence line ≠ hit span) |
| Multi-file rollup | `data-item-jvm-username-multi-file` | `data-item-multi-file.csv` on `repos/jvm-manifests-basic` |
| Unread skip | unread detection in eval harness | `raw-hit-identity-unread.csv`, `raw-hit-unread.csv` |
| Span overlap hit | mention/raw span positives | `raw-hit-hit.csv`, `mention-hit.csv` |
| Span ingested miss | non-overlapping gold span | `raw-hit-miss.csv` |

Fixtures live under `features/fixtures/scanner-recall-eval/` (datasets, scorecards, and `repos/` for Jest-parity source trees).

`canonical-evaluation-representation` scenarios return **pending** (not skipped) until the canonical IR types land in KDATAP-06634c. See [`tests/eval/canonical-representation.md`](../tests/eval/canonical-representation.md).

### Jest layer tests (reference)

| Layer | Role | Test path |
|-------|------|-----------|
| Raw hits | Diagnostic | `tests/eval/layers/raw-hits/eval.test.ts` |
| Mentions | Headline | `tests/eval/layers/mentions/eval.test.ts` |
| Data items | Headline | `tests/eval/layers/data-items/eval.test.ts` |
| Components | Headline | `tests/eval/layers/components/eval.test.ts` |
| Data flows | Headline | `tests/eval/layers/data-flows/eval.test.ts` |
