import fs from "fs";
import path from "path";
import { buildDedupKey } from "../dedup";
import { normalizeTimestampToRfc3339Utc } from "../record";
import type { HumanMessageRecord } from "../record";
import { createSkipCounter } from "../adapter";
import { openSqliteFile } from "./sqlite-reader";
import type { RawSqliteDatabase } from "./sqlite-reader";
import type {
  AdapterDiscoveryResult,
  AdapterExtractResult,
  DiscoveredSession,
  SentimentAdapter,
  SkipCounter,
} from "../adapter";

export interface AntigravityAdapterOptions {
  /** Overrides the default ~/.gemini parent directory of both data roots. */
  antigravityHome?: string;
  /** Explicit root override (each root holds conversations/ + summaries). */
  antigravityRoots?: string[];
  /** Home directory override for tests. */
  homeDir?: string;
}

export function defaultAntigravityRoots(options: AntigravityAdapterOptions = {}): string[] {
  if (options.antigravityRoots) return options.antigravityRoots;
  const geminiHome =
    options.antigravityHome ??
    path.join(options.homeDir ?? process.env.HOME ?? "", ".gemini");
  return ["antigravity", "antigravity-cli"].map((name) => path.join(geminiHome, name));
}

const CONVERSATIONS_DIR = "conversations";
const SUMMARIES_DB = "conversation_summaries.db";

/**
 * Minimal protobuf reader (no schema is shipped with the app; payloads were
 * pinned structurally on a real Mac corpus, KDATAP-91efe7). Only wire types
 * 0 and 2 are handled, which is all the user-turn payload needs.
 */
interface ProtoField {
  field: number;
  wire: number;
  varint?: bigint;
  bytes?: Buffer;
}

function parseProtoFields(buf: Buffer): ProtoField[] | undefined {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag = 0n;
    let shift = 0n;
    while (true) {
      if (pos >= buf.length) return undefined;
      const b = buf[pos++];
      tag |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
      if (shift > 63n) return undefined;
    }
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field === 0) return undefined;
    if (wire === 0) {
      let val = 0n;
      shift = 0n;
      while (true) {
        if (pos >= buf.length) return undefined;
        const b = buf[pos++];
        val |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7n;
        if (shift > 63n) return undefined;
      }
      fields.push({ field, wire, varint: val });
    } else if (wire === 2) {
      let len = 0n;
      shift = 0n;
      while (true) {
        if (pos >= buf.length) return undefined;
        const b = buf[pos++];
        len |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7n;
        if (shift > 63n) return undefined;
      }
      const byteLen = Number(len);
      if (byteLen < 0 || pos + byteLen > buf.length) return undefined;
      fields.push({ field, wire, bytes: buf.subarray(pos, pos + byteLen) });
      pos += byteLen;
    } else {
      return undefined; // fixed32/64 and groups do not appear in user turns
    }
  }
  return fields;
}

function asText(buf: Buffer): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    if ([...text].every((c) => c.charCodeAt(0) >= 32 || c === "\n" || c === "\t" || c === "\r")) {
      return text;
    }
  } catch {
    // not text
  }
  return undefined;
}

/**
 * Extract the user-turn text from a type-14 step_payload: field 19 (submessage)
 * field 2 is the full message text; field 19.3 holds the same text as a parts
 * list (never read — counting it would double-count), and field 19.7 marks
 * artifact/plan attach sends with a URI instead of text.
 */
export function antigravityUserText(payload: Buffer): string | undefined {
  const top = parseProtoFields(payload);
  if (!top) return undefined;
  const texts: string[] = [];
  for (const f19 of top.filter((f) => f.field === 19 && f.wire === 2 && f.bytes)) {
    const inner = parseProtoFields(f19.bytes as Buffer);
    if (!inner) continue;
    for (const f2 of inner.filter((f) => f.field === 2 && f.wire === 2 && f.bytes)) {
      const text = asText(f2.bytes as Buffer);
      if (text) texts.push(text);
    }
  }
  if (texts.length === 0) return undefined;
  return texts.join("\n");
}

/** True when the type-14 step is an artifact/plan attach send (URI, no text). */
export function isArtifactAttachStep(payload: Buffer): boolean {
  const top = parseProtoFields(payload);
  if (!top) return false;
  for (const f19 of top.filter((f) => f.field === 19 && f.wire === 2 && f.bytes)) {
    const inner = parseProtoFields(f19.bytes as Buffer);
    if (inner && inner.some((f) => f.field === 7 && f.wire === 2)) return true;
  }
  return false;
}

/**
 * Extract the per-step timestamp from payload field 5.1.1 (epoch seconds) and
 * 5.1.2 (nanos), or undefined when absent.
 */
export function antigravityStepTimestampMs(payload: Buffer): number | undefined {
  const top = parseProtoFields(payload);
  if (!top) return undefined;
  for (const f5 of top.filter((f) => f.field === 5 && f.wire === 2 && f.bytes)) {
    const meta = parseProtoFields(f5.bytes as Buffer);
    if (!meta) continue;
    for (const f1 of meta.filter((f) => f.field === 1 && f.wire === 2 && f.bytes)) {
      const ts = parseProtoFields(f1.bytes as Buffer);
      if (!ts) continue;
      const seconds = ts.find((f) => f.field === 1 && f.wire === 0)?.varint;
      const nanos = ts.find((f) => f.field === 2 && f.wire === 0)?.varint;
      if (seconds === undefined) continue;
      const ms = Number(seconds) * 1000 + Math.floor(Number(nanos ?? 0n) / 1_000_000);
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
  }
  return undefined;
}

/** Summary-row lookup result (counts/paths only; titles never persisted). */
interface ConversationSummary {
  parentConversationId: string;
  workspaceUris: string;
}

function loadSummaries(root: string): Map<string, ConversationSummary> {
  const out = new Map<string, ConversationSummary>();
  const dbPath = path.join(root, SUMMARIES_DB);
  if (!fs.existsSync(dbPath)) return out;
  try {
    const db = openSqliteFile(dbPath, { copyThenRead: true });
    try {
      const rows = db
        .prepare(
          "SELECT conversation_id, parent_conversation_id, workspace_uris FROM conversation_summaries",
        )
        .all() as { conversation_id: string; parent_conversation_id: string; workspace_uris: string }[];
      for (const row of rows) {
        out.set(row.conversation_id, {
          parentConversationId: row.parent_conversation_id ?? "",
          workspaceUris: row.workspace_uris ?? "",
        });
      }
    } finally {
      db.dispose();
    }
  } catch {
    // Unreadable summaries mean no attribution; conversations still scan.
  }
  return out;
}

function projectPathFromWorkspaceUris(workspaceUris: string): string {
  const first = workspaceUris.split(",")[0]?.trim() ?? "";
  if (first === "") return "antigravity";
  return first.startsWith("file://") ? first.slice("file://".length) : first;
}

/**
 * Doctor check: report conversation counts per root (counts only).
 */
export interface AntigravityDoctorReport {
  roots: { root: string; present: boolean; conversationCount: number; nestedCount: number }[];
  issues: string[];
}

export function doctorAntigravity(options: AntigravityAdapterOptions = {}): AntigravityDoctorReport {
  const report: AntigravityDoctorReport = { roots: [], issues: [] };
  for (const root of defaultAntigravityRoots(options)) {
    const conversations = path.join(root, CONVERSATIONS_DIR);
    const present = fs.existsSync(conversations);
    const entry = { root, present, conversationCount: 0, nestedCount: 0 };
    report.roots.push(entry);
    if (!present) {
      report.issues.push(`${conversations} missing`);
      continue;
    }
    const summaries = loadSummaries(root);
    for (const file of fs.readdirSync(conversations)) {
      if (!file.endsWith(".db")) continue;
      entry.conversationCount += 1;
      if ((summaries.get(file.replace(/\.db$/, ""))?.parentConversationId ?? "") !== "") {
        entry.nestedCount += 1;
      }
    }
  }
  return report;
}

/**
 * Antigravity adapter: conversation SQLite DBs under
 * `~/.gemini/antigravity/conversations/<uuid>.db` (desktop app) and
 * `~/.gemini/antigravity-cli/conversations/<uuid>.db` (CLI).
 *
 * Counting rule (pinned on a real Mac corpus, KDATAP-91efe7): human speech is
 * `step_type = 14` payload field 19.2 (the full typed message). Nested
 * sub-cascades (summaries parent_conversation_id != "") carry agent-authored
 * dispatch prompts and are excluded entirely; artifact/plan attach sends
 * (field 19.7 URI, no text) and empty-text turns are skipped; all other step
 * types are agent output or bookkeeping.
 */
export function createAntigravityAdapter(options: AntigravityAdapterOptions = {}): SentimentAdapter {
  const discover = (roots?: string[]): AdapterDiscoveryResult => {
    const skipCounter = createSkipCounter();
    const sessions: DiscoveredSession[] = [];
    const searchRoots = roots ?? defaultAntigravityRoots(options);
    for (const root of searchRoots) {
      const conversations = root.endsWith(CONVERSATIONS_DIR) ? root : path.join(root, CONVERSATIONS_DIR);
      if (!fs.existsSync(conversations)) {
        skipCounter.missingRoots.push(conversations);
        continue;
      }
      const summaries = loadSummaries(root.endsWith(CONVERSATIONS_DIR) ? path.dirname(root) : root);
      for (const file of fs.readdirSync(conversations, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".db")) continue;
        const conversationId = file.name.replace(/\.db$/, "");
        const summary = summaries.get(conversationId);
        if (summary && summary.parentConversationId !== "") continue; // nested sub-cascade
        sessions.push({
          source: "antigravity",
          sessionId: conversationId,
          file: path.join(conversations, file.name),
          projectPath: projectPathFromWorkspaceUris(summary?.workspaceUris ?? ""),
        });
      }
    }
    return { sessions, skipCounter };
  };

  return {
    source: "antigravity",
    discover,
    extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
      return extractAntigravitySession(session);
    },
  };
}

export async function extractAntigravityRecords(
  session: DiscoveredSession,
): Promise<AdapterExtractResult> {
  const skipCounter = createSkipCounter();
  const records: HumanMessageRecord[] = [];
  for await (const record of extractAntigravitySession(session, skipCounter)) {
    records.push(record);
  }
  return { records, skipCounter };
}

const USER_STEP_TYPE = 14;

async function* extractAntigravitySession(
  session: DiscoveredSession,
  skipCounter: SkipCounter = createSkipCounter(),
): AsyncIterable<HumanMessageRecord> {
  let db: RawSqliteDatabase;
  try {
    db = openSqliteFile(session.file, { copyThenRead: true, busyTimeoutMs: 1000 });
  } catch (err) {
    skipCounter.failedFiles.push({
      file: session.file,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  try {
    let rows: { idx: number; step_type: number; step_payload: Buffer | null }[];
    try {
      rows = db
        .prepare("SELECT idx, step_type, step_payload FROM steps WHERE step_type = ? ORDER BY idx")
        .all(USER_STEP_TYPE) as typeof rows;
    } catch (err) {
      skipCounter.failedFiles.push({
        file: session.file,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const row of rows) {
      if (!row.step_payload || row.step_payload.length === 0) {
        skipCounter.malformedLines += 1;
        continue;
      }
      const payload = Buffer.from(row.step_payload as unknown as Uint8Array);
      if (isArtifactAttachStep(payload)) continue;
      const text = antigravityUserText(payload);
      if (text === undefined || text.trim() === "") {
        skipCounter.malformedLines += 1;
        continue;
      }
      const tsMs = antigravityStepTimestampMs(payload);
      if (tsMs === undefined) {
        skipCounter.malformedLines += 1;
        continue;
      }
      const timestamp = normalizeTimestampToRfc3339Utc(tsMs);
      const recordId = `${session.sessionId}:${row.idx}`;
      yield {
        source: "antigravity",
        sessionId: session.sessionId,
        recordId,
        projectPath: session.projectPath ?? "antigravity",
        timestamp,
        role: "human",
        text,
        dedupKey: buildDedupKey({
          source: "antigravity",
          recordId,
          sessionId: session.sessionId,
          timestamp,
          text,
        }),
        provenance: { file: session.file, line: row.idx, key: recordId },
      };
    }
  } finally {
    db.dispose();
  }
}