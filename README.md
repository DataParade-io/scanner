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

## Local sentiment classifier (second metric)

Alongside thanks vs. F-bombs, every human message gets a per-message **compound sentiment score in [-1, +1]** plus a `pos`/`neu`/`neg` label (threshold ±0.05, standard VADER convention). Scoring runs on the same code/quote/paste-stripped text the counter uses, and the meter aggregates **mean compound score and pos/neu/neg message counts** per window and per source — counts only, never message text.

```bash
pnpm run sentiment:meter -- --window 24h --sentiment-backend vader   # default
pnpm run sentiment:meter -- --window 24h --sentiment-backend ""      # disable the second metric
pnpm run sentiment:meter -- --window 24h --sentiment-backend transformer   # optional local ONNX model
pnpm run sentiment:eval                                              # gold accuracy + agreement + throughput
```

- **Backends** (`src/sentiment/sentiment-classifier.ts`, `src/sentiment/transformer-backend.ts`): `vader` (default) is the offline `vader-sentiment` npm port — no model, no download. `transformer` is an optional `@huggingface/transformers` pipeline over a quantized SST-2 distilbert ONNX model (`Xenova/distilbert-base-uncased-finetuned-sst-2-english`, ~66 MB), downloaded once and cached under `~/.cache/dataparade/sentiment-models` (override with `SENTIMENT_MODEL_CACHE_DIR`); every later run is fully offline. The dependency is optional and is loaded only when the backend is explicitly selected.
- **Coding-domain overrides**: technical usage of kill/error/fail/bug/crash/abort/exception and related inflections/jargon does not count as negative (`CODING_DOMAIN_OVERRIDES`); each term is neutralized on word boundaries before scoring, which is numerically equivalent to removing it from the lexicon. Emotionally loaded words (`sucks`, `terrible`, `hate`, ...) are deliberately not overridden, so "this crash sucks" stays negative. The transformer backend deliberately gets no neutralization — the disagreement is exactly what the eval measures.
- **Aggregation**: `MeterReport.sentiment` and `SourceBreakdown.sentiment` carry `backend`, `scoredMessages`, `meanCompound`, and `pos`/`neu`/`neg` counts; the CLI prints `Sentiment:` lines and the `--json` report includes them. Config key: `sentimentBackend` in `~/.config/dataparade/sentiment.meter.yaml`.
- **Gold set** (`annotations/KDATAP-fe4c1d/sentiment-gold.yaml`): 36 synthetic messages modeled on coding-chat patterns (no real text); `tests/unit/sentiment/sentiment-gold-eval.spec.ts` gates accuracy at 0.85.
- **Measured on BlackbookM1** (`pnpm run sentiment:eval`, aggregate numbers only): gold accuracy **VADER 34/34 (1.000)** vs **transformer 22/34 (0.647)** — the binary SST-2 head has no neutral concept and labels 11/14 neutral messages negative; real-corpus label agreement 33.7% over 3009 messages; throughput **VADER ~23,000 msgs/sec** vs **transformer ~500 msgs/sec** (sequential, q8). Default recommendation: **VADER**.
- **Privacy**: same invariants as the meter — the transformer backend is the only code path that can reach the network, and only for the one-time model download behind an explicit flag; no message text is ever persisted or printed.

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
