import { countMessage } from "./counting";
import type { SentimentFamily } from "./counting";
import { loadSentimentWordList } from "./word-lists";
import type { SentimentWordList } from "./word-lists";
import type { SentimentBackend } from "./sentiment-classifier";
import { createSentimentBackend } from "./sentiment-classifier";
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
  /** Present when a sentiment backend was configured for the run. */
  sentiment?: SentimentAggregate;
}

/** Counts-only sentiment aggregate; never carries message text. */
export interface SentimentAggregate {
  /** Backend identifier (e.g. "vader", "transformer"). */
  backend: string;
  /** Messages that produced a score (fully excluded messages are skipped). */
  scoredMessages: number;
  /** Mean compound score over scored messages, or null with none. */
  meanCompound: number | null;
  pos: number;
  neu: number;
  neg: number;
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
  /** Present when a sentiment backend was configured for the run. */
  sentiment?: SentimentAggregate;
}

/**
 * Aggregate counted messages over a resolved window. Deterministic: the same
 * records and window always yield the same report.
 */
interface Accumulator {
  compoundSum: number;
  pos: number;
  neu: number;
  neg: number;
}

function emptyAccumulator(): Accumulator {
  return { compoundSum: 0, pos: 0, neu: 0, neg: 0 };
}

function finalizeAggregate(
  backendName: string,
  acc: Accumulator,
): SentimentAggregate {
  const scoredMessages = acc.pos + acc.neu + acc.neg;
  return {
    backend: backendName,
    scoredMessages,
    meanCompound: scoredMessages > 0 ? acc.compoundSum / scoredMessages : null,
    pos: acc.pos,
    neu: acc.neu,
    neg: acc.neg,
  };
}
export function computeMeter(
  records: HumanMessageRecord[],
  window: WindowBounds,
  options: {
    bands?: MeterBands;
    wordList?: SentimentWordList;
    sentimentBackend?: SentimentBackend;
  } = {},
): MeterReport {
  const bands = options.bands ?? DEFAULT_METER_BANDS;
  const wordList = options.wordList ?? loadSentimentWordList();
  const sentimentBackend = options.sentimentBackend;
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
  const sentimentOverall: Accumulator | null = sentimentBackend ? emptyAccumulator() : null;
  const sentimentBySource: Record<string, Accumulator> = {};

  for (const record of records) {
    report.messagesScanned += 1;
    sessions.add(record.sessionId);
    const source = record.source;
    perSource[source] ??= { messages: 0, thanksTokens: 0, fbombTokens: 0, sessions: 0 };
    perSource[source].messages += 1;
    const counted = countMessage(record.text, wordList);
    if (counted.excluded) report.excludedMessages += 1;
    if (sentimentBackend) {
      const score = sentimentBackend.scoreMessage(record.text);
      if (score) {
        sentimentOverall![score.label] += 1;
        sentimentOverall!.compoundSum += score.compound;
        sentimentBySource[source] ??= emptyAccumulator();
        const acc = sentimentBySource[source];
        acc[score.label] += 1;
        acc.compoundSum += score.compound;
      }
    }
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

  if (sentimentBackend) {
    report.sentiment = finalizeAggregate(sentimentBackend.name, sentimentOverall!);
    for (const key of Object.keys(sentimentBySource)) {
      perSource[key].sentiment = finalizeAggregate(sentimentBackend.name, sentimentBySource[key]);
    }
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
  sentimentBackend?: string;
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
  const sentimentBackend = options.sentimentBackend
    ? createSentimentBackend(options.sentimentBackend)
    : undefined;
  return computeMeter(filtered, window, {
    bands: options.bands,
    wordList: options.wordList,
    sentimentBackend,
  });
}
