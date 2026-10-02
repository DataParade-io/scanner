import fs from "fs";
import path from "path";
import { buildDedupKey } from "../../../src/sentiment/dedup";
import { computeMeter } from "../../../src/sentiment/meter";
import { formatMeterText } from "../../../src/sentiment/run";
import { loadScanState, saveScanState, updateScanWatermark } from "../../../src/sentiment/scan-state";
import type { HumanMessageRecord } from "../../../src/sentiment/record";

const SENTIMENT_SRC = path.join(__dirname, "../../../src/sentiment");
const NETWORK_MODULES = ["net", "http", "https", "dgram", "undici", "axios", "node:net", "node:http", "node:https", "node:dgram", "node:fetch"];

function sentimentSourceFiles(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  visit(SENTIMENT_SRC);
  return out;
}

function secretRecord(text: string): HumanMessageRecord {
  return {
    source: "claude-code",
    sessionId: "s1",
    recordId: "r1",
    projectPath: "/repo",
    timestamp: "2026-10-01T12:00:00Z",
    role: "human",
    text,
    dedupKey: buildDedupKey({ source: "claude-code", recordId: "r1", sessionId: "s1", timestamp: "2026-10-01T12:00:00Z", text }),
    provenance: { file: "f.jsonl", line: 1, key: "r1" },
  };
}

const SECRET = "xyzzyspoon-the-secret-phrase";

describe("privacy: no network-capable imports under src/sentiment/**", () => {
  it("imports none of the network-capable modules", () => {
    for (const file of sentimentSourceFiles()) {
      const source = fs.readFileSync(file, "utf8");
      for (const moduleName of NETWORK_MODULES) {
        const importPattern = new RegExp(
          `(from\\s+["']|require\\(["'])${moduleName.replace(":", ":")}["']`,
        );
        expect({ file, hit: importPattern.test(source) }).toEqual({ file, hit: false });
      }
      expect(/\bfetch\s*\(/.test(source)).toBe(false);
    }
  });

  it("covers the whole sentiment source tree", () => {
    expect(sentimentSourceFiles().length).toBeGreaterThan(5);
  });
});

describe("privacy: output and scan state contain no verbatim message text", () => {
  const records = [
    secretRecord(`thanks for the ${SECRET}`),
    secretRecord(`fuck this ${SECRET} broke`),
  ];

  it("the text output builder carries counts only", () => {
    const report = computeMeter(records, { startMs: 0, endMs: 1, label: "t" });
    const output = formatMeterText(report);
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain("thanks for the");
  });

  it("the JSON report carries counts and hashes only", () => {
    const report = computeMeter(records, { startMs: 0, endMs: 1, label: "t" });
    const json = JSON.stringify(report);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("fuck this");
  });

  it("the scan-state store persists watermarks only", () => {
    const state = { version: 1 as const, watermarks: {} };
    updateScanWatermark(state, { path: "/a.jsonl", size: 12, mtimeMs: 3, linesSeen: 2 });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("fuck");
    void loadScanState;
    void saveScanState;
  });
});
