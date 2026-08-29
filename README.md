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

Fixture ground truth lives under `tests/eval/layers/` with shared scoring in `tests/eval/score.ts`. Five grades cover the personal-data pipeline (raw hits, mentions, data items) and the component graph (components, data flows). Run `pnpm test tests/eval/` for deterministic Jest eval, or `pnpm run test:features` for Plexus Gherkin scenarios (`scanner-recall-evaluation.feature`, `scanner-layer-evaluation.feature`). See [tests/eval/README.md](./tests/eval/README.md) and [project/wiki/four-layer-evaluation.md](./project/wiki/four-layer-evaluation.md).

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
