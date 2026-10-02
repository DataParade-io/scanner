import { createClaudeCodeAdapter } from "./adapters/claude-code";
import { createCursorAdapter } from "./adapters/cursor";
import { createCodexAdapter } from "./adapters/codex";
import { createGrokBotAdapter } from "./adapters/grok-bot";
import type { CursorAdapterOptions } from "./adapters/cursor";
import type { CodexAdapterOptions } from "./adapters/codex";
import type { ClaudeCodeAdapterOptions } from "./adapters/claude-code";
import type { GrokBotAdapterOptions } from "./adapters/grok-bot";
import type { SentimentSource } from "./record";
import { scanAdapter } from "./scan";
import type { ScanResult } from "./scan";
import { computeMeter, gaugeBar } from "./meter";
import type { MeterBands, MeterReport } from "./meter";
import { loadSentimentWordList } from "./word-lists";
import type { SentimentWordList } from "./word-lists";
import { isInWindow, resolveWindow } from "./windows";
import type { AbsoluteBounds } from "./windows";

/** Root overrides keyed at the adapter level; a missing key uses the defaults. */
export type SentimentRoots = Partial<Record<"claude-code" | "cursor" | "codex" | "grok-bot", string[]>>;

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
  claudeOptions?: ClaudeCodeAdapterOptions;
  cursorOptions?: CursorAdapterOptions;
  codexOptions?: CodexAdapterOptions;
  grokOptions?: GrokBotAdapterOptions;
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
  const requested = options.sources ?? ["claude-code", "cursor-ide", "cursor-agent", "codex", "grok-bot"];

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

  const report = computeMeter(inWindow, window, { bands: options.bands, wordList });
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
  const sources = Object.entries(report.perSource);
  if (sources.length > 0) {
    lines.push(
      `Per source: ${sources
        .map(([source, s]) => `${source} ${s.messages} msgs (${s.thanksTokens} thanks / ${s.fbombTokens} fbombs)`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

function gaugeBarOf(report: MeterReport): string {
  return gaugeBar(report.gauge);
}
