import fs from "fs";
import path from "path";
import { buildDedupKey, dedupeRecords } from "../dedup";
import { normalizeTimestampToRfc3339Utc } from "../record";
import type { HumanMessageRecord, SentimentSource } from "../record";
import { createSkipCounter, parseRecordOrSkip } from "../adapter";
import type {
  AdapterDiscoveryResult,
  AdapterExtractResult,
  DiscoveredSession,
  SentimentAdapter,
  SkipCounter,
} from "../adapter";
import { streamJsonlLines } from "./jsonl";

export interface ClaudeCodeAdapterOptions {
  /** Overrides ~/.claude (the CLI honors CLAUDE_CONFIG_DIR). */
  claudeConfigDir?: string;
  /** Extra archive roots mirroring the projects layout (history sources). */
  archiveRoots?: string[];
  /** Home directory override for tests. */
  homeDir?: string;
}

const DEFAULT_HOME = process.env.HOME || "";

function projectsDir(options: ClaudeCodeAdapterOptions): string {
  const configDir = options.claudeConfigDir || path.join(options.homeDir ?? DEFAULT_HOME, ".claude");
  return path.join(configDir, "projects");
}

export interface ClaudeCodeDoctorReport {
  roots: { root: string; present: boolean; transcriptCount: number; subagentsSkipped: number }[];
  issues: string[];
}

/** Doctor check: sample the real roots and report drift diagnostics. */
export function doctorClaudeCode(options: ClaudeCodeAdapterOptions = {}): ClaudeCodeDoctorReport {
  const roots = [projectsDir(options), ...(options.archiveRoots ?? [])];
  const report: ClaudeCodeDoctorReport = { roots: [], issues: [] };
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      report.roots.push({ root, present: false, transcriptCount: 0, subagentsSkipped: 0 });
      continue;
    }
    let transcriptCount = 0;
    let subagentsSkipped = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(root, entry.name);
      for (const file of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (file.isDirectory()) {
          if (file.name === "subagents") subagentsSkipped += 1;
          continue;
        }
        if (file.name.endsWith(".jsonl") && !file.name.startsWith("agent-")) transcriptCount += 1;
      }
    }
    report.roots.push({ root, present: true, transcriptCount, subagentsSkipped });
  }
  return report;
}

/**
 * Claude Code adapter: session transcripts at
 * ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. Parsing is tolerant —
 * the official docs state the JSONL entry format is internal and changes
 * between versions, so unknown record types are skipped and counted.
 */
export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): SentimentAdapter {
  const discover = (roots?: string[]): AdapterDiscoveryResult => {
    const skipCounter = createSkipCounter();
    const searchRoots = roots ?? [projectsDir(options), ...(options.archiveRoots ?? [])];
    const sessions: DiscoveredSession[] = [];
    let sawAnyRoot = false;
    for (const root of searchRoots) {
      if (!fs.existsSync(root)) {
        skipCounter.missingRoots.push(root);
        continue;
      }
      sawAnyRoot = true;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "subagents") continue;
        const projectDir = path.join(root, entry.name);
        for (const file of fs.readdirSync(projectDir, { withFileTypes: true })) {
          if (file.isDirectory() || !file.name.endsWith(".jsonl")) continue;
          if (file.name.startsWith("agent-")) continue; // subagent transcript
          const filePath = path.join(projectDir, file.name);
          sessions.push({
            source: "claude-code",
            sessionId: file.name.slice(0, -6),
            file: filePath,
            projectPath: decodeProjectDirName(entry.name),
          });
        }
      }
    }
    if (!sawAnyRoot && (roots === undefined)) {
      // A missing root means the source is absent, not an error; discovery
      // simply returns no sessions (tracked in skipCounter.missingRoots).
    }
    return { sessions, skipCounter };
  };

  return {
    source: "claude-code",
    discover,
    extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
      return extractSession(session, createSkipCounter());
    },
  };
}

/**
 * Decode the encoded project directory name back to a best-effort path.
 * The encoding replaces non-alphanumeric characters with dashes, so decoding
 * is inherently lossy; per-record `cwd` fields are authoritative.
 */
export function decodeProjectDirName(encoded: string): string {
  return "/" + encoded.split("-").filter((s) => s !== "").join("/");
}

const INJECTED_TEXT_TAGS = [
  "system-reminder",
  "task-notification",
  "interrupted-request",
];
void INJECTED_TEXT_TAGS;

/** Convenience wrapper for tests and the doctor: collect one session's records. */
export async function extractClaudeCodeRecords(
  session: DiscoveredSession,
): Promise<AdapterExtractResult> {
  const skipCounter = createSkipCounter();
  const records: HumanMessageRecord[] = [];
  for await (const record of extractSession(session, skipCounter)) {
    records.push(record);
  }
  return { records, skipCounter };
}

export async function* extractSession(
  session: DiscoveredSession,
  skipCounter: SkipCounter,
): AsyncIterable<HumanMessageRecord> {
  for await (const { line, text: rawLine } of streamJsonlLines(session.file)) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skipCounter.malformedLines += 1;
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;
    if (type !== "user") continue;
    const message = record.message as Record<string, unknown> | undefined;
    if (!message || message.role !== "user") continue;

    if (record.isMeta === true) continue;
    if (record.isSidechain === true) continue;
    const promptSource = typeof record.promptSource === "string" ? record.promptSource : undefined;
    if (promptSource === "system" || promptSource === "sdk") continue;
    if (record.isCompactSummary === true) continue;

    const content = message.content;
    const text = extractHumanText(content);
    if (text === undefined) continue;
    if (text.trim() === "") continue;
    if (isInjectedText(text)) continue;

    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
    if (!timestamp) {
      skipCounter.malformedLines += 1;
      continue;
    }
    const uuid = typeof record.uuid === "string" ? record.uuid : undefined;
    const attachment = record.attachment as Record<string, unknown> | undefined;
    const recordId =
      attachment && typeof attachment.prompt === "string" && isHumanAttachment(attachment)
        ? `queued:${uuid ?? `${session.sessionId}:${line}`}`
        : uuid ?? `${session.sessionId}:${line}`;
    const cwd = typeof record.cwd === "string" ? record.cwd : session.projectPath ?? "";
    yield {
      source: "claude-code",
      sessionId: typeof record.sessionId === "string" ? record.sessionId : session.sessionId,
      recordId,
      projectPath: cwd,
      timestamp: normalizeTimestampToRfc3339Utc(timestamp),
      role: "human",
      text,
      dedupKey: buildDedupKey({
        source: "claude-code",
        recordId: uuid,
        sessionId: session.sessionId,
        timestamp: normalizeTimestampToRfc3339Utc(timestamp),
        text,
      }),
      provenance: { file: session.file, line, key: recordId },
    };
  }
}

function isHumanAttachment(attachment: unknown): boolean {
  const att = attachment as Record<string, unknown> | undefined;
  if (!att) return false;
  const origin = att.origin as Record<string, unknown> | undefined;
  return origin?.kind === "human";
}

/**
 * Pull human-typed text out of message content: a plain string, or text
 * blocks (queued-command attachments ride along as text blocks). Tool-result
 * blocks are never human text. Image placeholders are stripped.
 */
function extractHumanText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  let sawTextBlock = false;
  for (const block of content as Record<string, unknown>[]) {
    const blockType = typeof block.type === "string" ? block.type : undefined;
    if (blockType === "tool_result") continue;
    if (blockType === "image") continue; // strip image placeholders
    if (blockType === "text" && typeof block.text === "string") {
      sawTextBlock = true;
      parts.push(block.text);
    }
  }
  return sawTextBlock ? parts.join("\n") : undefined;
}

/** True when the text is entirely an injected wrapper or continuation marker. */
export function isInjectedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (/^<system-reminder>[\s\S]*<\/system-reminder>$/.test(trimmed)) return true;
  if (/^<task-notification>[\s\S]*<\/task-notification>$/.test(trimmed)) return true;
  if (/^<interrupted-request>[\s\S]*<\/interrupted-request>$/.test(trimmed)) return true;
  if (trimmed.startsWith("<command-name>") || trimmed.startsWith("<command-message>")) return true;
  if (/^This session is being continued from a previous conversation/.test(trimmed)) return true;
  return false;
}
