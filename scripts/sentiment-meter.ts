#!/usr/bin/env node
/**
 * Coding-session sentiment meter: thanks vs. F-bombs.
 *
 * Scans local AI coding sessions (Claude Code, Cursor, Codex) and prints a
 * counts-only vibe meter. Everything stays local; output never contains
 * message text.
 *
 * Usage:
 *   pnpm run sentiment:meter -- --window today --day-start 04:00
 */

import { parseArgs } from "node:util";

import {
  formatMeterText,
  runSentimentMeter,
} from "../src/sentiment/run";
import { doctorClaudeCode } from "../src/sentiment/adapters/claude-code";
import { doctorCursor } from "../src/sentiment/adapters/cursor";
import { doctorCodex } from "../src/sentiment/adapters/codex";
import { loadSentimentConfig } from "../src/sentiment/config";
import type { SentimentSource } from "../src/sentiment/record";

export interface CliOptions {
  window?: string;
  since?: string;
  until?: string;
  dayStart?: string;
  timezone?: string;
  sources?: string;
  json?: boolean;
  cacheDir?: string;
  doctor?: boolean;
  configHome?: string;
  // Root overrides (test hooks and personal roots):
  claudeConfigDir?: string;
  cursorUserDir?: string;
  cursorHomeDir?: string;
  codexHome?: string;
}

export async function runCli(options: CliOptions): Promise<void> {
  // Precedence: CLI flags over config over defaults.
  const config = loadSentimentConfig(options.configHome);
  const timezone = options.timezone ?? config.timezone;
  const dayStart = options.dayStart ?? config.dayStart;
  const sources = (options.sources
    ? options.sources.split(",").map((s) => s.trim())
    : config.sources) as SentimentSource[] | undefined;

  if (options.doctor) {
    const claude = doctorClaudeCode(
      options.claudeConfigDir ? { claudeConfigDir: options.claudeConfigDir } : {},
    );
    const cursor = doctorCursor({
      cursorUserDir: options.cursorUserDir,
      cursorHomeDir: options.cursorHomeDir,
    });
    const codex = doctorCodex({ codexHome: options.codexHome });
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ claudeCode: claude, cursor, codex }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(
        [
          `claude-code: ${claude.roots.map((r) => `${r.root} ${r.present ? `${r.transcriptCount} transcripts` : "missing"}`).join("; ") || "no roots"}`,
          `cursor: global db ${cursor.globalDbPresent ? "present" : "missing"}, ${cursor.workspaceDbs} workspace dbs, ${cursor.agentTranscriptSessions} agent sessions${cursor.issues.length ? `; issues: ${cursor.issues.join("; ")}` : ""}`,
          `codex: ${codex.rolloutCount} rollouts, ${codex.archivedRolloutCount} archived${codex.issues.length ? `; notes: ${codex.issues.join("; ")}` : ""}`,
        ].join("\n") + "\n",
      );
    }
    return;
  }

  const { report } = await runSentimentMeter({
    window: options.window ?? "today",
    timezone,
    dayStart,
    since: options.since,
    until: options.until,
    sources,
    roots: config.roots as never,
    cursorOptions: {
      cursorUserDir: options.cursorUserDir,
      cursorHomeDir: options.cursorHomeDir,
    },
    claudeOptions: { claudeConfigDir: options.claudeConfigDir },
    codexOptions: { codexHome: options.codexHome },
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          window: report.window.label,
          windowStart: new Date(report.window.startMs).toISOString(),
          windowEnd: new Date(report.window.endMs).toISOString(),
          thanksTokens: report.thanksTokens,
          fbombTokens: report.fbombTokens,
          thanksMessages: report.thanksMessages,
          fbombMessages: report.fbombMessages,
          humanMessages: report.humanMessages,
          messagesScanned: report.messagesScanned,
          sessionsScanned: report.sessionsScanned,
          gauge: report.gauge,
          band: report.band,
          perSource: report.perSource,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(formatMeterText(report) + "\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      window: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      "day-start": { type: "string" },
      timezone: { type: "string" },
      sources: { type: "string" },
      json: { type: "boolean", default: false },
      "cache-dir": { type: "string" },
      doctor: { type: "boolean", default: false },
      "config-home": { type: "string" },
    },
  });
  await runCli({
    window: values.window,
    since: values.since,
    until: values.until,
    dayStart: values["day-start"],
    timezone: values.timezone,
    sources: values.sources,
    json: values.json,
    cacheDir: values["cache-dir"],
    doctor: values.doctor,
    configHome: values["config-home"],
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };
