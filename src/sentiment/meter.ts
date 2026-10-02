import { countMessage } from "./counting";
import type { SentimentFamily } from "./counting";
import { loadSentimentWordList } from "./word-lists";
import type { SentimentWordList } from "./word-lists";
import type { HumanMessageRecord } from "./record";
import { isInWindow, resolveWindow } from "./windows";
import type { AbsoluteBounds, WindowBounds, WindowSpec } from "./windows";

export interface MeterBands {
  mostlyGratefulAt: number;
  mixedAt: number;
}

export const DEFAULT_METER_BANDS: MeterBands = {
  mostlyGratefulAt: 0.75,
  mixedAt: 0.4,
};

export type MeterBand =
  | "quiet"
  | "mostly grateful"
  | "mixed"
  | "cursing at the machine";

export interface SourceBreakdown {
  messages: number;
  thanksTokens: number;
  fbombTokens: number;
  sessions: number;
}

export interface MeterReport {
  window: WindowBounds;
  thanksTokens: number;
  fbombTokens: number;
  thanksMessages: number;
  fbombMessages: number;
  humanMessages: number;
  /** Messages dropped entirely by exclusion strippers (code, quotes, pastes). */
  excludedMessages: number;
  messagesScanned: number;
  sessionsScanned: number;
  gauge: number | null;
  band: MeterBand;
  perSource: Record<string, SourceBreakdown>;
}

/**
 * Aggregate counted messages over a resolved window. Deterministic: the same
 * records and window always yield the same report.
 */
export function computeMeter(
  records: HumanMessageRecord[],
  window: WindowBounds,
  options: {
    bands?: MeterBands;
    wordList?: SentimentWordList;
  } = {},
): MeterReport {
  const bands = options.bands ?? DEFAULT_METER_BANDS;
  const wordList = options.wordList ?? loadSentimentWordList();
  const perSource: Record<string, SourceBreakdown> = {};
  const report: MeterReport = {
    window,
    thanksTokens: 0,
    fbombTokens: 0,
    thanksMessages: 0,
    fbombMessages: 0,
    humanMessages: 0,
    excludedMessages: 0,
    messagesScanned: 0,
    sessionsScanned: 0,
    gauge: null,
    band: "quiet",
    perSource,
  };
  const sessions = new Set<string>();
  const familyOfSource: Record<string, Set<string>> = {};

  for (const record of records) {
    report.messagesScanned += 1;
    sessions.add(record.dedupKey);
    const source = record.source;
    perSource[source] ??= { messages: 0, thanksTokens: 0, fbombTokens: 0, sessions: 0 };
    perSource[source].messages += 1;
    const counted = countMessage(record.text, wordList);
    if (counted.excluded) report.excludedMessages += 1;
    familyOfSource[source] ??= new Set();
    for (const family of ["gratitude", "fbomb"] as const) {
      const count = counted.families[family];
      const tokens = count.tokenCount;
      if (family === "gratitude") {
        report.thanksTokens += tokens;
        report.thanksMessages += count.messageCount;
        perSource[source].thanksTokens += tokens;
      } else {
        report.fbombTokens += tokens;
        report.fbombMessages += count.messageCount;
        perSource[source].fbombTokens += tokens;
      }
      if (count.messageCount > 0) familyOfSource[source].add(family);
    }
  }
  report.sessionsScanned = sessions.size;
  report.humanMessages = records.length;
  for (const key of Object.keys(perSource)) {
    perSource[key].sessions = new Set(
      records.filter((r) => r.source === key).map((r) => r.sessionId),
    ).size;
  }

  const denominator = report.thanksTokens + report.fbombTokens;
  if (denominator > 0) {
    report.gauge = report.thanksTokens / denominator;
    report.band =
      report.gauge >= bands.mostlyGratefulAt
        ? "mostly grateful"
        : report.gauge >= bands.mixedAt
          ? "mixed"
          : "cursing at the machine";
  } else {
    report.band = "quiet";
  }
  return report;
}

export function gaugeBar(gauge: number | null, width = 20): string {
  if (gauge === null) return `[${"-".repeat(width)}] (quiet)`;
  const filled = Math.round(gauge * width);
  return `[${"=".repeat(filled)}${" ".repeat(width - filled)}] ${(gauge * 100).toFixed(0)}%`;
}

export interface MeterOptions {
  window: WindowSpec | string;
  now?: number;
  timezone?: string;
  dayStart?: string;
  since?: string;
  until?: string;
  sources?: string[];
  bands?: MeterBands;
  wordList?: SentimentWordList;
}

/** Convenience for library callers (Cucumber steps, tests): meter over already-collected records. */
export function meterOverRecords(
  records: HumanMessageRecord[],
  options: MeterOptions,
): MeterReport {
  const now = options.now ?? Date.now();
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const bounds: AbsoluteBounds = { since: options.since, until: options.until };
  const window = resolveWindow(options.window, now, timezone, options.dayStart ?? "00:00", bounds);
  const filtered = records.filter((r) => isInWindow(new Date(r.timestamp).getTime(), window));
  return computeMeter(filtered, window, { bands: options.bands, wordList: options.wordList });
}
