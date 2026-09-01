# @dataparade/scanner

Deterministic DataParade scan engine: ingest → analyzers → YAML patterns → classifier → data-flow → `ScanResult`.

## Public API

```ts
import { createDefaultScanConfiguration, scan } from "@dataparade/scanner";

const config = createDefaultScanConfiguration({ enableAiInference: false });
const { scanResult } = await scan("/path/to/repo", config);
```

`scan()` runs the structural pipeline only. AI enrichment, tracing, upload, and CLI wiring live in `@dataparade/cli`.

## Evaluation

External clients (CLI, Plexus) must import the published scorer boundary — do not ship local `eval/score/identity` copies:

```ts
import { evaluateLayerBucket, CANONICAL_CONTRACT_VERSION } from "@dataparade/scanner/eval";
```

Four headline layers (`mentions`, `data-items`, `components`, `data-flows`) form the evaluation vector; `raw-hits` is diagnostic only. Contracts: `scorecard-vector/2`, `baseline-artifact/1`. There is no cross-layer Overall scalar.

Fixture ground truth lives under `tests/eval/layers/` with shared scoring in `tests/eval/score.ts` (delegates to `src/eval/`). Run `pnpm test tests/eval/` for deterministic Jest eval, or `pnpm run test:features` for Plexus Gherkin scenarios. See [tests/eval/README.md](./tests/eval/README.md) and [project/wiki/four-layer-evaluation.md](./project/wiki/four-layer-evaluation.md).

## Development

```bash
pnpm install
pnpm run build
pnpm test
pnpm run lint
pnpm run test:coverage
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Git Flow, Conventional Commits, Semantic Release, Kanbus workflow, and Plexus evaluation (`plexus` on PATH).

## License

GPL-3.0-or-later
