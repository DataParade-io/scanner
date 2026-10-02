import { humanMessageRecordSchema } from "./record";
import type { HumanMessageRecord, SentimentSource } from "./record";

/**
 * Failure policy shared by every adapter: a missing root means the source is
 * absent (not an error); malformed lines and unknown record types are skipped
 * and counted, never fatal; a parse crash inside an adapter is caught per file
 * and reported while the scan continues.
 */
export interface SkipCounter {
  missingRoots: string[];
  malformedLines: number;
  unknownRecords: number;
  failedFiles: { file: string; error: string }[];
}

export function createSkipCounter(): SkipCounter {
  return { missingRoots: [], malformedLines: 0, unknownRecords: 0, failedFiles: [] };
}

export interface DiscoveredSession {
  source: SentimentSource;
  sessionId: string;
  file: string;
  projectPath?: string;
}

export interface AdapterDiscoveryResult {
  sessions: DiscoveredSession[];
  skipCounter: SkipCounter;
}

export interface AdapterExtractResult {
  records: HumanMessageRecord[];
  skipCounter: SkipCounter;
}

/**
 * A sentiment source adapter. Discovery finds sessions under the given roots;
 * extraction streams records out of one session file without loading whole
 * transcripts into memory (files can exceed 100 MB).
 */
export interface SentimentAdapter {
  source: SentimentSource;
  discover(roots?: string[]): AdapterDiscoveryResult;
  extract(session: DiscoveredSession): AsyncIterable<HumanMessageRecord>;
}

export function parseRecordOrSkip(
  value: unknown,
  skipCounter: SkipCounter,
): HumanMessageRecord | undefined {
  const result = humanMessageRecordSchema.safeParse(value);
  if (result.success) return result.data;
  skipCounter.malformedLines += 1;
  return undefined;
}
