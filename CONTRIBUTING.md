# Contributing to @dataparade/scanner

Thank you for contributing. This repository uses **Git Flow**, **Conventional Commits**, and **Semantic Release**.

## Git Flow

| Branch | Purpose |
| --- | --- |
| `develop` | Default integration branch. Open PRs here. |
| `main` | Production branch. Releases and npm publishes happen here. |
| `feature/*` | New work branches off `develop`, merge back to `develop`. |
| `release/*` | Stabilize a release from `develop`, merge to `main` and back to `develop`. |
| `hotfix/*` | Urgent fixes branch off `main`, merge to `main` and `develop`. |

Typical flow:

1. Branch from `develop`: `git checkout -b feature/my-change develop`
2. Open a PR into `develop`.
3. When ready to ship, open a `release/*` branch from `develop`, then merge it into `main` (and back into `develop` if needed).
4. Merging to `main` triggers Semantic Release (version bump, changelog, GitHub release, npm publish).

Do not merge feature work directly into `main`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with the Angular preset (for example `feat:`, `fix:`, `chore:`, `docs:`). Semantic Release reads commit messages on `main` to determine version bumps and generate release notes.

## Kanbus

This repository uses [Kanbus](https://kanb.us) for issue tracking. Initialize your environment with `kbs` and follow `CONTRIBUTING_AGENT.md`.

- Shared board lives in `project/` (initialized with `kbs init`).
- New issues use the **KDATAP** key prefix.
- Do not use `kbs create --local` or `project-local/`.
- Do not edit JSON under `project/issues/` or `project/events/` by hand; use `kbs` commands only.

## Development

```bash
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run test:coverage
pnpm run test:features   # Gherkin/Cucumber (see below)
pnpm run eval:components # Jest fixture eval layers
```

Node.js 20+ is required.

## Behavior specs and evaluation

Gherkin feature specs live under `features/` and are the source of truth for Plexus-backed evaluation scenarios. Jest fixture eval layers live under `tests/eval/`.

| Command | Purpose |
| --- | --- |
| `pnpm test:features` | Run Cucumber `.feature` files |
| `pnpm test` | Jest unit tests (`tests/**/*.spec.ts`) and eval layers (`tests/eval/**/*.test.ts`) |
| `pnpm run eval:components` | Component layer ground-truth eval |
| `pnpm run eval:data-flows` | Data-flow layer ground-truth eval |
| `pnpm run eval:raw-hits` | Raw pattern-hit layer ground-truth eval |
| `pnpm run eval:mentions` | Personal-data mention layer ground-truth eval |
| `pnpm run eval:data-items` | Rolled-up data-item layer ground-truth eval |

See `features/README.md` and `tests/eval/README.md` for layout and metrics.

### Plexus evaluation

Feature specs and corpus eval use the installed **`plexus` CLI on PATH** (not `python -m plexus` and not `PLEXUS_ROOT`).

Local Virtuus / GraphQL settings are declared in **`.plexus/config.yaml`**. Do not configure store, backend mode, or proxy behavior with `PLEXUS_STORE`, `PLEXUS_BACKEND_MODE`, or `PLEXUS_PROXY_*` env vars. Per-run **data directories** and **ports** may still be overridden at runtime (for example `PLEXUS_DATA_DIR` for a temp dir).

```bash
command -v plexus   # must resolve
pnpm run test:features
```

Scenarios that start a local GraphQL host require a **Virtuus-capable** `private-graphql-proxy` (`proxy/virtuus_store.py` + `proxy/store_factory.py`). Auto-discovery prefers `~/Projects/Plexus_worktrees/virtuus-store/services/private-graphql-proxy`. Override with `PLEXUS_GRAPHQL_PROXY_DIR`.

Start GraphQL manually (config from `.plexus/config.yaml`):

```bash
./scripts/start-local-graphql.sh
```

Optional runtime data-dir override:

```bash
PLEXUS_DATA_DIR=/tmp/plexus-data ./scripts/start-local-graphql.sh
```

Corpus recall against materialized benchmark repos:

```bash
./scripts/run-corpus-eval.sh
```

## CI and releases

- **CI** runs on pull requests and pushes to `develop` and `main` (install, build, lint, test, coverage).
- **Release** runs on pushes to `main` via Semantic Release.

### Repository secrets

Configure these in GitHub **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `NPM_TOKEN` | npm publish token for `@dataparade/scanner` |
| `GITHUB_TOKEN` | Provided by GitHub Actions; the release workflow needs `contents: write` permission to create releases and tags |

Without `NPM_TOKEN`, the release workflow can still create GitHub releases but npm publish will fail.
