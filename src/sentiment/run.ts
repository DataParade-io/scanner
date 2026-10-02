import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createCursorAdapter } from "./adapters/cursor";
import { createCodexAdapter } from "./adapters/codex";
import { createGrokBotAdapter } from "./adapters/grok-bot";
import { createAntigravityAdapter } from "./adapters/antigravity";
import type { CursorAdapterOptions } from "./adapters/cursor";
import type { CodexAdapterOptions } from "./adapters/codex";
import type { ClaudeCodeAdapterOptions } from "./adapters/claude-code";
import type { GrokBotAdapterOptions } from "./adapters/grok-bot";
import type { AntigravityAdapterOptions } from "./adapters/antigravity";
import type { SentimentSource } from "./record";
import { scanAdapter } from "./scan";
import type { ScanResult } from "./scan";
import { computeMeter, gaugeBar } from "./meter";
import type { MeterBands, MeterReport, SentimentAggregate } from "./meter";
import { loadSentimentWordList } from "./word-lists";
import type { SentimentWordList } from "./word-lists";
import { isInWindow, resolveWindow } from "./windows";
import type { AbsoluteBounds } from "./windows";
import { createSentimentBackend } from "./sentiment-classifier";

/** Root overrides keyed at the adapter level; a missing key uses the defaults. */
export type SentimentRoots = Partial<Record<"claude-code" | "cursor" | "codex" | "grok-bot" | "antigravity", string[]>>;

export interface RunSentimentOptions {
  window: string;
  now?: number;
  timezone?: string;
  dayStart?: string;
  since?: string;
  until?: string;
  sources?: SentimentSource[];
  roots?: SentimentRoots;
  bands?: MeterBands;
  wordList?: SentimentWordList;
  /** Sentiment backend name; undefined disables the second metric, "vader" is the local default. */
  sentimentBackend?: string;
  claudeOptions?: ClaudeCodeAdapterOptions;
  cursorOptions?: CursorAdapterOptions;
  codexOptions?: CodexAdapterOptions;
  grokOptions?: GrokBotAdapterOptions;
  antigravityOptions?: AntigravityAdapterOptions;
}

export interface SentimentScanOutput {
  report: MeterReport;
  scanResults: { source: SentimentSource; result: ScanResult }[];
}

/**
 * Scan every requested source (local only), filter the union into the
 * resolved window, and aggregate the meter. Output carries counts only —
 * message text never leaves the records in memory.
 */
export async function runSentimentMeter(options: RunSentimentOptions): Promise<SentimentScanOutput> {
  const now = options.now ?? Date.now();
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const bounds: AbsoluteBounds = { since: options.since, until: options.until };
  const window = resolveWindow(options.window, now, timezone, options.dayStart ?? "00:00", bounds);
  const wordList = options.wordList ?? loadSentimentWordList();
  const requested = options.sources ?? ["claude-code", "cursor-ide", "cursor-agent", "codex", "grok-bot", "antigravity"];

  const scanResults: SentimentScanOutput["scanResults"] = [];
  const inWindow: Parameters<typeof computeMeter>[0] = [];

  if (requested.includes("claude-code")) {
    const adapter = createClaudeCodeAdapter(options.claudeOptions);
    const result = await scanAdapter(adapter, options.roots?.["claude-code"]);
    scanResults.push({ source: "claude-code", result });
    inWindow.push(...result.records.filter((r) => isInWindow(new Date(r.timestamp).getTime(), window)));
  }
  if (requested.includes("cursor-ide") || requested.includes("cursor-agent")) {
    const adapter = createCursorAdapter(options.cursorOptions);
    const result = await scanAdapter(adapter, options.roots?.cursor);
    scanResults.push({ source: "cursor-ide", result });
    inWindow.push(
      ...result.records.filter(
        (r) => requested.includes(r.source) && isInWindow(new Date(r.timestamp).getTime(), window),
      ),
    );
  }
  if (requested.includes("codex")) {
    const adapter = createCodexAdapter(options.codexOptions);
    const result = await scanAdapter(adapter, options.roots?.codex);
    scanResults.push({ source: "codex", result });
    inWindow.push(...result.records.filter((r) => isInWindow(new Date(r.timestamp).getTime(), window)));
  }
  if (requested.includes("grok-bot")) {
    const adapter = createGrokBotAdapter(options.grokOptions);
    const result = await scanAdapter(adapter, options.roots?.["grok-bot"]);
    scanResults.push({ source: "grok-bot", result });
    inWindow.push(...result.records.filter((r) => isInWindow(new Date(r.timestamp).getTime(), window)));
  }
  if (requested.includes("antigravity")) {
    const adapter = createAntigravityAdapter(options.antigravityOptions);
    const result = await scanAdapter(adapter, options.roots?.antigravity);
    scanResults.push({ source: "antigravity", result });
    inWindow.push(...result.records.filter((r) => isInWindow(new Date(r.timestamp).getTime(), window)));
  }

  const report = computeMeter(inWindow, window, {
    bands: options.bands,
    wordList,
    // undefined selects the default backend ("vader"); "" explicitly disables sentiment.
    sentimentBackend:
      options.sentimentBackend === ""
        ? undefined
        : createSentimentBackend(options.sentimentBackend),
  });
  return { report, scanResults };
}

export function formatMeterText(report: MeterReport): string {
  const lines = [
    "Coding-session sentiment meter",
    `Window: ${report.window.label}`,
    `Thanks: ${report.thanksTokens} (${report.thanksMessages} messages)`,
    `F-bombs: ${report.fbombTokens} (${report.fbombMessages} messages)`,
    `Human messages: ${report.humanMessages} in window, ${report.messagesScanned} scanned, ${report.sessionsScanned} sessions`,
    `Gauge: ${gaugeBarOf(report)}`,
    `Band: ${report.band}`,
  ];
  if (report.sentiment) {
    lines.push(`Sentiment: ${formatSentimentAggregate(report.sentiment)}`);
  }
  const sources = Object.entries(report.perSource);
  if (sources.length > 0) {
    lines.push(
      `Per source: ${sources
        .map(([source, s]) => `${source} ${s.messages} msgs (${s.thanksTokens} thanks / ${s.fbombTokens} fbombs)`)
        .join(", ")}`,
    );
    if (report.sentiment) {
      lines.push(
        `Sentiment per source: ${sources
          .map(([source, s]) =>
            s.sentiment
              ? `${source} ${formatSentimentAggregate(s.sentiment)}`
              : `${source} (no scored messages)`,
          )
          .join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

function formatSentimentAggregate(aggregate: SentimentAggregate): string {
  const mean =
    aggregate.meanCompound === null
      ? "n/a"
      : `${aggregate.meanCompound >= 0 ? "+" : ""}${aggregate.meanCompound.toFixed(2)}`;
  return `mean ${mean}, ${aggregate.pos} pos / ${aggregate.neu} neu / ${aggregate.neg} neg of ${aggregate.scoredMessages} scored (${aggregate.backend})`;
}

function gaugeBarOf(report: MeterReport): string {
  return gaugeBar(report.gauge);
}
