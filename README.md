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

Four headline layers (`occurrences`, `data-items`, `components`, `data-flows`) form the evaluation vector; `raw-hits` is diagnostic only. Contracts: `scorecard-vector/3`, `baseline-artifact/1`. There is no cross-layer Overall scalar.

Fixture ground truth lives under `tests/eval/layers/` with shared scoring in `tests/eval/score.ts` (delegates to `src/eval/`). Run `pnpm test tests/eval/` for deterministic Jest eval, or `pnpm run test:features` for Gherkin scenarios (Plexus scores plus pinned corpus packets such as easy-school SSN). See [tests/eval/README.md](./tests/eval/README.md) and [project/wiki/four-layer-evaluation.md](./project/wiki/four-layer-evaluation.md).

## Sentiment meter

A counts-only "coding-session sentiment meter" (thanks vs. F-bombs) scans local AI coding sessions and prints an aggregate vibe gauge. Everything stays local and the output contains **counts only — never message text**.

```bash
pnpm run sentiment:meter -- --window 24h        # rolling last 24 hours
pnpm run sentiment:meter -- --window 3d         # rolling last 3 days
pnpm run sentiment:meter -- --window today --day-start 04:00
pnpm run sentiment:meter -- --window yesterday --timezone America/Los_Angeles
pnpm run sentiment:meter -- --since 2026-10-01T00:00:00Z --until 2026-10-02T00:00:00Z
pnpm run sentiment:meter -- --sources claude-code,codex
pnpm run sentiment:meter -- --doctor            # per-source discovery diagnostics
```

- **Sources**: Claude Code (`~/.claude/projects/**.jsonl`), Cursor (`state.vscdb` plus `~/.cursor` agent transcripts), Codex (`~/.codex/sessions`), Grok Bot (`~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`), Antigravity (`~/.gemini/antigravity{,-cli}/conversations/*.db` + `conversation_summaries.db`).
- **Windows**: rolling `24h`/`Nh`/`Nd` plus calendar `today`/`yesterday`. Calendar windows are anchored at a configurable day-start time (default: local midnight) with correct timezone/DST handling (spring-forward gaps clamp forward, fall-back ambiguity resolves earlier).
- **Privacy**: the default word lists only detect gratitude and profanity token families; no network-capable imports exist under `src/sentiment/` (enforced by test), and neither output nor scan-state cache ever stores verbatim message text.
- **Exclusions**: fenced/indented code blocks, blockquotes, and pasted text blobs are never counted. Paste detection requires both length (>= 4000 chars) and web-answer citation density (>= 3 `[n]` markers) — tuned on real corpora so the operator's own long orchestration briefs still count (tunable via `ExclusionThresholds`).
- **Configuration**: `~/.config/dataparade/sentiment.meter.yaml` (`timezone`, `dayStart`, `sources`, `roots`, `words`); CLI flags override config, which overrides defaults.
- **Engines**: the Cursor `state.vscdb` reader uses the built-in `node:sqlite`, which requires **Node.js >= 22.5**.

Accuracy is pinned two ways: a gold-label eval over the synthetic fixture corpus (`tests/unit/sentiment/gold-eval.spec.ts`, 100% exact match), and a real-corpus recall gate that runs locally on Ryan's Macs with aggregate numbers only. The gate passed (KDATAP-713a0f): 2315 real human messages yielded, 2310 counted, 5 excluded — each verified as a citation-dense AI-research paste — and zero harness-injected false positives in the counted buckets.

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
