import fs from "fs";
import path from "path";
import { buildDedupKey } from "../dedup";
import { normalizeTimestampToRfc3339Utc } from "../record";
import type { HumanMessageRecord } from "../record";
import { createSkipCounter } from "../adapter";
import type {
  AdapterDiscoveryResult,
  AdapterExtractResult,
  DiscoveredSession,
  SentimentAdapter,
} from "../adapter";
import { streamJsonlLines } from "./jsonl";

export interface CodexAdapterOptions {
  /** Overrides CODEX_HOME (default ~/.codex). */
  codexHome?: string;
  /** Home directory override for tests. */
  homeDir?: string;
}

const DEFAULT_HOME = process.env.HOME || "";

export function defaultCodexHome(options: CodexAdapterOptions = {}): string {
  return options.codexHome ?? process.env.CODEX_HOME ?? path.join(options.homeDir ?? DEFAULT_HOME, ".codex");
}

function walkJsonl(root: string, matcher: (file: string) => boolean): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (matcher(full)) found.push(full);
    }
  };
  visit(root);
  return found.sort();
}

/** Doctor check: report observed rollout counts and observed codex versions. */
export interface CodexDoctorReport {
  codexHome: string;
  rolloutCount: number;
  archivedRolloutCount: number;
  issues: string[];
}

export function doctorCodex(options: CodexAdapterOptions = {}): CodexDoctorReport {
  const codexHome = defaultCodexHome(options);
  const report: CodexDoctorReport = {
    codexHome,
    rolloutCount: 0,
    archivedRolloutCount: 0,
    issues: [],
  };
  const sessions = path.join(codexHome, "sessions");
  const archived = path.join(codexHome, "archived_sessions");
  if (!fs.existsSync(sessions)) report.issues.push("sessions/ missing");
  if (!fs.existsSync(archived)) report.issues.push("archived_sessions/ not present yet (informational)");
  if (fs.existsSync(sessions)) report.rolloutCount = walkJsonl(sessions, (f) => f.endsWith(".jsonl")).length;
  if (fs.existsSync(archived)) report.archivedRolloutCount = walkJsonl(archived, (f) => f.endsWith(".jsonl")).length;
  return report;
}

/**
 * Codex adapter: OpenAI Codex CLI rollout files at
 * ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl (CODEX_HOME
 * honored; archived_sessions covered). Format claims cite the openai/codex
 * rollout source; the CLI is open source.
 */
export function createCodexAdapter(options: CodexAdapterOptions = {}): SentimentAdapter {
  const discover = (roots?: string[]): AdapterDiscoveryResult => {
    const skipCounter = createSkipCounter();
    const sessions: DiscoveredSession[] = [];
    const codexHome = defaultCodexHome(options);
    const searchRoots = roots ?? [codexHome];
    for (const root of searchRoots) {
      if (!fs.existsSync(root)) {
        skipCounter.missingRoots.push(root);
        continue;
      }
      for (const subdir of ["sessions", "archived_sessions"]) {
        const dir = path.join(root, subdir);
        if (!fs.existsSync(dir)) continue;
        for (const file of walkJsonl(dir, (f) => f.endsWith(".jsonl"))) {
          const base = path.basename(file);
          const fallbackId = /rollout-[^-]*.*-([0-9a-f-]{36})\.jsonl$/.exec(base)?.[1] ?? base.replace(/\.jsonl$/, "");
          sessions.push({
            source: "codex",
            sessionId: fallbackId,
            file,
          });
        }
      }
    }
    return { sessions, skipCounter };
  };

  return {
    source: "codex",
    discover,
    extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
      return extractCodexSession(session);
    },
  };
}

/**
 * Harness-injected user-role content markers, pinned against a real Mac
 * corpus (KDATAP-f662b6): <environment_context>, <recommended_plugins>,
 * <subagent_notification>, <turn_aborted>, <external_codex_apps_open_page>,
 * <external_codex_apps_writing_block_edits>, <skill>, <realtime_delegation>,
 * <in-app-browser-context>, and <codex_internal_context> are observed;
 * <user_instructions> and <turn_context> stay as documented shapes. Unknown
 * wrappers may still ride along as user items, so treat this list as the best
 * documented set.
 */
export const CODEX_INJECTED_MARKERS = [
  "<user_instructions>",
  "<environment_context>",
  "<turn_context>",
  "<recommended_plugins>",
  "<subagent_notification>",
  "<turn_aborted>",
  "<external_codex_apps_open_page>",
  "<external_codex_apps_writing_block_edits>",
  "<skill>",
  "<realtime_delegation>",
  "<in-app-browser-context",
  "<codex_internal_context",
];

export function isCodexInjectedText(text: string): boolean {
  const trimmed = text.trim();
  return CODEX_INJECTED_MARKERS.some((marker) => trimmed.startsWith(marker));
}

export async function extractCodexRecords(
  session: DiscoveredSession,
): Promise<AdapterExtractResult> {
  const skipCounter = createSkipCounter();
  const records: HumanMessageRecord[] = [];
  for await (const record of extractCodexSession(session, skipCounter)) {
    records.push(record);
  }
  return { records, skipCounter };
}

async function* extractCodexSession(
  session: DiscoveredSession,
  skipCounter = createSkipCounter(),
): AsyncIterable<HumanMessageRecord> {
  let sessionId = session.sessionId;
  let projectPath: string | undefined;
  let forkedFromOrdinalExclusive: number | undefined;
  let ordinal = 0;
  for await (const { line, text: raw } of streamJsonlLines(session.file)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      skipCounter.malformedLines += 1;
      continue;
    }
    const type = parsed.type;
    const payload = parsed.payload as Record<string, unknown> | undefined;

    if (type === "session_meta" && payload) {
      // Session attribution: session_meta payload id (fallback: filename UUID)
      // and project from payload cwd. Subagent rollouts (source containing a
      // subagent object, with subagent_history_start_ordinal) hold delegation
      // prompts injected by the parent thread, never typed input — skip them.
      const source = payload.source;
      if (source && typeof source === "object" && !Array.isArray(source) && "subagent" in (source as Record<string, unknown>)) {
        return;
      }
      const id = typeof payload.id === "string" ? payload.id : undefined;
      if (id) sessionId = id;
      if (typeof payload.cwd === "string") projectPath = payload.cwd;
      const forkedOrdinal = payload.forked_from_ordinal_exclusive;
      if (typeof forkedOrdinal === "number") forkedFromOrdinalExclusive = forkedOrdinal;
      continue;
    }

    // Never double-count event_msg mirrors of response_item messages (real
    // corpora carry item_completed mirrors, no user_message events); only
    // response_item messages are emitted.
    if (type !== "response_item" || !payload) continue;

    const itemType = payload.type;
    if (itemType !== "message") continue; // turn_context, reasoning, function calls, compaction, unknown: tolerantly ignored
    const role = payload.role;
    if (role !== "user") continue;

    const content = payload.content;
    if (!Array.isArray(content)) {
      skipCounter.malformedLines += 1;
      continue;
    }
    const text = (content as Record<string, unknown>[])
      .filter((block) => block.type === "input_text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");
    if (text.trim() === "") {
      skipCounter.malformedLines += 1;
      continue;
    }
    if (isCodexInjectedText(text)) continue;

    // Rollout records carry a real ordinal (top-level field). Forked/resumed
    // rollouts may re-record inherited context: items whose ordinal is below
    // forked_from_ordinal_exclusive belong to the original rollout, which is
    // scanned separately and counts them once.
    const recordOrdinal = typeof parsed.ordinal === "number" ? parsed.ordinal : ordinal;
    if (forkedFromOrdinalExclusive !== undefined && recordOrdinal < forkedFromOrdinalExclusive) {
      ordinal += 1;
      continue;
    }

    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
    if (!timestamp) {
      skipCounter.malformedLines += 1;
      continue;
    }
    const normalized = normalizeTimestampToRfc3339Utc(timestamp);
    yield {
      source: "codex",
      sessionId,
      recordId: `${sessionId}:${recordOrdinal}`,
      projectPath: projectPath ?? "",
      timestamp: normalized,
      role: "human",
      text,
      dedupKey: buildDedupKey({
        source: "codex",
        sessionId,
        timestamp: normalized,
        text,
      }),
      provenance: { file: session.file, line, key: `${sessionId}:${recordOrdinal}` },
    };
    ordinal += 1;
  }
}
