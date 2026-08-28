# Gherkin feature specs

Executable behavior specs for Plexus-backed evaluation. Gherkin files here are the spec source of truth.

## Commands

- `pnpm test:features` — run `.feature` files with Cucumber
- `pnpm test` — run Jest unit and eval tests (`tests/**/*.spec.ts`, `tests/eval/**/*.test.ts`)

Add new scenarios under `features/` and matching step definitions under `features/steps/`.

## Prerequisites

1. **`plexus` on PATH** — the installed Plexus CLI (for example via conda: `command -v plexus`)
2. **private-graphql-proxy** — for scenarios that start a local GraphQL host. The step helpers auto-discover `~/projects/Plexus/services/private-graphql-proxy` (or `~/Projects/Plexus/...`). Override with `PLEXUS_GRAPHQL_PROXY_DIR` when needed.

`PLEXUS_ROOT` is not required. Eval scenarios invoke:

```bash
plexus evaluate accuracy --yaml --scorecard "Local Eval" --score "Span Overlap" --dataset-file ...
```

## Local GraphQL host process

Start Plexus GraphQL as a single uvicorn worker with Virtuus file storage (no Docker or Postgres):

```bash
PLEXUS_DATA_DIR=/tmp/plexus-data \
./scripts/start-local-graphql.sh
```

Then check readiness and create an Item:

```bash
curl -sS http://127.0.0.1:8000/readyz

curl -sS http://127.0.0.1:8000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation CreateItem($input: CreateItemInput!) { createItem(input: $input) { id accountId text } }","variables":{"input":{"id":"demo-item","accountId":"demo-account","text":"hello"}}}'
```

The `local-graphql-process` feature is skipped automatically when `private-graphql-proxy` is not available on disk.
