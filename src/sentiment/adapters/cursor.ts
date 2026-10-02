import fs from "fs";
import path from "path";
import { buildDedupKey, dedupeRecords } from "../dedup";
import { normalizeTimestampToRfc3339Utc } from "../record";
import type { HumanMessageRecord } from "../record";
import { createSkipCounter } from "../adapter";
import type {
  AdapterDiscoveryResult,
  DiscoveredSession,
  SentimentAdapter,
} from "../adapter";
import { openVscDb } from "./sqlite-reader";
import { streamJsonlLines } from "./jsonl";

export interface CursorAdapterOptions {
  /** Overrides ~/Library/Application Support/Cursor/User. */
  cursorUserDir?: string;
  /** Overrides ~/.cursor (agent-CLI transcripts and chats metadata). */
  cursorHomeDir?: string;
  /** Home directory override for tests. */
  homeDir?: string;
}

const DEFAULT_HOME = process.env.HOME || "";

export function defaultCursorUserDir(options: CursorAdapterOptions = {}): string {
  if (options.cursorUserDir) return options.cursorUserDir;
  const home = options.homeDir ?? DEFAULT_HOME;
  return path.join(home, "Library", "Application Support", "Cursor", "User");
}

function defaultCursorHome(options: CursorAdapterOptions = {}): string {
  return options.cursorHomeDir ?? path.join(options.homeDir ?? DEFAULT_HOME, ".cursor");
}

export interface CursorComposerRef {
  composerId: string;
  dbFile: string;
  /** index shape that surfaced this composer */
  via: "composerData" | "composerHeaders" | "selection" | "tab";
  workspaceIdentifier?: string;
}

/**
 * Union every index that can name a conversation: the Cursor 2.x per-workspace
 * composer.composerData allComposers index and the 3.x+ central
 * composer.composerHeaders index (the 3.0 migration is one-way and the central
 * index misses old chats not re-opened since migration), plus
 * selectedComposerIds/lastFocusedComposerIds and composerChatViewPane tab keys.
 */
export function discoverComposers(dbFile: string): { composers: CursorComposerRef[]; warnings: string[] } {
  const byId = new Map<string, CursorComposerRef>();
  const warnings: string[] = [];
  let db: ReturnType<typeof openVscDb> | undefined;
  try {
    db = openVscDb(dbFile, { copyThenRead: true, busyTimeoutMs: 1000 });
    const index = db.get("composer.composerData");
    if (index) {
      for (const entry of parseComposerIndex(index.value)) {
        if (!byId.has(entry)) {
          byId.set(entry, { composerId: entry, dbFile, via: "composerData" });
        }
      }
    }
    for (const row of db.iterateByPrefix("composer.composerHeaders")) {
      const parsed = tryParseJson(row.value) as Record<string, unknown> | undefined;
      const composerId = parsed && typeof parsed.composerId === "string" ? parsed.composerId : row.key.split(":").pop() ?? "";
      if (!composerId) continue;
      if (!byId.has(composerId)) {
        byId.set(composerId, {
          composerId,
          dbFile,
          via: "composerHeaders",
          workspaceIdentifier:
            parsed && typeof parsed.workspaceIdentifier === "string" ? parsed.workspaceIdentifier : undefined,
        });
      }
    }
    for (const key of ["selectedComposerIds", "lastFocusedComposerIds"]) {
      const row = db.get(key);
      if (!row) continue;
      const parsed = tryParseJson(row.value);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const composerId = typeof entry === "string" ? entry : (entry as Record<string, unknown>)?.composerId;
          if (typeof composerId === "string" && !byId.has(composerId)) {
            byId.set(composerId, { composerId, dbFile, via: "selection" });
          }
        }
      }
    }
    for (const row of db.iterateByPrefix("composerChatViewPane")) {
      const parsed = tryParseJson(row.value) as Record<string, unknown> | undefined;
      const composerId = parsed && typeof parsed.composerId === "string" ? parsed.composerId : undefined;
      if (composerId && !byId.has(composerId)) {
        byId.set(composerId, { composerId, dbFile, via: "tab" });
      }
    }
  } catch (err) {
    warnings.push(`failed to read ${dbFile}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    db?.close();
  }
  return { composers: [...byId.values()], warnings };
}

function parseComposerIndex(value: string): string[] {
  const parsed = tryParseJson(value);
  if (!parsed) return [];
  const allComposers = (parsed as Record<string, unknown>).allComposers;
  if (!Array.isArray(allComposers)) return [];
  return allComposers
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : (entry as Record<string, unknown>)?.composerId,
    )
    .filter((id): id is string => typeof id === "string");
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Subagent composers (task-tool style prefixed ids — shape to verify on a real Mac). */
export function isSubagentComposerId(composerId: string): boolean {
  return /^(subagent[-_]|task[-_])/i.test(composerId);
}

export function workspaceFolderFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const match = /^file:\/\/(.*)$/.exec(uri);
  if (!match) return undefined;
  let decoded = decodeURIComponent(match[1]);
  if (/^\/[A-Za-z]:/.test(decoded)) decoded = decoded.slice(1);
  return decoded;
}

function workspaceAttribution(userDir: string, dbFile: string): string | undefined {
  const parts = dbFile.split(path.sep);
  const wsIndex = parts.lastIndexOf("workspaceStorage");
  if (wsIndex === -1 || wsIndex + 1 >= parts.length) return undefined;
  const workspaceJson = path.join(userDir, "workspaceStorage", parts[wsIndex + 1], "workspace.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(workspaceJson, "utf8")) as Record<string, unknown>;
    const folder = typeof parsed.folder === "string" ? parsed.folder : undefined;
    return workspaceFolderFromUri(folder);
  } catch {
    return undefined;
  }
}

export interface CursorDoctorReport {
  userDir: string;
  cursorHome: string;
  globalDbPresent: boolean;
  workspaceDbs: number;
  agentTranscriptSessions: number;
  issues: string[];
}

/** Doctor check: validate roots and report drift, no counting. */
export function doctorCursor(options: CursorAdapterOptions = {}): CursorDoctorReport {
  const userDir = defaultCursorUserDir(options);
  const cursorHome = defaultCursorHome(options);
  const report: CursorDoctorReport = {
    userDir,
    cursorHome,
    globalDbPresent: false,
    workspaceDbs: 0,
    agentTranscriptSessions: 0,
    issues: [],
  };
  const globalDb = path.join(userDir, "globalStorage", "state.vscdb");
  report.globalDbPresent = fs.existsSync(globalDb);
  const workspaceStorage = path.join(userDir, "workspaceStorage");
  if (fs.existsSync(workspaceStorage)) {
    for (const entry of fs.readdirSync(workspaceStorage, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(workspaceStorage, entry.name, "state.vscdb"))) {
        report.workspaceDbs += 1;
      }
    }
  }
  const agentProjects = path.join(cursorHome, "projects");
  if (fs.existsSync(agentProjects)) {
    for (const project of fs.readdirSync(agentProjects, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const transcripts = path.join(agentProjects, project.name, "agent-transcripts");
      if (fs.existsSync(transcripts)) {
        for (const session of fs.readdirSync(transcripts, { withFileTypes: true })) {
          if (session.isDirectory()) report.agentTranscriptSessions += 1;
        }
      }
    }
  }
  if (!report.globalDbPresent) report.issues.push("global state.vscdb missing");
  return report;
}

/**
 * Cursor adapter: IDE agent/chat conversations in state.vscdb (global plus
 * workspaceStorage) and agent-CLI transcripts under ~/.cursor.
 * Cursor formats are undocumented and reverse-engineered — every claim is
 * pinned against fixtures and verified on a real Mac separately.
 */
export function createCursorAdapter(options: CursorAdapterOptions = {}): SentimentAdapter {
  const discover = (roots?: string[]): AdapterDiscoveryResult => {
    const skipCounter = createSkipCounter();
    const sessions: DiscoveredSession[] = [];
    const userDir = defaultCursorUserDir(options);
    const searchRoots = roots ?? [userDir];
    for (const root of searchRoots) {
      if (!fs.existsSync(root)) {
        skipCounter.missingRoots.push(root);
        continue;
      }
      const dbFiles = new Set<string>();
      const globalDb = path.join(root, "globalStorage", "state.vscdb");
      if (fs.existsSync(globalDb)) dbFiles.add(globalDb);
      const workspaceStorage = path.join(root, "workspaceStorage");
      if (fs.existsSync(workspaceStorage)) {
        for (const entry of fs.readdirSync(workspaceStorage, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const db = path.join(workspaceStorage, entry.name, "state.vscdb");
            if (fs.existsSync(db)) dbFiles.add(db);
          }
        }
      }
      for (const dbFile of dbFiles) {
        const { composers, warnings } = discoverComposers(dbFile);
        for (const warning of warnings) skipCounter.failedFiles.push({ file: dbFile, error: warning });
        const attributed = workspaceAttribution(userDir, dbFile);
        for (const composer of composers) {
          if (isSubagentComposerId(composer.composerId)) continue;
          sessions.push({
            source: "cursor-ide",
            sessionId: composer.composerId,
            file: composer.dbFile,
            projectPath:
              attributed ?? workspaceFolderFromUri(composer.workspaceIdentifier),
          });
        }
      }
    }
    // Agent-CLI transcripts: ~/.cursor/projects/<sanitized>/agent-transcripts/<sid>/<sid>.jsonl
    const cursorHome = defaultCursorHome(options);
    const agentProjects = path.join(cursorHome, "projects");
    if (fs.existsSync(agentProjects)) {
      for (const project of fs.readdirSync(agentProjects, { withFileTypes: true })) {
        if (!project.isDirectory()) continue;
        const transcripts = path.join(agentProjects, project.name, "agent-transcripts");
        if (!fs.existsSync(transcripts)) continue;
        for (const session of fs.readdirSync(transcripts, { withFileTypes: true })) {
          if (!session.isDirectory()) continue;
          const transcript = path.join(transcripts, session.name, `${session.name}.jsonl`);
          if (fs.existsSync(transcript)) {
            sessions.push({
              source: "cursor-agent",
              sessionId: session.name,
              file: transcript,
              projectPath: decodeSanitizedProject(project.name),
            });
          }
        }
      }
    }
    return { sessions, skipCounter };
  };

  return {
    source: "cursor-ide",
    discover,
    extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
      if (session.source === "cursor-agent") return extractAgentTranscript(session);
      return extractComposerBubbles(session, options);
    },
  };
}

/** The sanitized path replaces slashes with dashes; decode is best-effort. */
export function decodeSanitizedProject(sanitized: string): string {
  return "/" + sanitized.split("-").filter((s) => s !== "").join("/");
}

async function* extractComposerBubbles(
  session: DiscoveredSession,
  _options: CursorAdapterOptions,
  floorMs = 0,
): AsyncIterable<HumanMessageRecord> {
  // Incremental rescans pass a createdAt floor (per-DB watermark minus the
  // overlap margin from sqliteRescanFloor); dedup absorbs the overlap.
  // Stream by key prefix; never SELECT * — checkpoint and
  // messageRequestContext blobs are ignored entirely.
  const db = openVscDb(session.file, { copyThenRead: true, busyTimeoutMs: 1000 });
  try {
    // fullConversationHeadersOnly defines bubble ordering; bubble blobs carry
    // type (1 = user), text (plain, not richText), and createdAt (epoch ms).
    const headers = db.get(`composer:${session.sessionId}`)?.value;
    const orderedBubbleIds = extractOrderedBubbleIds(headers);
    const seen = new Set<string>();
    const makeRecord = (
      bubbleId: string,
      value: string,
      line: number,
    ): HumanMessageRecord | undefined => {
      const parsed = tryParseJson(value) as Record<string, unknown> | undefined;
      if (!parsed) return undefined;
      const bubbleType = parsed.type;
      if (bubbleType !== 1 && bubbleType !== "1" && bubbleType !== "user") return undefined;
      const text = typeof parsed.text === "string" ? parsed.text : undefined;
      if (!text || text.trim() === "" || seen.has(bubbleId)) return undefined;
      if (typeof parsed.createdAt !== "number") return undefined;
      if (parsed.createdAt < floorMs) return undefined;
      seen.add(bubbleId);
      const timestamp = normalizeTimestampToRfc3339Utc(parsed.createdAt);
      return {
        source: "cursor-ide",
        sessionId: session.sessionId,
        recordId: bubbleId,
        projectPath: session.projectPath ?? "",
        timestamp,
        role: "human",
        text,
        dedupKey: buildDedupKey({
          source: "cursor-ide",
          recordId: bubbleId,
          sessionId: session.sessionId,
          timestamp,
          text,
        }),
        provenance: { file: session.file, line, key: `bubbleId:${session.sessionId}:${bubbleId}` },
      };
    };
    if (orderedBubbleIds.length > 0) {
      let line = 0;
      for (const bubbleId of orderedBubbleIds) {
        const row = db.get(`bubbleId:${session.sessionId}:${bubbleId}`);
        const record = row ? makeRecord(bubbleId, row.value, line) : undefined;
        if (record) yield record;
        line += 1;
      }
      return;
    }
    for (const row of db.iterateByPrefix(`bubbleId:${session.sessionId}:`)) {
      const bubbleId = row.key.split(":")[2] ?? row.key;
      const record = makeRecord(bubbleId, row.value, seen.size);
      if (record) yield record;
    }
  } finally {
    db.close();
  }
}

function extractOrderedBubbleIds(headersValue: string | undefined): string[] {
  if (!headersValue) return [];
  const parsed = tryParseJson(headersValue) as Record<string, unknown> | undefined;
  const headers = parsed?.fullConversationHeadersOnly;
  if (!Array.isArray(headers)) return [];
  return headers
    .map((h) => (typeof h === "string" ? h : (h as Record<string, unknown>)?.bubbleId))
    .filter((id): id is string => typeof id === "string");
}

/**
 * Agent-CLI transcript extraction: user-role lines only, per the schema to be
 * pinned from a real Mac (KDATAP-e9aa3c); injected context excluded;
 * store.db enriches metadata only and never duplicates as a message source.
 */
async function* extractAgentTranscript(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
  for await (const { line, text: raw } of streamJsonlLines(session.file)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const parsed = tryParseJson(trimmed) as Record<string, unknown> | undefined;
    if (!parsed) continue;
    const role = typeof parsed.role === "string" ? parsed.role : undefined;
    if (role !== "user") continue;
    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    if (type !== undefined && type !== "message") continue;
    const text = extractAgentText(parsed);
    if (!text || text.trim() === "" || isInjectedText(text)) continue;
    const ts = parsed.timestamp;
    const timestamp =
      typeof ts === "number" || typeof ts === "string" ? normalizeTimestampToRfc3339Utc(ts) : undefined;
    if (!timestamp) continue;
    const messageId = typeof parsed.messageId === "string" ? parsed.messageId : `${session.sessionId}:${line}`;
    yield {
      source: "cursor-agent",
      sessionId: session.sessionId,
      recordId: messageId,
      projectPath: session.projectPath ?? "",
      timestamp,
      role: "human",
      text,
      dedupKey: buildDedupKey({
        source: "cursor-agent",
        recordId: messageId,
        sessionId: session.sessionId,
        timestamp,
        text,
      }),
      provenance: { file: session.file, line, key: messageId },
    };
  }
}

function extractAgentText(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.text === "string") return parsed.text;
  const content = parsed.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = (content as Record<string, unknown>[])
      .map((block) => (typeof block.text === "string" ? block.text : undefined))
      .filter((t): t is string => t !== undefined);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

/** Injected-context discrimination for agent transcripts (to verify on a real Mac). */
export function isInjectedText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<system-reminder>") ||
    trimmed.startsWith("<context:") ||
    trimmed.startsWith("<terminal-selection>") ||
    trimmed === ""
  );
}

export async function extractCursorRecords(
  session: DiscoveredSession,
  options: CursorAdapterOptions = {},
  floorMs = 0,
): Promise<{ records: HumanMessageRecord[] }> {
  const records: HumanMessageRecord[] = [];
  const iterable =
    session.source === "cursor-agent"
      ? extractAgentTranscript(session)
      : extractComposerBubbles(session, options, floorMs);
  for await (const record of iterable) records.push(record);
  return { records: dedupeRecords(records).records };
}
