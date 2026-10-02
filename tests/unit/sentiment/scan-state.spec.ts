import fs from "fs";
import os from "os";
import path from "path";
import {
  jsonlRescanRange,
  loadScanState,
  saveScanState,
  sqliteRescanFloor,
  updateScanWatermark,
} from "../../../src/sentiment/scan-state";

function fakeStats(size: number, mtimeMs: number): fs.Stats {
  return { size, mtimeMs } as fs.Stats;
}

describe("jsonlRescanRange", () => {
  it("reads everything without a watermark", () => {
    expect(jsonlRescanRange(undefined, fakeStats(100, 5))).toEqual({ fromLine: 0, readAll: true });
  });

  it("resumes at the recorded line for appended files", () => {
    const wm = { path: "/a.jsonl", size: 100, mtimeMs: 5, linesSeen: 7 };
    expect(jsonlRescanRange(wm, fakeStats(150, 6))).toEqual({ fromLine: 7, readAll: false });
  });

  it("fully rescans when the file shrank (identity change)", () => {
    const wm = { path: "/a.jsonl", size: 200, mtimeMs: 5, linesSeen: 7 };
    expect(jsonlRescanRange(wm, fakeStats(100, 6))).toEqual({ fromLine: 0, readAll: true });
  });

  it("reads nothing for an untouched file", () => {
    const wm = { path: "/a.jsonl", size: 100, mtimeMs: 5, linesSeen: 7 };
    expect(jsonlRescanRange(wm, fakeStats(100, 5))).toEqual({ fromLine: 7, readAll: false });
  });
});

describe("sqliteRescanFloor", () => {
  it("reads everything without a watermark", () => {
    expect(sqliteRescanFloor(undefined, fakeStats(100, 5)).readAll).toBe(true);
  });

  it("applies an overlap margin below the max seen createdAt", () => {
    const wm = { path: "/db", size: 100, mtimeMs: 5, maxSeenCreatedAt: 1_000_000 };
    const result = sqliteRescanFloor(wm, fakeStats(110, 6));
    expect(result.readAll).toBe(false);
    expect(result.floor).toBe(1_000_000 - 60_000);
  });

  it("fully rescans when the database shrank", () => {
    const wm = { path: "/db", size: 500, mtimeMs: 5, maxSeenCreatedAt: 1_000_000 };
    expect(sqliteRescanFloor(wm, fakeStats(100, 6)).readAll).toBe(true);
  });
});

describe("scan state persistence", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-state-"));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("survives save/load and never stores message text", () => {
    const state = loadScanState(cacheDir);
    updateScanWatermark(state, { path: "/x.jsonl", size: 12, mtimeMs: 3, linesSeen: 2 });
    saveScanState(cacheDir, state);
    const raw = fs.readFileSync(path.join(cacheDir, "scan-state.json"), "utf8");
    expect(raw).not.toContain("thanks");
    expect(loadScanState(cacheDir).watermarks["/x.jsonl"].linesSeen).toBe(2);
  });

  it("treats a corrupt state file as a full rescan", () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "scan-state.json"), "{not json");
    expect(loadScanState(cacheDir).watermarks).toEqual({});
  });
});
