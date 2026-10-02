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
  SkipCounter,
} from "../adapter";

export interface GrokBotAdapterOptions {
  /** Overrides the default Grok Bot app-data directory. */
  grokBotDataDir?: string;
  /** Home directory override for tests. */
  homeDir?: string;
}

export function defaultGrokBotDataDir(options: GrokBotAdapterOptions = {}): string {
  return (
    options.grokBotDataDir ??
    path.join(
      options.homeDir ?? process.env.HOME ?? "",
      "Library",
      "Application Support",
      "Grok Bot",
    )
  );
}

const PERSISTENCE_DIR = "sand-client-persistence";
const TRANSCRIPT_REPLICA_SUFFIX = ".transcript.replicas.";

/**
 * Blob filenames are lowercase RFC 4648 base32 of the UTF-8 storage key
 * (pinned on a real Mac corpus, KDATAP-f66d10). Conversation blobs decode to
 * keys ending in `<suffix><conversation-uuid>`; every other key (ui-layout,
 * account auth, cloud-agents registry, send-journal, ...) is not a transcript.
 */
export function decodeBlobKeyName(filename: string): string | undefined {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let val = 0;
  const bytes: number[] = [];
  for (const char of filename) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return undefined;
    val = (val << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((val >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export function conversationIdFromKeyName(keyName: string): string | undefined {
  const index = keyName.lastIndexOf(TRANSCRIPT_REPLICA_SUFFIX);
  if (index < 0) return undefined;
  const id = keyName.slice(index + TRANSCRIPT_REPLICA_SUFFIX.length);
  return id === "" ? undefined : id;
}

/**
 * Doctor check: report blob counts and layout issues (counts only).
 */
export interface GrokBotDoctorReport {
  grokBotDataDir: string;
  blobCount: number;
  transcriptBlobCount: number;
  issues: string[];
}

export function doctorGrokBot(options: GrokBotAdapterOptions = {}): GrokBotDoctorReport {
  const grokBotDataDir = defaultGrokBotDataDir(options);
  const report: GrokBotDoctorReport = {
    grokBotDataDir,
    blobCount: 0,
    transcriptBlobCount: 0,
    issues: [],
  };
  const persistence = path.join(grokBotDataDir, PERSISTENCE_DIR);
  if (!fs.existsSync(persistence)) {
    report.issues.push(`${PERSISTENCE_DIR}/ missing`);
    return report;
  }
  for (const entry of fs.readdirSync(persistence, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".blob")) continue;
    report.blobCount += 1;
    const keyName = decodeBlobKeyName(entry.name.replace(/\.blob$/, ""));
    if (keyName && conversationIdFromKeyName(keyName)) report.transcriptBlobCount += 1;
  }
  return report;
}

/**
 * Grok Bot adapter: conversation transcripts are `{schemaVersion,value:{entries}}`
 * JSON blobs under `~/Library/Application Support/Grok Bot/sand-client-persistence/`.
 *
 * Counting rule (pinned on a real Mac corpus, KDATAP-f66d10): human speech is
 * `kind:"message"` with `role:"user"` and no `fromAgent` — plain entries are
 * composer-typed/pasted input, `fromUser` entries are input via a remote
 * channel. `send-message` entries are the app persona's own output or derived
 * relays of agent-directed messages, `role:"user"` with `fromAgent` is crew
 * bot speech, and `role:"assistant"` is agent output: all skipped.
 * Entry ids are per-conversation-local (reused across conversations with
 * different content), so the record id embeds the conversation id.
 */
export function createGrokBotAdapter(options: GrokBotAdapterOptions = {}): SentimentAdapter {
  const discover = (roots?: string[]): AdapterDiscoveryResult => {
    const skipCounter = createSkipCounter();
    const sessions: DiscoveredSession[] = [];
    const dataDir = defaultGrokBotDataDir(options);
    const searchRoots = roots ?? [dataDir];
    for (const root of searchRoots) {
      const persistence = root.endsWith(PERSISTENCE_DIR) ? root : path.join(root, PERSISTENCE_DIR);
      if (!fs.existsSync(persistence)) {
        skipCounter.missingRoots.push(persistence);
        continue;
      }
      for (const entry of fs.readdirSync(persistence, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".blob")) continue;
        const keyName = decodeBlobKeyName(entry.name.replace(/\.blob$/, ""));
        const conversationId = keyName ? conversationIdFromKeyName(keyName) : undefined;
        if (!conversationId) continue;
        sessions.push({
          source: "grok-bot",
          sessionId: conversationId,
          file: path.join(persistence, entry.name),
        });
      }
    }
    return { sessions, skipCounter };
  };

  return {
    source: "grok-bot",
    discover,
    extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord> {
      return extractGrokBotSession(session);
    },
  };
}

export async function extractGrokBotRecords(
  session: DiscoveredSession,
): Promise<AdapterExtractResult> {
  const skipCounter = createSkipCounter();
  const records: HumanMessageRecord[] = [];
  for await (const record of extractGrokBotSession(session, skipCounter)) {
    records.push(record);
  }
  return { records, skipCounter };
}

interface GrokEntry {
  kind?: unknown;
  id?: unknown;
  role?: unknown;
  content?: unknown;
  fromAgent?: unknown;
  fromUser?: unknown;
  toAgent?: unknown;
  timestampMs?: unknown;
}

async function* extractGrokBotSession(
  session: DiscoveredSession,
  skipCounter: SkipCounter = createSkipCounter(),
): AsyncIterable<HumanMessageRecord> {
  let parsed: { value?: { entries?: unknown } } | undefined;
  try {
    parsed = JSON.parse(fs.readFileSync(session.file, "utf8")) as {
      value?: { entries?: unknown };
    };
  } catch {
    // Throwing lets the per-file scan guard record the failure and continue.
    throw new Error(`unparseable blob JSON: ${session.file}`);
  }
  const entries = parsed?.value?.entries;
  if (!Array.isArray(entries)) {
    skipCounter.malformedLines += 1;
    return;
  }

  let ordinal = 0;
  for (const entry of entries as GrokEntry[]) {
    const line = ordinal + 1;
    ordinal += 1;
    if (!entry || typeof entry !== "object") {
      skipCounter.malformedLines += 1;
      continue;
    }
    if (entry.kind !== "message") {
      // send-message (persona output / derived relays), voice-call, event, and
      // unknown kinds are tolerantly ignored; unknowns are counted.
      if (
        entry.kind !== "send-message" &&
        entry.kind !== "voice-call" &&
        entry.kind !== "event"
      ) {
        skipCounter.unknownRecords += 1;
      }
      continue;
    }
    if (entry.role !== "user") continue; // assistant output (incl. toAgent relays)
    if (entry.fromAgent != null) continue; // crew bot speech, not human input

    const text = entry.content;
    if (typeof text !== "string" || text.trim() === "") {
      skipCounter.malformedLines += 1;
      continue;
    }
    if (typeof entry.timestampMs !== "number" || !Number.isFinite(entry.timestampMs)) {
      skipCounter.malformedLines += 1;
      continue;
    }
    const nativeId = typeof entry.id === "string" ? entry.id : undefined;
    const recordId = `${session.sessionId}:${nativeId ?? `#${line}`}`;
    const timestamp = normalizeTimestampToRfc3339Utc(entry.timestampMs);
    yield {
      source: "grok-bot",
      sessionId: session.sessionId,
      recordId,
      projectPath: "grok-bot",
      timestamp,
      role: "human",
      text,
      dedupKey: buildDedupKey({
        source: "grok-bot",
        recordId,
        sessionId: session.sessionId,
        timestamp,
        text,
      }),
      provenance: { file: session.file, line, key: recordId },
    };
  }
}