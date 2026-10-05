# @dataparade/scanner

Deterministic DataParade scan engine: ingest → analyzers → YAML patterns → classifier → data-flow → `ScanResult`.

## Quick start

Scan a repository from a source checkout. The scan runs locally and needs no account, API key or network access.

```sh
git clone -b main https://github.com/DataParade-io/scanner.git
cd scanner
npm install            # Node 20+; builds dist/ (pnpm works too)
npm run scan -- /path/to/repo --out scan.json
```

It prints the components, data flows and personal-data items it found (emails, phone numbers, names, …) and writes the full result to `scan.json`. Point it at a service directory of a large monorepo for a faster first look.

## Public API

```ts
import { createDefaultScanConfiguration, scan } from "@dataparade/scanner";

const config = createDefaultScanConfiguration({ enableAiInference: false });
const { scanResult } = await scan("/path/to/repo", config);
```

`scan()` runs the structural pipeline only. AI enrichment, tracing, upload, and CLI wiring live in `@dataparade/cli`.

## How a scan works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/scan-pipeline-dark.svg">
  <img src="./docs/images/scan-pipeline-light.svg" alt="Scanner pipeline: repository files feed two tracks. Analyzers and patterns, the classifier, and data-flow detection produce components and data flows in the ScanResult. PII signal matching, tree-sitter language packs, and occurrence grouping produce occurrences and data items. Optional graphify and dataparade-graph.json sit below." width="100%">
</picture>

*One `scan()` runs two tracks over the same files: system structure (components and data flows) and personal-data occurrences grouped into data items. Dashed parts are optional.*

Occurrences of one concept (for example `email`) are joined into data items by ordered evidence phases; shown below.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/occurrence-grouping-dark.svg">
  <img src="./docs/images/occurrence-grouping-light.svg" alt="Occurrence grouping: the name on the line, tree-sitter facts, and the column catalog feed ordered join phases (declaration, name, field, call), then votes (receiver, table, weak-name, file) for sets still unnamed, with cannot-link rules refusing merges of different names or columns, ending in data item groups." width="100%">
</picture>

*Grouping phases live in `src/pii-signals/occurrence-group.ts`; the column catalog is in `src/analyze/column-catalog.ts`. Sources: `docs/diagrams/*.json` (regenerate with `docs/diagrams/export-svg.py`).*

## Evaluation

External clients (CLI, Primus) must import the published scorer boundary — do not ship local `eval/score/identity` copies:

```ts
import { evaluateLayerBucket, CANONICAL_CONTRACT_VERSION } from "@dataparade/scanner/eval";
```

Four headline layers (`occurrences`, `data-items`, `components`, `data-flows`) form the evaluation vector; `raw-hits` is diagnostic only. Contracts: `scorecard-vector/3`, `baseline-artifact/1`. There is no cross-layer Overall scalar.

Fixture ground truth lives under `tests/eval/layers/` with shared scoring in `tests/eval/score.ts` (delegates to `src/eval/`). Run `pnpm test tests/eval/` for deterministic Jest eval, or `pnpm run test:features` for Gherkin scenarios (Primus scores plus pinned corpus packets such as easy-school SSN). See [tests/eval/README.md](./tests/eval/README.md) and [project/wiki/four-layer-evaluation.md](./project/wiki/four-layer-evaluation.md).

## Development

```bash
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run test:coverage
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Git Flow, Conventional Commits, Semantic Release, Kanbus workflow, and Primus evaluation (`primus` on PATH).

## License

GPL-3.0-or-later
