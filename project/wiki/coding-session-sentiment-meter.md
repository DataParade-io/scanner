# Coding-session sentiment meter

Kanbus initiative KDATAP-6e486c — "Coding-session sentiment meter: thanks vs. F-bombs".

## What it does

Scans local AI coding-session sources, counts human messages that express gratitude versus frustration (F-bomb token family), and prints a counts-only gauge:

```
thanks: 12  f-bombs: 3  vibe: [##########|####] mixed (0.80)
```

The gauge is `thanks / (thanks + f-bombs)`; bands are `mostly-grateful` (>= 0.75), `mixed` (>= 0.40), `cursing` (< 0.40), plus a `quiet` state when there is nothing to count.

## Privacy invariants (non-negotiable)

- Everything stays local. There are no network-capable imports under `src/sentiment/` — enforced by `tests/unit/sentiment/privacy.spec.ts`.
- Output is counts only. Message text is never echoed to the terminal, the `--json` report, or the scan-state cache. Also enforced by test with a secret-marker fixture.
- Default word lists detect only the gratitude and F-bomb token families (`patterns/sentiment-words.yaml`, version 1). Matching is word-boundary, case-folded, Unicode-normalized, and skips path-like suffixes.
- Code fences, indented code, blockquotes, and pasted text blobs are never counted (`src/sentiment/exclusions.ts`); paste detection requires >= 4000 chars and >= 3 `[n]` citation markers (tunable via `ExclusionThresholds`) so the operator's own long orchestration briefs still count.
- The fixture-size lint guard (`scripts/guard-sentiment-fixtures.ts`) prevents real session dumps from being committed under `tests/fixtures/sentiment/`.

## Sources and adapters

Each source implements the `SentimentAdapter` contract (`src/sentiment/adapter.ts`): a sync `discover()` returning sessions plus a skip counter, and an async-iterable `extract()` yielding Zod-validated `HumanMessageRecord`s. Cross-file duplicates collapse via content-hash dedup (`dedup.ts`), and incremental rescans use JSONL line watermarks / SQLite `createdAt` floors with an overlap margin (`scan-state.ts`).

| Source | Location | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**.jsonl` | Tool results, sidechains, meta/system/sdk prompts, compact summaries, command envelopes, and injected reminders are excluded; queued standalone command records are included |
| Cursor | `state.vscdb` (global + workspaceStorage) and `~/.cursor/projects/<sanitized>/agent-transcripts/` | Read-only `node:sqlite` with copy-then-read WAL fallback; subagent composers/transcripts excluded; agent-CLI typed input rides in a trailing `<user_query>` block (after `<timestamp>`/`<image_files>` headers for queued follow-ups), harness follow-up templates excluded, `<timestamp>` headers parsed to UTC per line; requires **Node >= 22.5** |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `response_item` user messages only; `event_msg` mirrors, tag-wrapped injections, AGENTS.md dumps, and other non-`user.*` `content_item_kinds` records never counted; fork inheritance respected via real ordinals |
| Grok Bot | `~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob` | Filenames are base32 of the storage key; only `…transcript.replicas.<conversation-uuid>` blobs are conversations. Human speech is `kind:"message"` `role:"user"` without `fromAgent` (plain = typed/pasted, `fromUser` = remote channel); persona `send-message` output, crew `fromAgent` posts, and `role:"assistant"` entries never counted; entry ids are per-conversation-local so record ids embed the conversation uuid |
| Antigravity | `~/.gemini/antigravity{,-cli}/conversations/<uuid>.db` (+ `conversation_summaries.db`) | SQLite `steps` table with protobuf `step_payload` (no shipped schema; decoded structurally). Human speech is `step_type = 14` field 19.2 (field 19.3 is the same text as a parts list — never double-counted; 19.7 = artifact attach sends, skipped). Nested sub-cascades (summaries `parent_conversation_id != ""`) carry agent dispatch prompts and are excluded; per-step timestamps from field 5.1 (seconds + nanos); requires **Node >= 22.5** |

## Time windows

`resolveWindow` (`src/sentiment/windows.ts`) supports rolling windows (`24h`, `Nh`, `Nd`) and calendar windows (`today`, `yesterday`) anchored at a configurable day-start time (default: local midnight). Offsets use `Intl` — no new dependencies. Spring-forward gaps clamp forward; fall-back ambiguity resolves to the earlier instant. Pinned DST tests cover `America/Los_Angeles`, `Asia/Tokyo`, `Australia/Lord_Howe`, and non-midnight day-starts.

## Running it

```bash
pnpm run sentiment:meter -- --window today --day-start 04:00
pnpm run sentiment:meter -- --doctor
```

Flags override `~/.config/dataparade/sentiment.meter.yaml`, which overrides defaults. See the README "Sentiment meter" section for the full flag list.

## Local sentiment classifier (epic K, KDATAP-85c997)

A second packaged metric: every human message also gets a **compound sentiment score in [-1, +1]** and a `pos`/`neu`/`neg` label (thresholds ±0.05, standard VADER convention), scored on the same stripped text the counter uses (`stripExcludedRegions`). The meter aggregates mean compound score and pos/neu/neg message counts per window and per source (`MeterReport.sentiment`, `SourceBreakdown.sentiment`) — counts only.

**Backends** (selected via `--sentiment-backend` / config `sentimentBackend`; default `vader`, empty string disables):

- `vader` — offline `vader-sentiment` npm port, no model. `CODING_DOMAIN_OVERRIDES` (documented in `sentiment-classifier.ts`) neutralizes technical usage of kill/error/fail/bug/crash/abort/exception and related jargon to zero valence on word boundaries — verified numerically equivalent to lexicon removal. Emotional words are intentionally not overridden ("this crash sucks" stays negative).
- `transformer` — the default ML backend after the epic-L comparison (KDATAP-e11340, KDATAP-55f716): `SamLowe/roberta-base-go_emotions-onnx` (q8, ~120 MB, one-time download cached in `~/.cache/dataparade/sentiment-models`, then fully offline). Its 28-emotion head is mapped onto pos/neu/neg with a documented emotion→valence mapping (`GO_EMOTIONS_POSITIVE`/`GO_EMOTIONS_NEGATIVE`, cognitive emotions neutral). Loaded only when explicitly selected (optional dependency, dynamic import), so the default path has no network-capable code. Gets no token neutralization; the resulting disagreement is the comparison signal.
- Comparison candidates: `transformer-cardiff` (Cardiff twitter-roberta 3-class negative/neutral/positive, q8 ~120 MB), `transformer-xlmr` (XLM-T multilingual 3-class, q8 ~266 MB), `transformer-sst2` (binary SST-2 baseline from epic K, q8 ~65 MB). All are driven through `AutoTokenizer` + `AutoModelForSequenceClassification` with explicit 512-token truncation (RoBERTa position-embedding graphs fail past 512 tokens and some repos leave `model_max_length` unset).

**Evaluation** (`scripts/sentiment-backend-eval.ts`, runs under ts-node — onnxruntime-node cannot execute tensors inside jest's vm realm; jest unit tests cover only non-inference paths). Gold data: VADER-tuning set (KDATAP-fe4c1d, 36 synthetic messages) is separate from the held-out set (KDATAP-5fc7c8, 28 harder synthetic cases: sarcasm, frustrated-but-polite, terse commands, mixed sentiment, coding jargon).

| Backend (q8) | Tuning acc | Held-out acc | Held-out confusion (actual → p/u/n) | Throughput | Model size | Agreement vs VADER (3012 msgs) |
| --- | --- | --- | --- | --- | --- | --- |
| vader (lexicon) | **1.000** | 0.462 | pos 2/1/1, neu 1/6/2, neg 7/2/4 | ~23,250 msgs/sec | — | — |
| transformer (go_emotions → pos/neu/neg) | 0.971 | **0.731** | pos 4/0/0, neu 0/9/0, neg 7/0/6 | ~270 msgs/sec | 119.6 MB | 50.4% labels; mean +0.056 vs +0.135; mean \|diff\| 0.278 |
| transformer-cardiff (3-class) | 0.941 | 0.615 | pos 3/1/0, neu 0/6/3, neg 6/0/7 | ~267 msgs/sec | 120.1 MB | 44.7%; mean -0.084; \|diff\| 0.346 |
| transformer-xlmr (XLM-T 3-class) | 0.765 | 0.577 | pos 3/0/1, neu 1/4/4, neg 4/1/8 | ~274 msgs/sec | 266.3 MB | 46.2%; mean -0.123; \|diff\| 0.378 |
| transformer-sst2 (binary baseline) | 0.676 | 0.346 | pos 3/1/0, neu 3/6/0, neg 6/7/0 | ~508 msgs/sec | 64.5 MB | 43.0%; mean +0.247; \|diff\| 0.385 |

Held-out by kind (go_emotions winner): terse-command 5/5, coding-jargon 4/4, positive 4/4, mixed 3/4, frustrated-polite 3/4, sarcasm 0/5 — sarcasm defeats every local backend (VADER 0/5, Cardiff 0/5, XLM-T 0/5, SST-2 0/5).

**Recommendation (KDATAP-55f716):** keep **VADER as the meter default** (fast, transparent, perfectly stable on the tuning set) and promote the **go_emotions-mapped model to the default ML backend behind `--sentiment-backend transformer`** — best held-out accuracy, never mislabels neutral as emotional (unlike Cardiff/XLM-T, which read terse technical commands as negative), and the closest real-corpus profile to VADER. Survey note: Ollama/llama.cpp zero-shot LLM candidates were **not** benchmarked — neither runtime is installed on this Mac, and installing one would add a ~1-2 GB runtime plus multi-GB model weights for a throughput far below the 3-class classifiers; revisit only if a runtime is already present.

## Status

- Epics A–G (contract, patterns, windows, Claude Code, Cursor, Codex, meter/CLI) are complete.
- Epic H: privacy and fixture guards plus the synthetic gold-label eval (100% exact match) are done. The real-corpus recall gate PASSED (KDATAP-713a0f, on BlackbookM1): 2315 real human messages yielded, 2310 counted, 5 excluded — each verified locally as a citation-dense AI-research paste — 99.8% genuine recall, zero harness-injected false positives. All-time meter reading after the gate: 2315 messages / 216 sessions, 25 thanks tokens, 127 f-bomb tokens ("cursing at the machine").
- Epic I (Grok Bot adapter) is complete (KDATAP-247294): conversation blobs are plain `{schemaVersion,value:{entries}}` JSON with base32-of-storage-key filenames; human speech is `kind:"message"` `role:"user"` without `fromAgent` (plain = composer input, `fromUser` = remote channel); persona `send-message` output, crew bot posts, and assistant relays are excluded; per-conversation-local entry ids embed the conversation uuid for dedup. Verified live on BlackbookM1: 240 human messages over 9 conversations (all-time), included in meter windows.
- Epic J (Antigravity adapter) is complete (KDATAP-a4d0fb): conversation DBs are SQLite `steps` tables with schema-less protobuf payloads; human speech is `step_type = 14` field 19.2; nested sub-cascades (agent dispatch prompts), artifact attach sends, and agent types (15/132/23/101/17) are excluded. Verified live on BlackbookM1 across the desktop (79 conversations, 55 nested skipped) and CLI (37) stores.
- Epic K (local sentiment classifier) is complete (KDATAP-85c997): VADER backend with coding-domain overrides (KDATAP-40977f), meter/CLI aggregation (KDATAP-4f0397), synthetic gold set + eval (KDATAP-fe4c1d), optional Transformers.js backend behind a flag (KDATAP-2ca1f0), docs/tests (KDATAP-181c2f). All-time meter with VADER sentiment: 3009 scored messages, mean compound +0.135, 1385 pos / 1041 neu / 583 neg. See the classifier section above for backend comparison and the default-backend recommendation (VADER).
- Epic L (better local ML sentiment) is complete (KDATAP-be4909): the default ML backend behind `--sentiment-backend transformer` is now the go_emotions classifier mapped onto pos/neu/neg (KDATAP-55f716), with the Cardiff 3-class head (KDATAP-cc07d6), XLM-T, and the SST-2 baseline kept as named comparison candidates (KDATAP-e11340). Held-out gold set with VADER-tuning split (KDATAP-5fc7c8). All-time meter with the winner: 3012 scored messages, mean compound +0.056, 435 pos / 2307 neu / 270 neg.
