# Plan: Coding-session sentiment meter — thanks vs. F-bombs

Initiative: **KDATAP-24083e** "Coding-session sentiment meter: thanks vs. F-bombs" (tracked locally in Kanbus; not yet pushed). This document is a **plan only** — no production code is included in or proposed by this PR. Kanbus epics/tasks listed in [§10](#10-proposed-epic-and-task-breakdown) are proposals for later filing under the initiative; per instruction, this change does not create them.

## 1. Intent

Paxel (paxel.ycombinator.com, Y Combinator's session scanner) analyzed roughly 3,000 of Ryan's AI coding sessions across two Macs. We want this repo's scanner to do the same scan itself, locally, and render a "vibe meter" that balances **how often the human says thanks** against **how many F-bombs they drop** — a per-window indicator of how a day of vibe coding is going.

User story:

> As a developer who spends all day in AI coding tools, I want a local meter that counts my gratitude and profanity across Claude Code, Cursor, and Codex sessions over a chosen time window, so that I can see at a glance how my vibe coding day is going — without any of my transcripts leaving my machine.

### In scope

- Local adapters for three sources: **Claude Code**, **Cursor** (IDE + agent CLI transcripts), and **OpenAI Codex CLI**.
- Extraction of **only the human's own typed messages**, with timestamps, from each source.
- A shared normalized record all adapters emit.
- Deterministic counting rules for gratitude and F-bomb tokens, with code/quote/paste exclusions.
- A per-window meter with a CLI, supporting **rolling windows** (last 24h, last N hours/days) and **calendar windows** (`today`, `yesterday`) where the day boundary is a **configurable day-start time** (default: local midnight), in a **configurable timezone**.
- Deduplication (forked/resumed sessions, mirrored records, repeated hand-backs), incremental re-scan, privacy guarantees, and failure modes for format drift.
- Tests and a fixture-transcript eval approach.

### Out of scope (v1)

- **Grok Bot** (a desktop AI assistant app): a required future source, but out of scope for this plan beyond the note that it gets its own adapter conforming to the same normalized record (see [§7](#7-later-source-grok-bot)). Its conversation storage format must be researched separately before that adapter is planned.
- Any upload, sync, or remote dashboard. Everything stays local.
- Sentiment beyond the two token families ( sarcasm, tone, assistant-side language). The meter's axes are intentionally just thanks and F-bombs.
- Real-time watch mode (v1 is scan-on-demand; a `--watch` flag is a possible later chore).

## 2. Product shape: CLI and meter output

The scanner repo is a library (`@dataparade/scanner`) whose CLI wiring lives in `@dataparade/cli` (see `README.md`). The meter follows the same split: counting core in this repo, a thin local CLI first.

- **Library API** (`src/sentiment/`, exported from `src/index.ts`): `collectHumanMessages(config)` → `AsyncIterable<HumanMessageRecord>`; `countSentiment(records, rules)` → counts; `resolveWindow(spec, opts)` → UTC bounds; `buildMeterReport(...)` → report object.
- **CLI (v1):** `scripts/sentiment-meter.ts` run through ts-node, wired as `pnpm run sentiment:meter` — the same pattern as existing tooling scripts (`scripts/scan-layer-findings.ts` etc.). A published command in `@dataparade/cli` can wrap the same API later (chore, not blocking v1).

Command shape:

```bash
pnpm run sentiment:meter                          # default: --window today
pnpm run sentiment:meter -- --window last-24h
pnpm run sentiment:meter -- --window 3d          # rolling last 3 days
pnpm run sentiment:meter -- --window yesterday --day-start 04:00
pnpm run sentiment:meter -- --window today --timezone America/Los_Angeles
pnpm run sentiment:meter -- --since 2026-10-01T04:00:00-07:00 --until 2026-10-02T04:00:00-07:00
pnpm run sentiment:meter -- --sources claude-code,codex --json
```

Flags:

| Flag | Meaning | Default |
| --- | --- | --- |
| `--window <spec>` | `today`, `yesterday`, `last-24h`, `Nh` (e.g. `6h`), `Nd` (e.g. `3d`), `all` | `today` |
| `--since` / `--until` | Absolute ISO-8601 bounds; overrides `--window` when both given | — |
| `--day-start <HH:MM>` | Wall-clock time at which a calendar day starts | `00:00` (local midnight) |
| `--timezone <IANA>` | Timezone for calendar windows and day bucketing | system local timezone |
| `--sources <list>` | Subset of `claude-code,cursor,codex` | all present |
| `--json` | Machine-readable report | off |
| `--cache-dir <path>` | Incremental-scan state location | `$XDG_CACHE_HOME/dataparade/sentiment-meter` |
| `--doctor` | Validate source roots/records and report expected-field drift, no counting | — |

Persisted personal config: `$XDG_CONFIG_HOME/dataparade/sentiment.meter.yaml` (i.e. `~/.config/dataparade/sentiment.meter.yaml` on macOS), with keys `timezone`, `dayStart`, `sources`, `roots` (extra/displaced source roots, e.g. second Macs mounted as folders), and `words` (path to an override word list). CLI flags win over config; config wins over defaults. Rationale: this is a *user-machine* tool, so its config belongs to the user's home, not to the repo — the same split `.plexus/config.yaml` and `.kanbus.yml` already use for run-local settings.

Text output (never includes message text — only counts):

```
Vibe meter — window: today (04:00–04:00, America/Los_Angeles)
  thanks:  12   F-bombs: 2
  meter:   ▓▓▓▓▓▓▓▓░░  86%  "mostly grateful"
  messages scanned: 214 across 6 sessions
  sources: claude-code 4 sessions · cursor 1 · codex 1
```

`--json` emits `{window: {label, startUtc, endUtc}, counts: {thanks, fbombs, thanksMessages, fbombMessages, messagesScanned, sessionsScanned}, meter: {ratio, band}, bySource: {...}}`.

Meter math (deterministic, data-driven):

- `ratio = thanks / (thanks + fbombs)` when the denominator is > 0, else the meter shows `quiet` (no human messages in window).
- Bands come from config so they can be tuned without code: default `≥ 0.75 "mostly grateful"`, `0.40–0.75 "mixed"`, `< 0.40 "cursing at the machine"`.
- Both raw token counts and message-level counts (messages containing ≥ 1 match) are reported; the gauge uses **token counts** ("how often he says thanks", "how many F-bombs").

## 3. Shared normalized record

All adapters emit one record shape, defined with Zod (a repo dependency) alongside the existing core schemas:

```ts
type SentimentSource =
  | "claude-code"
  | "cursor-ide"
  | "cursor-agent"
  | "codex"
  | "grok-bot"; // reserved; later adapter

interface HumanMessageRecord {
  source: SentimentSource;
  sessionId: string;        // source-native session/thread id
  recordId: string | null;  // native record uuid when present and stable
  projectPath: string | null; // decoded working directory / workspace folder
  timestamp: string;        // RFC 3339, always UTC ("Z")
  role: "human";            // v1 emits only human-authored records
  text: string;             // extracted plain text (code fences already stripped)
  dedupKey: string;         // sha256 over identity tuple (below)
  provenance: {
    file: string;          // absolute path of the source file
    line?: number;         // JSONL line number, when applicable
    key?: string;          // SQLite key, when applicable
  };
}
```

Rules:

- Adapters are responsible for human-vs-injected discrimination ([§6](#6-source-adapters)); the record layer only ever sees human text.
- Timestamps are normalized to UTC RFC 3339 at extraction; every adapter parses its native representation (ISO-8601 with `Z` for Claude Code, Unix epoch milliseconds for Cursor, RFC 3339 for Codex).
- `dedupKey = sha256(source + ":" + (recordId ?? sessionId + "|" + timestamp + "|" + sha256(text)))`. Records with a stable native id (Claude Code `uuid`, Codex `item` identity) dedupe on it; others fall back to the content tuple. The dedup set lives in scan state and holds only hashes — never text ([§6.9](#69-privacy-local-only-never-upload)).
- Adapters stream (`AsyncIterable`) and never load whole transcripts into memory; Claude Code transcripts can exceed 100 MB (community-observed) and Cursor's global DB can be tens of GB (community-observed ~59 GB in one report).

## 4. Counting rules

Word lists are **data, not code**, following the repo's `patterns/*.yaml` convention: a new `patterns/sentiment-words.yaml` with versioned sections `gratitude`, `fbomb` (the F-bomb family specifically, per Ryan), and later-possible extra profanity tiers. A loader (mirroring `src/classifier/config.ts` style) feeds the counter; users can override the list via config ([§2](#2-product-shape-cli-and-meter-output)).

Matching rules (all specified as Gherkin stories when implemented):

1. **Word boundaries.** A token matches only at word boundaries: `\b(token)\b` against case-folded text. Inflections enumerated in the list (e.g. `fuck`, `fucking`, `fucked`, `clusterf*`), so no stemming guesses.
2. **Case.** Case-insensitive by default; text is lowercased before matching.
3. **Normalization.** Unicode curly quotes/apostrophes and dashes are normalized to ASCII before matching so `“thanks”` and `f*ck` variants don't slip through (config: `normalize: unicode-ascii`).
4. **Code blocks excluded.** Fenced blocks (``` and ~~~) and indented code blocks (4-space, only when the whole message region parses as Markdown) are stripped before matching. Profanity inside code never counts.
5. **Quoted text excluded.** Markdown blockquote lines (`>`-prefixed) are stripped. Quoted agent text re-injected as a user message is excluded at the *record* level by the adapters' agent-echo dedup ([§6](#6-source-adapters)); the counter additionally ignores any run quoted per rule 5.
6. **Pasted text excluded.** A paste detector flags a record region when its normalized length ≥ 2000 chars **and** (≥ 60% ASCII **or** ≥ 10 non-blank lines) — the thresholds that held up on a real 7-day corpus in community analysis of Claude Code data (see [§6.1 citations](#61-claude-code)). Flagged regions don't count. Thresholds are config keys, and must be tuned against Ryan's own corpus during the eval pass ([§9](#9-test-and-eval-approach)).
7. **Path/URL guard.** A match immediately followed by a path separator or file extension (`fuck/`, `fuck.ts`) does not count — boundaries alone would let filenames hit.
8. **Counting.** Each match occurrence increments the token count for its family; a message contributes to the message-level count at most once per family.
9. **Determinism.** Same input, same counts — the whole pipeline is pure/deterministic, matching the repo's deterministic-scanner stance. No AI in the loop.

## 5. Time windows, timezone, and configurable day start

### Semantics

- **Calendar windows** (`today`, `yesterday`): computed in the *configured timezone* at the *configured day-start time*. `today` = `[local(now) floored to its day, advanced to dayStart]` … `[that instant + one calendar day]`, converted to UTC bounds. With `--day-start 04:00`, a message sent at 03:59 belongs to *yesterday's* bucket; one at 04:00:00 belongs to *today*. Default day-start is `00:00` (local midnight).
- **Rolling windows** (`last-24h`, `Nh`, `Nd`): `[now − N units, now]` in UTC; no timezone dependence.
- **Absolute windows** (`--since/--until`): used verbatim as UTC bounds.
- **Inclusion:** start inclusive, end exclusive. A message exactly at the end bound is excluded; exactly at the start bound is included.
- Window resolution is a pure function: `resolveWindow(spec, { now, timezone, dayStart }) → { startMs, endMs, label }`. All aggregation filters on epoch milliseconds; day bucketing (for per-source/day breakdowns) applies the same day-start rule per message in the configured timezone.

### DST rules (explicit, test-pinned)

- On DST-transition days a calendar window is naturally 23h or 25h; the bounds are wall-clock day-start instants, not fixed 24h spans.
- Spring-forward gap (e.g. 02:30 does not exist): the day-start instant resolves to the **first valid instant after** the gap (03:00).
- Fall-back ambiguity (a wall-clock time occurs twice): the day-start instant resolves to the **earlier** (pre-transition) occurrence.
- Both rules are documented in the config schema help and pinned by tests.

### Implementation constraints

- **No new runtime dependencies.** The repo's dependency list is intentionally tiny (`zod`, `yaml`, tree-sitter). Node 20/22 have no standard `Temporal`. Wall-clock ↔ UTC conversion is implemented with `Intl.DateTimeFormat` timezone offsets (the standard trick: compute the UTC instant for a wall-clock time by probing the offset at a candidate instant). `date-fns-tz`/`luxon` stay out; if `Temporal` lands in the supported Node LTS during implementation, swapping the internals behind `resolveWindow` is a chore with no contract change.

### CLI/config surface (recap of the new requirement)

- Flags: `--window`, `--since`/`--until`, `--day-start HH:MM`, `--timezone <IANA>`; config keys: `timezone`, `dayStart` ([§2](#2-product-shape-cli-and-meter-output)). `--timezone` accepts IANA names (`America/Los_Angeles`); invalid names fail fast with the tz-database error, never silently falling back.
- The meter's header always echoes the resolved window in human terms (e.g. `today (04:00–04:00, America/Los_Angeles)`) so "today" is never ambiguous.

### Window tests (see also [§9](#9-test-and-eval-approach))

- Table-driven matrix over `resolveWindow` with an injected `now`: timezones UTC, `America/Los_Angeles` (including 2026-03-08 spring-forward and 2026-11-01 fall-back dates), `Asia/Tokyo`, `Australia/Lord_Howe` (30-minute offset), plus `--day-start 00:00` vs `04:00` vs `23:30`.
- Boundary tests: message at 03:59:59 vs 04:00:00 with `--day-start 04:00`; end-bound exclusive; rolling `24h` across a DST change.
- Timestamp normalization tests per source: ISO `Z` (Claude Code), epoch ms (Cursor), RFC 3339 with milliseconds (Codex).

## 6. Source adapters

Each adapter covers: discovery, record format, human-message extraction, session/project attribution, deduplication, incremental re-scan, privacy, and failure modes. Claims cite public docs or source code; anything unverifiable from public material is marked **[ASSUMPTION — verify on a real Mac]**. Ryan's machine is the verification target (two Macs; extra roots mount via config `roots`).

### 6.1 Claude Code

#### Discovery

- Transcripts: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. **Verified** (official docs): the `<encoded-cwd>` directory name is the working directory path with **non-alphanumeric characters replaced by `-`**; paths whose encoded name exceeds 200 characters are truncated to 200 chars with a hash of the full path appended. Source: [Claude Code "Manage sessions" docs](https://code.claude.com/docs/en/sessions).
- `CLAUDE_CONFIG_DIR` moves the whole storage root — discovery must honor it. **Verified**, same docs.
- Archives: community analysis describes a registry `~/.claude/history-sources.json` whose entries point at Claude-style roots containing `projects/`, merged with the active root for completeness claims. **[ASSUMPTION — verify on a real Mac]** (community reference: [daymade claude-code session file format](https://github.com/daymade/claude-code-skills/blob/main/daymade-claude-code/claude-code-history-files-finder/references/session_file_format.md)).
- Sub-agent transcripts: the task names `subagents/` folders under the project directory and community tooling lists `agent-*.jsonl` files as "Agent session" logs. Sub-agent folders/files are **excluded from human-message extraction** (agent-authored). Exact current layout (subdirectory vs filename prefix) **[ASSUMPTION — verify on a real Mac]**.
- Retention: Claude Code cleans transcripts after 30 days by default (`cleanupPeriodDays` setting); `CLAUDE_CODE_SKIP_PROMPT_HISTORY` and `--no-session-persistence` suppress writes entirely. **Verified** (official docs). Consequence: the meter's history depth on Ryan's Macs is bounded by retention; the plan surfaces this in `--doctor` output.

#### Record format and human-message extraction

Each JSONL line is one JSON object: "a message, tool use, or metadata entry"; **the entry format is internal to Claude Code and changes between versions** (official docs — this is the single most important format fact; see failure modes). Community schema (daymade reference; [llm-memory-research schema](https://lin-guanguo.github.io/llm-memory-research/agent-cli/claude-session-file-schema/); typed parser [claude-code-transcripts](https://crates.io/crates/claude-code-transcripts)):

```json
{
  "type": "user",
  "message": { "role": "user", "content": "string | content-block[]" },
  "uuid": "...", "parentUuid": "...|null", "sessionId": "...",
  "timestamp": "2026-06-14T16:45:08.359Z",
  "cwd": "/absolute/dir", "version": "2.1.170", "gitBranch": "main",
  "userType": "external", "isSidechain": false
}
```

Extraction rules — include as human messages:

- `type == "user"` with `message.role == "user"` and content a **string** or an array of `text` blocks, and `userType == "external"` (community-documented; `userType` distinguishing external/human from internal is **[ASSUMPTION — verify values on a real Mac]**).
- **Queued input**: text typed while the assistant is working lands as `type == "attachment"` with `attachment.type == "queued_command"`, `attachment.prompt` (string or block array), and `attachment.origin.kind == "human"`. Community analysis found an extractor that ignored these lost 153 of a user's messages in 7 days — and interruptions are where the sharpest words land. This record type **must** count. **[ASSUMPTION — verify field shape on a real Mac]**.

Exclude as injected/harness content:

- `tool_result` content blocks (user-role records carrying tool results, linked by `tool_use_id`).
- `promptSource` values `"system"` / `"sdk"` (community-observed on records that are reliably not user prose), and `isMeta: true`.
- Known marker prefixes in text: `<system-reminder>`, `<task-notification>`-style task notifications, `[Request interrupted by user…]` markers, and compact-summary continuation records ("This session is being continued from a previous conversation…"). Community-documented as safe structural drops. Exact current marker spellings **[ASSUMPTION — verify on a real Mac]**.
- `isSidechain: true` records (side chains are agent-internal).
- Slash-command envelopes: bare `/command` strings — the invocation is the user's action but not prose. Community-documented as a contamination class.
- `[Image #N]` placeholders inside text blocks: strip, count the message but not the placeholder.
- Whole-document pastes and agent-voiced re-injections: handled by the shared counting exclusions ([§4](#4-counting-rules)) and record-level agent-echo dedup (below).

#### Session/project attribution

- Session: `sessionId` per line; project: `cwd` per line (falls back to the decoded directory name). Both community-verified; docs confirm transcripts are organized per project directory. `gitBranch` is available for display but not needed for counting.

#### Deduplication

- **Fork/branch copies:** `/branch` and `--fork-session` copy the transcript into a new session ID (official docs: "copies the transcript… new branch… original is unchanged on disk"). If copied lines keep their original `uuid`, record-id dedup collapses them; if the copy rewrites ids, the content-tuple fallback (`sessionId|timestamp|sha256(text)`) still collapses identical copies. Which of the two holds **[ASSUMPTION — verify on a real Mac]** — the dedup key design covers both.
- **Same session in multiple roots** (active `~/.claude` + archives): union all copies, identical records count once (community-documented discipline for multi-root scans).
- **Two-terminal resume without forking** interleaves into one transcript (official docs) — nothing to dedupe, but parsing must not assume line order.
- **Repeated hand-backs:** agent hand-back text re-arriving as user records is excluded via `promptSource`/marker rules and the agent-echo content check (community analysis: compare candidate user texts against a corpus of earlier assistant texts; exact-verbatim containment catches the verbatim form — approximate rewrites are accepted as noise for v1 and measured in the eval pass).

#### Incremental re-scan

- JSONL is append-only (official docs describe continuous saving; community confirms append-only). Scan state per file: `{path, size, mtimeMs, linesSeen}`; on re-scan, if size grew and the file identity matches, read only appended lines; if size shrank or prefix hash differs, rescan fully. Watermarks and fingerprints only — no text cached.

#### Privacy

- Standard ([§6.9](#69-privacy-local-only-never-upload)).

#### Failure modes

- **Schema drift** (officially warned: "scripts that parse these files directly can break on any release"): parse tolerantly (unknown `type` or unknown fields are skipped with counters, never fatal); every fixture regression test pins the *currently observed* shape; `--doctor` samples each root and reports missing expected fields.
- Malformed lines: skip with a counter (community-documented that malformed lines occur).
- Line order is not chronological (community-observed): never infer time from position; window filtering always uses per-record timestamps; session bounds are min/max over observed timestamps, not file order.
- Old-format sessions: some records carry `message: null` or top-level `role`/`content` (community-documented) — extraction type-checks the nested `message` first.
- Missing root (tool not installed / `CLAUDE_CONFIG_DIR` elsewhere): source reported absent, not an error.
- Migration path if parsing breaks wholesale: official escape hatches exist (`/export` rendered transcripts, `--output-format json|stream-json`, hooks' `transcript_path`, Agent SDK). A v2 fallback could re-derive from `/export` dumps, but v1 parses JSONL directly (the meter needs historical bulk, not live events).

### 6.2 Cursor

Cursor has two storage surfaces, both on the machine running the Cursor UI (true even for SSH-remote work — chats stay local; community-verified):

1. **IDE sidebar/agent-panel chats** in SQLite `state.vscdb` databases.
2. **Agent CLI / Agents-window transcripts** as JSONL files under `~/.cursor/`.

Cursor's local formats are **not officially documented**; the format claims below come from reverse-engineering writeups (cursaves, Cursor forum, agent-sessions tool) that agree with each other and were verified against specific Cursor versions. Treat all of §6.2 as **reverse-engineered, subject to change without notice** — the risk section and failure modes cover this.

#### 6.2.1 IDE chats (`state.vscdb`)

Discovery and locations (macOS; **[community-verified, no official docs]** — cursaves "[How Cursor stores chats](https://github.com/Callum-Ward/cursaves/blob/main/docs/how-cursor-stores-chats.md)", Cursor forum "[How I recovered my vanished Cursor chat](https://forum.cursor.com/t/how-i-recovered-my-vanished-cursor-chat-so-you-dont-have-to/151158/1)"):

- Base: `~/Library/Application Support/Cursor/User/`.
- **Global DB:** `globalStorage/state.vscdb` — actual conversation content for all projects. Tables `ItemTable(key TEXT, value BLOB)` and `cursorDiskKV(key TEXT, value BLOB)`; values are UTF-8 JSON blobs. Relevant keys: `composerData:{composerId}` (conversation metadata + ordered `fullConversationHeadersOnly` list of `{bubbleId, type}`), `bubbleId:{composerId}:{bubbleId}` (one entry per message), and bulk we ignore (`checkpointId:*`, `messageRequestContext:*`, `composer.content.*`).
- **Workspace DBs:** `workspaceStorage/<hash>/state.vscdb` with sibling `workspace.json` (`{"folder": "file:///path/to/project"}`). Per-workspace chat index:
  - Cursor ≤ 2.6: `ItemTable` key `composer.composerData` → `{allComposers: [{composerId, name, createdAt, …}]}`.
  - Cursor 3.0+ (April 2026): central index moved to the **global** DB `ItemTable` key `composer.composerHeaders`, each entry tagged `workspaceIdentifier` (with `uri.fsPath`); the workspace DB keeps only `selectedComposerIds`/`lastFocusedComposerIds`. **The migration is one-way and the global index is incomplete** for pre-3.0 chats not re-opened since migration — discovery must union: `composer.composerHeaders` + workspace `allComposers` + `selectedComposerIds`/`lastFocusedComposerIds` + `composerChatViewPane.*` tab keys, then pull metadata from `composerData:{id}` (cursaves' documented strategy).

Record format and human-message extraction (community-verified shapes):

- A message ("bubble") entry `bubbleId:{composerId}:{bubbleId}` contains `text` (the message text), `type` (**1 = user, 2 = assistant**), `richText` (structured user input), `context` (attached files/folders/terminals), `codeBlocks`, `toolResults`, `allThinkingBlocks`, `createdAt` (**Unix epoch milliseconds**).
- Human records = `type == 1` bubbles, text from `text` (not `richText`). **[ASSUMPTION — verify on a real Mac]** that harness-injected content (context additions, terminal selections, system reminders) never appears in a type-1 bubble's `text` as if typed — if it does, exclusion rules must classify those bubbles (check `context`/`richText` shapes on real data).

Attribution:

- ComposerId → project path via (a) `composer.composerHeaders.workspaceIdentifier.uri.fsPath` (3.0+), (b) workspace DB `allComposers` membership, (c) `workspace.json` `folder` URI for the enclosing workspace dir. Multiple workspace dirs can map to one project (community-verified: workspace ids are opaque and non-deterministic); attribution unions all matches.
- Session: `composerId`; session name/timestamps from `composerData:{composerId}` (`createdAt` ms, `unifiedMode`, `name`).
- Sub-agent conversations get their own `composerId` with a `task-toolu_…`-style prefix (community-observed) — excluded from human extraction (agent-authored) but **[ASSUMPTION — verify the prefix on a real Mac]**; a safer rule is to exclude composers never referenced as human-turn bubbles.

Deduplication:

- One composerId = one conversation; message dedup key uses the bubble's `bubbleId` via the SQLite key (native stable id). Chats appearing in both old workspace index and new global index are the same `composerId` — discovery unions ids before extraction, so no double read.
- Forked chats: **[ASSUMPTION — verify on a real Mac]** — if Cursor's "duplicate/fork chat" copies bubbles into a new composerId, the content-tuple dedup fallback catches them; measure prevalence in fixtures.

Incremental re-scan:

- Cache per DB: `{dbPath, mtimeMs, size, maxBubbleCreatedAtMs}`. If mtime/size unchanged, skip; if changed, query only bubbles with `createdAt > watermark` (plus a small overlap margin and dedup by key). SQLite writes are transactional and `createdAt` values are stable epoch ms (community-verified), so watermarking is safe. WAL caveat below.

Failure modes:

- **WAL mode:** both DBs use SQLite WAL — recent writes may live in `-wal`, not the main file (community-verified). The reader must open the DB with the WAL present (open in-place read-only with a busy timeout, or copy `state.vscdb` + `-wal` + `-shm` together to a temp dir then read the copy). Never read the main file alone.
- **Locked DB while Cursor runs:** open read-only (`mode=ro`) with `busy_timeout`; if still locked, fall back to the copy-then-read path. Counting is never worth disturbing the app.
- **Version churn:** the 2.x → 3.0 index migration already broke naive readers (see forum thread); tolerant discovery (union strategy above) + fixture tests pinned to both schemas + `--doctor`.
- **Huge DBs:** global DBs observed at tens of GB — query by key prefixes, never `SELECT *`, ignore `checkpointId`/`messageRequestContext` blobs entirely.
- **SQLite reader dependency:** Node 20 has no built-in SQLite. Options: (a) bump `engines` to a Node with stable `node:sqlite` (22.13+/24 LTS; zero native deps, recommended — validate in the CI matrix as a first task), or (b) an optional dependency such as `better-sqlite3` (native build burden). Decision task lives in the Cursor epic; adapters must isolate the reader behind one interface so the choice is swappable.
- **Missing/renamed keys after a Cursor update:** skip-with-counter + doctor report, per the shared failure-mode policy.

#### 6.2.2 Agent CLI / Agents-window transcripts

The Cursor **agent CLI** (bundled at `/Applications/Cursor.app/…/bin/agent`; official CLI docs: `agent ls`, `--resume`, `--continue` — [cursor.com/docs/cli/using](https://cursor.com/docs/cli/using)) stores:

- JSONL transcripts at `~/.cursor/projects/<sanitized-path>/agent-transcripts/<session-id>/<session-id>.jsonl`, where `<sanitized-path>` is the project path with `/` → `-` (leading slash stripped). Source: [agent-sessions "Cursor Agent local history" guide](https://github.com/jazzyalex/agent-sessions/blob/main/docs/guides/cursor-agent-local-history.html), verified by that project against Cursor 3.5.38.
- Per-session chat metadata in `~/.cursor/chats/<workspace-hash>/<session-id>/store.db` (names, model hints, timestamps, workspace context). Same source.
- Older cursaves documentation describes plain-text `agent-transcripts/*.txt` read-only transcripts; the JSONL form is current. **[ASSUMPTION — verify on a real Mac which variants exist and their line schema]** — the JSONL record shape (per-line type/role/text/timestamp fields) is not publicly specified beyond the community guides, so this adapter's extraction rules must be pinned from real files first (a dedicated fixture-capture task).

Cloud agents (this repo's own environment) run on remote VMs — their transcripts do not land on Ryan's Macs, so they are out of scope; the adapter targets local CLI/Agents-window sessions only.

Human extraction: user-role lines only; injected context and tool-output lines excluded by the record-type rules learned in the fixture-capture task. Session id and project from the transcript path/metadata. Dedup: native session id; a session present both in `~/.cursor/chats` and `agent-transcripts` is read from the transcript (primary) with store.db only enriching metadata.

### 6.3 Codex (OpenAI Codex CLI)

Codex's CLI is open source, so this is the best-documented source; cite [openai/codex](https://github.com/openai/codex) source files directly.

Discovery:

- Rollout files: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl` (default `CODEX_HOME=~/.codex`). **Verified** in source: `codex-rs/rollout` writes date-partitioned rollout paths ([rollout/src/recorder.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)); the `.codex/docs` configuration documents `CODEX_HOME`.
- Archived sessions may live under `<codex-home>/archived_sessions/`. **[ASSUMPTION — community-reported ([daymade reference, "Codex Rollout File Format"](https://github.com/daymade/claude-code-skills/blob/main/daymade-claude-code/claude-code-history-files-finder/references/session_file_format.md)); verify on a real Mac]**.
- Discovery is a directory walk of `sessions/**` + `archived_sessions/**` for `rollout-*.jsonl`.

Record format (**verified in source**):

- Every line is `{ "timestamp": <RFC3339>, "ordinal"?: <int>, "type": <record type>, "payload": … }` — the decoder in [rollout/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/lib.rs) (`decode_rollout_line`) requires `timestamp`, optional `ordinal`, and a discriminated item.
- `type == "session_meta"` (first line): payload carries `id` (conversation id), `session_id`, `forked_from_id`, `forked_from_ordinal_exclusive`, `timestamp`, `cwd`, `originator`, `cli_version`, `source`, `model_provider`, git info, instructions, etc. ([app-server rollout test fixture](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs) shows the exact emitted shapes; [llm-memory-research codex schema](https://lin-guanguo.github.io/llm-memory-research/agent-cli/codex-session-file-schema/) documents the family).
- `type == "response_item"` with `payload.type == "message"`: `role: "user" | "assistant"` and `content` blocks of type `input_text` (user) / `output_text` (assistant). Other `response_item` payloads: `function_call`, `function_call_output`, `custom_tool_call*`, `reasoning` — ignored.
- `type == "event_msg"`: `user_message` (with `kind`, e.g. `"plain"`) mirrors the `response_item` message text — **community-verified on a real rollout that these are strict mirrors and must not both be counted** (daymade reference). We count `response_item` only.
- `type == "turn_context"` and any unknown types: ignored (tolerant parse).

Human-message extraction:

- `response_item` → `payload.type == "message"` → `role == "user"` → concatenate `input_text` blocks.
- Exclude harness-injected user-role content: instructions/environment wrappers (e.g. `<user_instructions>`, `<environment_context>`, turn-context style blocks) that ride along as user-role items. Exact current marker set **[ASSUMPTION — verify on a real Mac against current codex-cli]**; the fixture-capture task pins them.
- **[ASSUMPTION — verify]**: whether `event_msg.user_message.kind` (e.g. `"plain"`) reliably distinguishes genuinely typed input from other kinds; if so it becomes the primary human signal with `response_item` as the text source.

Attribution:

- Session: `session_meta.payload.id` (fallback: the UUID in the filename — community-documented). Project: `session_meta.payload.cwd` (a recursive-parent match when filtering to project sets; for the personal meter we record `cwd` as-is). `cli_version` and `git` available for display.

Deduplication:

- **Mirrors:** count `response_item.message` only, never `event_msg.user_message` (above).
- **Resumed/forked sessions:** the recorder takes `forked_from_id` and `forked_from_ordinal_exclusive` on resume ([rollout/src/recorder.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs), `RolloutRecorderParams::Resume`), i.e. a resumed/forked rollout re-records inherited context. Skip items with `ordinal ≤ forked_from_ordinal_exclusive` in forked files so inherited human messages count once; the dedup-key fallback also collapses any residue. **[ASSUMPTION — verify the exact skip semantics on real resumed rollouts]**.
- **Same rollout in `sessions/` and `archived_sessions/`:** dedupe by `session_meta.payload.id` (community-documented discipline).

Incremental re-scan: JSONL append-only watermarking, same as Claude Code ([§6.1](#61-claude-code)).

Failure modes:

- Format is source-visible but the rollout schema still evolves between releases (`history_mode`, `context_window` fields appear in current `SessionMeta`); tolerant parse + pinned fixtures + version range documented. `rollout::decode_rollout_line` requiring `timestamp` means lines without it are malformed by definition — skip-with-counter.
- Compressed rollouts exist in current code ("materializes a compressed rollout"); if compression appears on-disk on Ryan's Macs, discovery must detect and either decompress or skip-with-note. **[ASSUMPTION — verify whether compressed rollouts appear on disk in normal CLI use]**.

### 6.4 Cross-cutting failure-mode policy

1. A source root that doesn't exist → source reported absent; exit success (a Mac without Codex is normal).
2. A malformed record line → skipped, counted in `skippedLines`, surfaced by `--doctor`/`--verbose`; never fatal, never silent.
3. An unknown record type or field → ignored (forward-compat).
4. A file that shrank or changed identity → full rescan, dedup absorbs the overlap.
5. Any parse crash inside an adapter → caught per-file, reported, remaining files still scanned (the pipeline as a whole degrades, it doesn't die).
6. Every adapter ships a `--doctor` check that verifies, on a sample of real files, that all fields the extractor relies on are present in the expected shapes, and prints the observed tool versions (`version` field for Claude Code, `cli_version` for Codex, composer `_v` for Cursor) so drift is diagnosable from one command.

### 6.9 Privacy: local only, never upload

- All adapters read local files; the sentiment module performs **no network I/O whatsoever**. Enforced by a unit test that statically asserts no network-capable imports (`node:net`, `node:http*`, `node:dgram`, `fetch`, `undici`, `axios`) appear under `src/sentiment/**` — mirroring the existing `no-source-code-leakage.spec.ts` pattern of enforcing invariants by test.
- Output contains counts only — never message text, even in `--verbose`/`--json`. Enforced by a test over all output builders.
- Scan state/cache contains watermarks, fingerprints (sha256), and counts — never text.
- Fixtures in the repo are **synthetic**, hand-authored; real transcripts (Ryan's or anyone's) are never committed. The eval pass runs against real transcripts **on the local machine only**, and only aggregate numbers (matches found, misses) are recorded in findings.
- This matches the product's stance: the scanner is deterministic and local; the meter rides those rails.

## 7. Later source: Grok Bot

Grok Bot (desktop AI assistant app) is a required future source. It is deliberately **not specified here**: its conversation storage on macOS must be researched first (app container paths, database/file formats, session and authorship semantics) exactly like the three above. The design keeps the door open:

- The `SentimentSource` union reserves `"grok-bot"`.
- The normalized record, counting rules, window semantics, dedup framework, incremental state, and failure-mode policy are all source-agnostic; a Grok Bot adapter is one more `discover/extract` implementation plus fixtures.
- Filing that research as its own epic under KDATAP-24083e is the expected next initiative step after this plan's epics land.

## 8. Fit with this repo's architecture and conventions

Read and followed: `AGENTS.md`, `CONTRIBUTING.md`, `CONTRIBUTING_AGENT.md` ("The Way").

- **The Way / BDD:** behavior is specified as Gherkin stories before code; production code exists to make specs pass. Epics define purpose; stories carry Gherkin ([§10](#10-proposed-epic-and-task-breakdown) marks which tasks get stories); tasks implement. Nothing is created in Kanbus by this change (explicit instruction); the breakdown is the filing plan for when the initiative is pushed.
- **Module layout:** new top-level `src/sentiment/` with `adapters/{claude-code,cursor,codex}/`, `core/` (record schema, dedup, windows, counting, aggregation), `config/` — mirroring how `src/ingest/`, `src/classifier/`, `src/data-actions/` separate concerns. Public API exported from `src/index.ts` like every other module.
- **Data-driven config:** word lists in `patterns/sentiment-words.yaml` (same pattern as `patterns/*.patterns.yaml` + loader in `src/classifier/config.ts`); personal config in YAML; Zod for the record schema (existing dependency).
- **Tests:** Jest unit tests under `tests/unit/sentiment/` matching the existing `tests/unit/<module>/` layout; Gherkin features in `features/sentiment-meter.feature` with steps in `features/steps/` — these steps exercise the library directly and need no Plexus host (they join the Cucumber suite that `pnpm test:features` runs).
- **Scripts:** `pnpm run sentiment:meter` wired in `package.json` next to the existing script family; implementation in `scripts/sentiment-meter.ts` (ts-node pattern used by `scripts/scan-layer-findings.ts`).
- **Commits/releases:** Conventional Commits; stories land as `feat:`, drift fixes as `fix:`, tooling/docs as `chore:`/`docs:` — matching the Kanbus type → release-category mapping in The Way. This document itself is a `docs:` commit.
- **Docs contracts:** `tests/unit/docs/evaluation-docs-contract.spec.ts` governs evaluation docs only; this plan adds `docs/plans/` (new subtree) and introduces no evaluation vocabulary. When implementation lands, a short wiki page (`project/wiki/`, editable directly per The Way) will summarize the meter.
- **Determinism:** the whole feature is deterministic and local — consistent with the repo's "deterministic scan engine" identity; no AI inference is involved.
- **Node engines:** possible bump to support `node:sqlite` (Cursor adapter decision, [§6.2.1](#621-ide-chats-statevscdb)) is a `chore` with its own task; CI matrix change included there.

## 9. Test and eval approach

### Fixture transcripts

`tests/fixtures/sentiment/` with one subtree per source, all synthetic:

- `claude-code/` — JSONL sessions covering: plain human messages (with thanks and F-bombs at word boundaries and in caps), `tool_result` user-records, `<system-reminder>`-wrapped text, `[Request interrupted by user…]` markers, task notifications, compact-continuation records, queued `attachment` prompts (`origin.kind == "human"`), `promptSource: "system"`/`isMeta` records, sidechain records, slash-command envelopes, `[Image #N]` text, pasted logs (excluded by paste heuristic), messages with profanity **inside code fences** (must not count), two forks of one session (identical prefixes — dedup), the same session duplicated in an "archive root" (dedup), multi-day timestamps spanning window edges (day-start tests), malformed lines, >100 MB streaming smoke fixture (generated, not committed).
- `cursor/` — a fixture **builder** that generates small `state.vscdb` files at test time (global + workspace pair, both the 2.x `composer.composerData` and 3.0 `composer.composerHeaders` shapes, WAL siblings) into a temp dir, plus `agent-transcripts` JSONL samples with the line shapes pinned from real files during the fixture-capture task.
- `codex/` — rollout JSONLs: `session_meta` first line, `response_item` user/assistant messages, injected-context user items, `event_msg.user_message` mirrors (must count once), a resumed rollout with `forked_from_id`/`forked_from_ordinal_exclusive` (inherited prefix must count once), duplicate in `archived_sessions/`, `turn_context`/unknown types, malformed lines.

### Deterministic tests (Jest, `tests/unit/sentiment/`)

- Per-adapter extraction: each fixture transcript yields exactly the pinned set of human messages (count, timestamps, session/project attribution, dedup) — golden per fixture.
- Counting rules: word boundaries (`refucktor` doesn't match; `F---` normalization cases do), case, code/quote/paste exclusions, path guard, occurrence vs message counts.
- Windows: the `resolveWindow` matrix from [§5](#5-time-windows-timezone-and-configurable-day-start) (DST spring-forward/fall-back, half-hour offsets, day-start 00:00/04:00/23:30, boundary inclusion) and window-bucketing of messages at 03:59 vs 04:00.
- Incremental state: scan → append → rescan yields identical totals to a cold scan (idempotence property); rewritten-file path rescan.
- Privacy: no-network static import check; output/cache contain no verbatim text.
- Failure modes: missing roots, unknown record types, malformed lines — skipped and counted.

### Behavior specs (Cucumber, `features/sentiment-meter.feature`)

Gherkin scenarios (source of truth for stories): counting a thanks message, ignoring profanity in a code block, ignoring a pasted log, `today` with `--day-start 04:00` assigning a 03:59 message to yesterday, `last-24h` rolling window, deduping a forked Claude Code session, emitting only counts (privacy). Steps drive the library directly — no Plexus dependency for these scenarios.

### Eval (gold labeling)

Per The Way's finding/annotation discipline:

- One **annotation** names a labeling pass over the fixture message corpus: each fixture human message gets a gold label `thanks | fbomb | both | neither | excluded`.
- Contested labels become **findings** (one gold label each, proposed until Ryan accepts).
- Counting accuracy is exact-match against gold labels in Jest (`pnpm test tests/unit/sentiment/`), reported as recall/precision per family; a threshold (e.g. 100% on synthetic fixtures, ≥ 95% human-message recall on Ryan's real corpus sampled locally) gates the epic's close. Real-corpus sampling happens on the Macs; only aggregate numbers go into findings/annotations.
- Format-drift eval: fixtures pin currently observed schemas; `--doctor` output on the real Macs is recorded in the epic as evidence.

## 10. Proposed epic and task breakdown

Sized for Kanbus (initiative **KDATAP-24083e** → epics → tasks; stories carry Gherkin). One task ≈ one focused sitting of work. Statuses/priorities follow The Way defaults. **Not filed now** — this is the filing plan.

### Epic A — Foundations: normalized record, adapter contract, dedup, state

Parent: KDATAP-24083e. Priority 1.

- A1 (story, Gherkin): Adapters emit normalized human-message records (schema + streaming contract).
- A2 (story, Gherkin): Malformed or unknown records are skipped and counted, never fatal.
- A3 (task): Zod record schema, timestamp normalization (ISO-Z / epoch-ms / RFC3339), dedup-key + union framework.
- A4 (task): Incremental scan-state store (watermarks/fingerprints only) + cache-dir handling.
- A5 (task): Fixture corpus skeleton (`tests/fixtures/sentiment/`) + window/filter helper types.

Depends on: nothing. Everything else depends on A.

### Epic B — Counting rules and word lists

- B1 (story, Gherkin): Thanks and F-bomb tokens counted case-insensitively at word boundaries.
- B2 (story, Gherkin): Code blocks, quoted text, and pasted regions are excluded from counting.
- B3 (task): `patterns/sentiment-words.yaml` + loader; normalization pipeline; path/URL guard.
- B4 (task): Counting unit tests + paste-heuristic tuning knobs in config.

Depends on: A (record shape). Parallel with C–E.

### Epic C — Time windows, timezone, configurable day start

- C1 (story, Gherkin): `today`/`yesterday` resolve against the configured timezone and day-start (default local midnight).
- C2 (story, Gherkin): Rolling windows (`last-24h`, `Nh`, `Nd`) and absolute `--since/--until` bounds.
- C3 (task): `resolveWindow` via `Intl` offset probing (no new deps); DST gap/ambiguity rules.
- C4 (task): Timezone/DST pinned test matrix ([§5](#5-time-windows-timezone-and-configurable-day-start)) + per-source timestamp parsing tests.

Depends on: A. Parallel with B, D–F.

### Epic D — Claude Code adapter

- D1 (story, Gherkin): Human messages (incl. queued-command attachments) counted from Claude Code transcripts.
- D2 (story, Gherkin): Injected content (tool results, system reminders, task notifications, interrupt markers, compact continuations, sidechains, command envelopes) is excluded.
- D3 (task): Discovery — `~/.claude/projects` encoding, `CLAUDE_CONFIG_DIR`, history-sources archives, sub-agent exclusion; verify-on-Mac capture task for the `[ASSUMPTION]` items in [§6.1](#61-claude-code).
- D4 (task): Extraction rules + fixtures + dedup across fork/archive copies; incremental watermarks.
- D5 (task): `--doctor` checks for Claude roots; drift-report wiring.

Depends on: A. Shares B's counting for end-to-end; fixture fixtures from A5.

### Epic E — Cursor adapter

- E1 (story, Gherkin): Human messages counted from Cursor IDE chats (both 2.x and 3.x index shapes).
- E2 (story, Gherkin): Human messages counted from Cursor agent transcripts; injected context excluded.
- E3 (task): **SQLite reader decision + spike** (`node:sqlite` + engines bump vs optional dep) — blocks E4/E6.
- E4 (task): Discovery — global/workspace DBs, union strategy for the 3.0 index, `workspace.json` attribution, WAL-safe read-only access; fixture `state.vscdb` builder.
- E5 (task): Agent-transcript fixture-capture from a real Mac (JSONL line schema is an [ASSUMPTION] in [§6.2.2](#622-agent-cli--agents-window-transcripts)) + extraction.
- E6 (task): Dedup (composerId, bubbles native ids), incremental watermarking via `createdAt`, doctor checks.

Depends on: A; E3 before E4/E6. Highest format risk — see risks.

### Epic F — Codex adapter

- F1 (story, Gherkin): Human messages counted from Codex rollouts; `event_msg` mirrors never double-counted.
- F2 (story, Gherkin): Forked/resumed rollouts and archived copies count inherited messages once.
- F3 (task): Discovery (`sessions/**`, `archived_sessions/**`, `CODEX_HOME`) + `session_meta` attribution.
- F4 (task): Extraction (injected-context markers pinned from real files), `forked_from` ordinal skip, dedup by meta id; fixtures.

Depends on: A.

### Epic G — Meter aggregation and CLI

- G1 (story, Gherkin): The meter renders counts, gauge, and bands for a resolved window; output contains no message text.
- G2 (story, Gherkin): `--json` emits the machine-readable report.
- G3 (task): Aggregation over records + bands config; scan-state wiring.
- G4 (task): `scripts/sentiment-meter.ts`, flags, personal config file, `pnpm run sentiment:meter`, doctor output.

Depends on: B + C + at least D (then E, F as they land).

### Epic H — Privacy hardening, gold eval, release readiness

- H1 (story, Gherkin): No message text ever leaves the counting process in output or state.
- H2 (task): No-network static-import test; output/cache no-text tests; no-transcript-commit lint guard for `tests/fixtures/sentiment/` (path allowlist).
- H3 (annotation): Gold labeling pass over the fixture corpus; contested labels as findings.
- H4 (task): Accuracy gate eval (fixture exact-match; real-corpus sampling on the Macs, aggregate numbers into the annotation); paste-heuristic threshold tuning from Ryan's corpus.
- H5 (chore): Docs — README section, wiki page, `docs/plans/` status update, engines note if bumped.

Depends on: B + at least one adapter epic; H3 before H4.

### Dependency graph

```
KDATAP-24083e (initiative)
 └─ A ─┬─ B ──┐
       ├─ C ──┼─ G ─ H
       ├─ D ─┘   │
       ├─ E ─────┤
       └─ F ─────┘   (G needs B+C+D minimum; H last)
```

## 11. Risks and open questions

1. **Cursor is the highest-drift source** (undocumented, already one breaking migration). Mitigation: union discovery, fixtures for both index schemas, doctor checks, and the E5 real-Mac capture task before extraction code is finalized.
2. **Claude Code format is officially unstable** ("internal… changes between versions"). Mitigation: tolerant parsing, pinned fixtures, structural-only exclusion rules (community analysis shows structural fields like `promptSource`/`isMeta` are the reliable signals), and `/export`-based fallback if wholesale breakage ever forces it.
3. **Verify-on-Mac assumptions** are consolidated: Claude `userType`/`promptSource`/marker spellings/branch-copy uuid stability/subagent layout/history-sources registry; Cursor type-1 bubble purity, fork behavior, agent-transcript JSONL schema, store.db schema; Codex injected-context markers, `event_msg` `kind` semantics, archived/compressed rollouts. Each becomes an explicit verify step inside D3/E5/F3 — findings record what real data showed.
4. **Two-Mac coverage:** roots config accepts extra roots; a second Mac's home mounted or synced read-only is in scope v1 (discovery is root-based). Live cross-machine aggregation is out of scope.
5. **Retention:** Claude Code's 30-day default cleanup bounds history depth; surfaced by doctor, not "fixed" by the meter.
6. **Counting edge fairness:** "thanks" said sarcastically still counts (deterministic tool; that's fine for a vibe meter); quoted-profanity recall loss from quote exclusion is accepted and measured in the H4 eval so the tradeoff is a recorded decision, not an accident.
7. **SQLite reader choice** (E3) may force an engines bump — deliberately scheduled early (spike) so it can't stall the Cursor epic late.
8. **Timezone correctness** is pure-function + table-tested; residual risk is operating-system tzdata drift, identical to any local tool.

---

*This plan intentionally contains no implementation. Epics/tasks above are proposals to be filed under KDATAP-24083e when the initiative is pushed, per The Way.*