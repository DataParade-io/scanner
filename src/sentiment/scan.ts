import type { HumanMessageRecord } from "./record";
import { dedupeRecords } from "./dedup";
import type { DedupStats } from "./dedup";
import type { AdapterDiscoveryResult, SentimentAdapter, SkipCounter } from "./adapter";

export interface ScanResult {
  records: HumanMessageRecord[];
  stats: DedupStats;
  skipCounter: SkipCounter;
  sessionsScanned: number;
}

/**
 * Run one adapter over its roots: discover sessions, extract with a per-file
 * crash guard (a parse crash inside an adapter is caught per file and
 * reported while the scan continues), then union-dedup identical records
 * across copies.
 */
export async function scanAdapter(
  adapter: SentimentAdapter,
  roots?: string[],
): Promise<ScanResult> {
  const discovery: AdapterDiscoveryResult = adapter.discover(roots);
  const skipCounter = discovery.skipCounter;
  const raw: HumanMessageRecord[] = [];
  for (const session of discovery.sessions) {
    try {
      for await (const record of adapter.extract(session)) {
        raw.push(record);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipCounter.failedFiles.push({ file: session.file, error: message });
    }
  }
  const { records, stats } = dedupeRecords(raw);
  return { records, stats, skipCounter, sessionsScanned: discovery.sessions.length };
}
