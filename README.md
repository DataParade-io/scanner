# @dataparade/scanner

Deterministic DataParade scan engine: ingest → analyzers → YAML patterns → classifier → data-flow → `ScanResult`.

## Public API

```ts
import { createDefaultScanConfiguration, scan } from "@dataparade/scanner";

const config = createDefaultScanConfiguration({ enableAiInference: false });
const { scanResult } = await scan("/path/to/repo", config);
```

`scan()` runs the structural pipeline only. AI enrichment, tracing, upload, and CLI wiring live in `@dataparade/cli`.

## License

GPL-3.0-or-later
