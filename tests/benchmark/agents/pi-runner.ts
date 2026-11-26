/**
 * Runs the Pi coding agent (@mariozechner/pi-coding-agent, command `pi`) non-interactively and
 * extracts token usage.
 *
 * Usage source: `pi --mode json` prints one JSON event per line. Every assistant `message_end`
 * event carries `message.usage = { input, output, cacheRead, cacheWrite, totalTokens, cost }`
 * (one per model request). `input` is the uncached input; cached input is `cacheRead`.
 * We sum those and price them ourselves from prices.json (Pi's own `cost` is kept as a cross-check).
 *
 * The API key is read by Pi from the OPENAI_API_KEY environment variable (models.json references
 * the variable name, not the value). Nothing here prints or stores it.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface ModelPrice {
  provider: string;
  tier: string;
  retrievedOn: string;
  sourceUrl: string;
  usdPerMillion: {
    short: { input: number; cachedInput: number; output: number };
    long: { input: number; cachedInput: number; output: number };
  };
  longContextThresholdInputTokens: number;
}

export interface RequestUsage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
  piReportedCostUsd: number | null;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  piReportedCostUsd: number | null;
  toolCalls: number;
  stopReasons: string[];
}

export function loadPrice(pricesFile: string, modelId: string): ModelPrice | null {
  const prices = JSON.parse(fs.readFileSync(pricesFile, "utf8")) as { models: Record<string, ModelPrice> };
  return prices.models[modelId] ?? null;
}

export function requestCostUsd(usage: RequestUsage, price: ModelPrice): number {
  const long = usage.input + usage.cachedInput > price.longContextThresholdInputTokens;
  const rates = long ? price.usdPerMillion.long : price.usdPerMillion.short;
  return (usage.input * rates.input + usage.cachedInput * rates.cachedInput + usage.output * rates.output) / 1e6;
}

export function parsePiEvents(lines: string[]): { requests: RequestUsage[]; summary: UsageSummary } {
  const requests: RequestUsage[] = [];
  const stopReasons: string[] = [];
  let toolCalls = 0;
  for (const line of lines) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "tool_execution_start") toolCalls += 1;
    if (event.type === "message_end" && event.message?.role === "assistant" && event.message.usage) {
      const u = event.message.usage;
      requests.push({
        input: u.input ?? 0,
        cachedInput: u.cacheRead ?? 0,
        cacheWrite: u.cacheWrite ?? 0,
        output: u.output ?? 0,
        piReportedCostUsd: typeof u.cost?.total === "number" ? u.cost.total : null,
      });
      if (event.message.stopReason) stopReasons.push(event.message.stopReason);
    }
  }
  const sum = (f: (r: RequestUsage) => number) => requests.reduce((a, r) => a + f(r), 0);
  const reported = requests.every((r) => r.piReportedCostUsd !== null) && requests.length > 0;
  return {
    requests,
    summary: {
      requests: requests.length,
      inputTokens: sum((r) => r.input),
      cachedInputTokens: sum((r) => r.cachedInput),
      cacheWriteTokens: sum((r) => r.cacheWrite),
      outputTokens: sum((r) => r.output),
      piReportedCostUsd: reported ? sum((r) => r.piReportedCostUsd ?? 0) : null,
      toolCalls,
      stopReasons,
    },
  };
}

export interface RunPiOptions {
  workspace: string;
  prompt: string;
  model: string; // e.g. openai/gpt-6-luna
  thinking: string;
  transcriptPath: string;
  maxCostUsd: number;
  timeoutMs: number;
  price: ModelPrice | null;
}

export interface RunPiResult {
  exitCode: number | null;
  wallSeconds: number;
  aborted: "cost-cap" | "timeout" | null;
  stderrTail: string;
  lines: string[];
}

export function runPi(options: RunPiOptions): Promise<RunPiResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      "pi",
      [
        "--offline",
        "--model", options.model,
        "--thinking", options.thinking,
        "--mode", "json",
        "--no-session",
        "--no-context-files",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "-p", options.prompt,
      ],
      { cwd: options.workspace, stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    const out = fs.createWriteStream(options.transcriptPath);
    const lines: string[] = [];
    let buffer = "";
    let stderr = "";
    let aborted: RunPiResult["aborted"] = null;
    let runningCost = 0;

    const kill = (why: NonNullable<RunPiResult["aborted"]>) => {
      aborted = aborted ?? why;
      child.kill("SIGTERM");
    };
    const timer = setTimeout(() => kill("timeout"), options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      out.write(chunk);
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        lines.push(line);
        if (options.price && line.includes('"message_end"')) {
          const { requests } = parsePiEvents([line]);
          for (const r of requests) runningCost += requestCostUsd(r, options.price);
          if (runningCost > options.maxCostUsd) kill("cost-cap");
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      resolve({ exitCode: code, wallSeconds: (Date.now() - started) / 1000, aborted, stderrTail: stderr, lines });
    });
  });
}

export const transcriptName = (dir: string): string => path.join(dir, "pi-transcript.jsonl");
