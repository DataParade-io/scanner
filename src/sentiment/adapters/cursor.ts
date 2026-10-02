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
  /**
   * Session-level timestamp override (epoch ms) for agent transcripts whose
   * lines carry no timestamps; defaults to chats meta.json then file mtime.
   */
  resolveSessionTimestampMs?: (sessionId: string, transcriptFile: string) => number | undefined;
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
      if (session.source === "cursor-agent") return extractAgentTranscript(session, options);
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
 * Agent-CLI transcript extraction, pinned against a real Mac corpus
 * (KDATAP-e9aa3c): user-role lines are {"role":"user","message":{"content":
 * [{"type":"text","text":...}]}}; genuinely typed input is always fully
 * wrapped in <user_query>...</user_query>; harness-injected context lines
 * (timestamp, dynamic_tools, dynamic_tool_catalog, available_subagent_types,
 * manually_attached_skills, open_subagent_context, cursor_commands) ride as
 * tagged user lines. Lines carry NO timestamps or ids — the record timestamp
 * is session-level: ~/.cursor/chats/<hash>/<sid>/meta.json updatedAtMs when
 * present, else the transcript file mtime.
 */
async function* extractAgentTranscript(
  session: DiscoveredSession,
  options: CursorAdapterOptions = {},
): AsyncIterable<HumanMessageRecord> {
  const lineTimestamp = (parsed: Record<string, unknown>): string | undefined => {
    const ts = parsed.timestamp;
    return typeof ts === "number" || typeof ts === "string" ? normalizeTimestampToRfc3339Utc(ts) : undefined;
  };
  const sessionMs = options.resolveSessionTimestampMs
    ? options.resolveSessionTimestampMs(session.sessionId, session.file)
    : defaultSessionTimestampMs(session.sessionId, session.file, defaultCursorHome(options));
  const sessionTimestamp = sessionMs !== undefined ? normalizeTimestampToRfc3339Utc(sessionMs) : undefined;
  for await (const { line, text: raw } of streamJsonlLines(session.file)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const parsed = tryParseJson(trimmed) as Record<string, unknown> | undefined;
    if (!parsed) continue;
    const role = typeof parsed.role === "string" ? parsed.role : undefined;
    if (role !== "user") continue;
    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    if (type !== undefined && type !== "message") continue;
    const fullText = extractAgentText(parsed);
    if (!fullText || fullText.trim() === "") continue;
    const stamped = lineTimestamp(parsed);
    // Typed input arrives fully wrapped in <user_query>; everything else that
    // leads with a tag is injected context. Untagged lines are counted as
    // typed only when a timestamp exists to window them by.
    const wrapped = unwrapUserQuery(fullText);
    const text =
      wrapped !== undefined
        ? wrapped
        : isInjectedText(fullText) || (!stamped && sessionTimestamp === undefined)
          ? undefined
          : fullText;
    if (!text || text.trim() === "") continue;
    const timestamp = stamped ?? sessionTimestamp;
    if (!timestamp) continue;
    const messageId = `${session.sessionId}:${line}`;
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

/** Inner text of a fully <user_query>-wrapped line, else undefined. */
export function unwrapUserQuery(text: string): string | undefined {
  const trimmed = text.trim();
  const match = /^<user_query>([\s\S]*)<\/user_query>$/.exec(trimmed);
  return match ? match[1] : undefined;
}

/**
 * Session timestamp for transcripts whose lines carry no time: the chats
 * metadata (updatedAtMs, else createdAtMs) when the session id is registered
 * under ~/.cursor/chats, else the transcript file mtime (end-of-session
 * approximation; documented granularity limitation).
 */
export function defaultSessionTimestampMs(
  sessionId: string,
  transcriptFile: string,
  cursorHome: string,
): number | undefined {
  const chatsDir = path.join(cursorHome, "chats");
  try {
    for (const hash of fs.readdirSync(chatsDir, { withFileTypes: true })) {
      if (!hash.isDirectory()) continue;
      const metaPath = path.join(chatsDir, hash.name, sessionId, "meta.json");
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
        updatedAtMs?: unknown;
        createdAtMs?: unknown;
      };
      if (typeof meta.updatedAtMs === "number") return meta.updatedAtMs;
      if (typeof meta.createdAtMs === "number") return meta.createdAtMs;
    }
  } catch {
    // fall through to mtime
  }
  try {
    return fs.statSync(transcriptFile).mtimeMs;
  } catch {
    return undefined;
  }
}

function extractAgentText(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.text === "string") return parsed.text;
  const message = parsed.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const t = contentText((message as Record<string, unknown>).content);
    if (t !== undefined) return t;
  }
  return contentText(parsed.content);
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = (content as Record<string, unknown>[])
    .filter((block) => typeof block?.type === "string" && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Injected-context discrimination for agent transcripts (pinned on a real
 * Mac): injected lines lead with a tag — typed input is either fully wrapped
 * in <user_query> or untagged.
 */
export function isInjectedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  return /^<[a-zA-Z][a-zA-Z0-9_-]*[>\s]/.test(trimmed);
}

export async function extractCursorRecords(
  session: DiscoveredSession,
  options: CursorAdapterOptions = {},
  floorMs = 0,
): Promise<{ records: HumanMessageRecord[] }> {
  const records: HumanMessageRecord[] = [];
  const iterable =
    session.source === "cursor-agent"
      ? extractAgentTranscript(session, options)
      : extractComposerBubbles(session, options, floorMs);
  for await (const record of iterable) records.push(record);
  return { records: dedupeRecords(records).records };
}
