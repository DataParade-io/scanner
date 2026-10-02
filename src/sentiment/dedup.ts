import { createHash } from "crypto";
import type { HumanMessageRecord } from "./record";

export interface DedupStats {
  seen: number;
  unique: number;
  collapsed: number;
}

/**
 * dedupKey = sha256(source + recordId) when a stable native id exists, else
 * sha256(source + sessionId + timestamp + text hash).
 */
export function buildDedupKey(input: {
  source: string;
  recordId?: string | null;
  sessionId: string;
  timestamp: string;
  text: string;
}): string {
  const identity = input.recordId
    ? `${input.source}\u0000${input.recordId}`
    : `${input.source}\u0000${input.sessionId}\u0000${input.timestamp}\u0000${createHash("sha256").update(input.text).digest("hex")}`;
  return createHash("sha256").update(identity).digest("hex");
}

/**
 * Union all physical copies of the same session (active root plus archives,
 * forks, mirrored sessions) and count identical records once. The dedup set
 * holds hashes only, never text. Records are ordered by timestamp, never by
 * file order or mtime.
 */
export function dedupeRecords(records: HumanMessageRecord[]): {
  records: HumanMessageRecord[];
  stats: DedupStats;
} {
  const byKey = new Map<string, HumanMessageRecord>();
  for (const record of records) {
    const existing = byKey.get(record.dedupKey);
    if (!existing) {
      byKey.set(record.dedupKey, record);
      continue;
    }
    if (record.timestamp < existing.timestamp) {
      byKey.set(record.dedupKey, record);
    }
  }
  const unique = [...byKey.values()].sort(compareByTimestamp);
  return {
    records: unique,
    stats: {
      seen: records.length,
      unique: unique.length,
      collapsed: records.length - unique.length,
    },
  };
}

function compareByTimestamp(a: HumanMessageRecord, b: HumanMessageRecord): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.dedupKey !== b.dedupKey) return a.dedupKey < b.dedupKey ? -1 : 1;
  return 0;
}
