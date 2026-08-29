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

Gherkin specs exercise Plexus-backed recall; Jest fixture eval under `tests/eval/layers/` covers the same grades deterministically. See [project/wiki/four-layer-evaluation.md](../project/wiki/four-layer-evaluation.md) and [tests/eval/ground-truth-schema.md](../tests/eval/ground-truth-schema.md).

| Scenario file | Grade | What it proves |
|---------------|-------|----------------|
| `scanner-recall-evaluation.feature` | Mention / span recall | Gold Items evaluated with Span Overlap; unread files omitted from denominator; ingested misses count |
| `plexus-eval.feature` | Harness separation | Gherkin is the Plexus spec source; Jest patterns stay under `tests/` |
| `scan-findings.feature` | Component / pipeline | Scanner output shape for local fixtures |
| `gold-import.feature` | Gold corpus | Annotations import as labeled Items |

### Planned Plexus scenarios

- **SubjectIdentityScore** — identity-key matching for `raw_hit:*`, `mention:*`, and `data_item:*` grades (parallel to Jest `tests/eval/layers/{raw-hits,mentions,data-items}/`).
- **Per-layer recall datasets** — scorecard datasets aligned with committed fixture ground truth, mirroring Jest `cases.ts` coverage.

### Jest-only layers (reference)

| Layer | Test path |
|-------|-----------|
| Raw pattern hits | `tests/eval/layers/raw-hits/eval.test.ts` |
| Mentions | `tests/eval/layers/mentions/eval.test.ts` |
| Data items | `tests/eval/layers/data-items/eval.test.ts` |
| Components | `tests/eval/layers/components/eval.test.ts` |
| Data flows | `tests/eval/layers/data-flows/eval.test.ts` |
