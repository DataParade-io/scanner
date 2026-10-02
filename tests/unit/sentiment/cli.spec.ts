import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { runCli, main } from "../../../scripts/sentiment-meter";
import { generateCursorProfile, cleanupCursorProfile, type FixtureComposer } from "../../unit/sentiment/helpers/cursor-fixture";

function composer(id: string, texts: string[], startMs = 1727784000000): FixtureComposer {
  return {
    composerId: id,
    bubbles: texts.map((text, i) => ({ bubbleId: `${id}-b${i}`, type: 1, text, createdAt: startMs + i * 1000 })),
  };
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  return fn().finally(() => {
    process.stdout.write = original;
  }).then(() => lines.join(""));
}

describe("sentiment-meter CLI", () => {
  it("renders counts-only text output for the all window over fixtures", async () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks, perfect", "fuck, broke again"])],
    });
    const output = await captureStdout(() =>
      runCli({
        window: "all",
        cursorUserDir: profile.userDir,
        cursorHomeDir: profile.cursorHome,
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
        grokDataDir: "/nonexistent/grok",
        antigravityHome: "/nonexistent/gemini",
      }),
    );
    expect(output).toContain("Thanks: 2");
    expect(output).toContain("F-bombs: 1");
    expect(output).toContain("mixed");
    expect(output).not.toContain("thanks, perfect");
    expect(output).not.toContain("fuck, broke again");
    cleanupCursorProfile(profile);
  }, 30000);

  it("emits a machine-readable report with --json", async () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks"])],
    });
    const output = await captureStdout(() =>
      runCli({
        window: "all",
        json: true,
        cursorUserDir: profile.userDir,
        cursorHomeDir: profile.cursorHome,
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
        grokDataDir: "/nonexistent/grok",
        antigravityHome: "/nonexistent/gemini",
      }),
    );
    const payload = JSON.parse(output);
    expect(payload.thanksTokens).toBe(1);
    expect(payload.band).toBe("mostly grateful");
    expect(Object.keys(payload)).toContain("windowStart");
    cleanupCursorProfile(profile);
  }, 30000);

  it("fails fast on an invalid timezone", async () => {
    await expect(
      captureStdout(() => runCli({
        window: "all",
        timezone: "Mars/Olympus",
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
      })),
    ).rejects.toThrow(/invalid IANA timezone/);
  }, 30000);

  it("includes sentiment aggregates in text and JSON output by default", async () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks, perfect", "I hate this, it sucks"])],
    });
    const text = await captureStdout(() =>
      runCli({
        window: "all",
        cursorUserDir: profile.userDir,
        cursorHomeDir: profile.cursorHome,
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
        grokDataDir: "/nonexistent/grok",
        antigravityHome: "/nonexistent/gemini",
      }),
    );
    expect(text).toContain("Sentiment: mean ");
    expect(text).toMatch(/Sentiment: mean [+-]?\d+\.\d+, 1 pos \/ 0 neu \/ 1 neg of 2 scored \(vader\)/);
    expect(text).toContain("Sentiment per source:");
    expect(text).not.toContain("thanks, perfect");

    const jsonText = await captureStdout(() =>
      runCli({
        window: "all",
        json: true,
        sentimentBackend: "vader",
        cursorUserDir: profile.userDir,
        cursorHomeDir: profile.cursorHome,
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
        grokDataDir: "/nonexistent/grok",
        antigravityHome: "/nonexistent/gemini",
      }),
    );
    const payload = JSON.parse(jsonText);
    expect(payload.sentiment.backend).toBe("vader");
    expect(payload.sentiment.scoredMessages).toBe(2);
    expect(payload.sentiment.pos).toBe(1);
    expect(payload.sentiment.neg).toBe(1);
    expect(payload.sentiment.meanCompound).not.toBeNull();
    const scoredSource = Object.values(payload.perSource).find(
      (s) => (s as { sentiment?: { backend: string } }).sentiment,
    ) as { sentiment: { backend: string; scoredMessages: number } };
    expect(scoredSource.sentiment.backend).toBe("vader");
    expect(scoredSource.sentiment.scoredMessages).toBe(2);
    cleanupCursorProfile(profile);
  }, 30000);

  it("can disable the sentiment metric with an empty --sentiment-backend", async () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks"])],
    });
    const output = await captureStdout(() =>
      runCli({
        window: "all",
        sentimentBackend: "",
        cursorUserDir: profile.userDir,
        cursorHomeDir: profile.cursorHome,
        claudeConfigDir: "/nonexistent/claude",
        codexHome: "/nonexistent/codex",
        grokDataDir: "/nonexistent/grok",
        antigravityHome: "/nonexistent/gemini",
      }),
    );
    expect(output).not.toContain("Sentiment");
    cleanupCursorProfile(profile);
  }, 30000);
});

describe("sentiment-meter via ts-node", () => {
  it("runs as a pnpm script over a fixture home", () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks, thanks, fuck"])],
    });
    const stdout = execFileSync(
      "pnpm",
      ["run", "sentiment:meter", "--window", "all", "--json"],
      {
        env: { ...process.env, HOME: profile.homeDir },
        encoding: "utf8",
        cwd: path.join(__dirname, "../../.."),
      },
    );
    const jsonStart = stdout.indexOf("{");
    const payload = JSON.parse(stdout.slice(jsonStart));
    expect(payload.thanksTokens).toBe(2);
    expect(payload.fbombTokens).toBe(1);
    cleanupCursorProfile(profile);
  }, 120000);
});
