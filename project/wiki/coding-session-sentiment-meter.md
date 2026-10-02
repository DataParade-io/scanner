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

## Status

- Epics A–G (contract, patterns, windows, Claude Code, Cursor, Codex, meter/CLI) are complete.
- Epic H: privacy and fixture guards plus the synthetic gold-label eval (100% exact match) are done. The real-corpus recall gate PASSED (KDATAP-713a0f, on BlackbookM1): 2315 real human messages yielded, 2310 counted, 5 excluded — each verified locally as a citation-dense AI-research paste — 99.8% genuine recall, zero harness-injected false positives. All-time meter reading after the gate: 2315 messages / 216 sessions, 25 thanks tokens, 127 f-bomb tokens ("cursing at the machine").
- Epic I (Grok Bot adapter) is complete (KDATAP-247294): conversation blobs are plain `{schemaVersion,value:{entries}}` JSON with base32-of-storage-key filenames; human speech is `kind:"message"` `role:"user"` without `fromAgent` (plain = composer input, `fromUser` = remote channel); persona `send-message` output, crew bot posts, and assistant relays are excluded; per-conversation-local entry ids embed the conversation uuid for dedup. Verified live on BlackbookM1: 240 human messages over 9 conversations (all-time), included in meter windows.
- Epic J (Antigravity adapter) is complete (KDATAP-a4d0fb): conversation DBs are SQLite `steps` tables with schema-less protobuf payloads; human speech is `step_type = 14` field 19.2; nested sub-cascades (agent dispatch prompts), artifact attach sends, and agent types (15/132/23/101/17) are excluded. Verified live on BlackbookM1 across the desktop (79 conversations, 55 nested skipped) and CLI (37) stores.
