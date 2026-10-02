import fs from "fs";
import os from "os";
import path from "path";
import {
  buildDedupKey,
  dedupeRecords,
} from "../../../src/sentiment/dedup";
import { createSkipCounter, parseRecordOrSkip } from "../../../src/sentiment/adapter";
import type { HumanMessageRecord } from "../../../src/sentiment/record";
import {
  loadScanState,
  saveScanState,
  updateScanWatermark,
} from "../../../src/sentiment/scan-state";

function record(overrides: Partial<HumanMessageRecord> = {}): HumanMessageRecord {
  return {
    source: "claude-code",
    sessionId: "s1",
    recordId: "r1",
    projectPath: "/repo",
    timestamp: "2026-10-01T12:00:00Z",
    role: "human",
    text: "thanks",
    dedupKey: "a".repeat(64),
    provenance: { file: "f.jsonl", line: 1, key: "k" },
    ...overrides,
  };
}

describe("buildDedupKey", () => {
  it("hashes source plus recordId when a stable native id exists", () => {
    const key = buildDedupKey({ source: "claude-code", recordId: "u1", sessionId: "s", timestamp: "t", text: "x" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(
      buildDedupKey({ source: "claude-code", recordId: "u1", sessionId: "other", timestamp: "z", text: "y" }),
    );
  });

  it("falls back to the content tuple without a native id", () => {
    const key = buildDedupKey({ source: "codex", sessionId: "s", timestamp: "t", text: "hello" });
    expect(key).toBe(
      buildDedupKey({ source: "codex", sessionId: "s", timestamp: "t", text: "hello" }),
    );
    expect(key).not.toBe(
      buildDedupKey({ source: "codex", sessionId: "s", timestamp: "t", text: "hello!" }),
    );
  });

  it("keeps different sources distinct even with the same native id", () => {
    const a = buildDedupKey({ source: "codex", recordId: "u1", sessionId: "s", timestamp: "t", text: "x" });
    const b = buildDedupKey({ source: "claude-code", recordId: "u1", sessionId: "s", timestamp: "t", text: "x" });
    expect(a).not.toBe(b);
  });
});

describe("dedupeRecords", () => {
  it("collapses identical records across copies and orders by timestamp", () => {
    const keyFor = (recordId: string) =>
      buildDedupKey({ source: "claude-code", recordId, sessionId: "s1", timestamp: "t", text: "x" });
    const copyA = record({ recordId: "r1", dedupKey: keyFor("r1"), timestamp: "2026-10-01T12:00:00Z", provenance: { file: "active.jsonl", line: 1, key: "k" } });
    const copyB = record({ recordId: "r1", dedupKey: keyFor("r1"), timestamp: "2026-10-01T12:00:00Z", provenance: { file: "archive.jsonl", line: 9, key: "k" } });
    const earlier = record({ recordId: "r0", dedupKey: keyFor("r0"), timestamp: "2026-10-01T11:00:00Z" });
    const result = dedupeRecords([copyA, copyB, earlier]);
    expect(result.records.map((r) => r.recordId)).toEqual(["r0", "r1"]);
    expect(result.stats).toEqual({ seen: 3, unique: 2, collapsed: 1 });
  });

  it("keeps records distinct when text differs without native ids", () => {
    const a = record({ recordId: "", dedupKey: buildDedupKey({ source: "c", sessionId: "s", timestamp: "t", text: "one" }) });
    const b = record({ recordId: "", dedupKey: buildDedupKey({ source: "c", sessionId: "s", timestamp: "t", text: "two" }) });
    expect(dedupeRecords([a, b]).stats.unique).toBe(2);
  });
});

describe("skip-with-counter failure policy", () => {
  it("counts malformed records instead of throwing", () => {
    const counter = createSkipCounter();
    expect(parseRecordOrSkip({ broken: true }, counter)).toBeUndefined();
    expect(counter.malformedLines).toBe(1);
  });

  it("accepts a valid record untouched", () => {
    const counter = createSkipCounter();
    expect(parseRecordOrSkip(record(), counter)?.text).toBe("thanks");
    expect(counter.malformedLines).toBe(0);
  });
});

describe("scan-state store", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-scan-state-"));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("round-trips watermarks and defaults to empty state", () => {
    const empty = loadScanState(cacheDir);
    expect(empty.watermarks).toEqual({});
    const state = { version: 1 as const, watermarks: {} };
    updateScanWatermark(state, { path: "/a.jsonl", size: 10, mtimeMs: 1, linesSeen: 4 });
    saveScanState(cacheDir, state);
    const loaded = loadScanState(cacheDir);
    expect(loaded.watermarks["/a.jsonl"]).toMatchObject({ size: 10, linesSeen: 4 });
  });

  it("persists fingerprints and counts only, never message text", () => {
    const state = { version: 1 as const, watermarks: {} };
    updateScanWatermark(state, { path: "/a.jsonl", size: 10, mtimeMs: 1, linesSeen: 4 });
    saveScanState(cacheDir, state);
    const raw = fs.readFileSync(path.join(cacheDir, "scan-state.json"), "utf8");
    expect(raw).not.toContain("thanks");
    expect(loadScanState(cacheDir)).toBeDefined();
  });
});
