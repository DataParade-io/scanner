import { humanMessageRecordSchema, normalizeTimestampToRfc3339Utc, parseTimestampToDate } from "../../../src/sentiment/record";

const SHA = "a".repeat(64);

function baseRecord() {
  return {
    source: "claude-code" as const,
    sessionId: "session-1",
    recordId: "record-1",
    projectPath: "/repo",
    timestamp: "2026-10-01T12:00:00Z",
    role: "human" as const,
    text: "thanks",
    dedupKey: SHA,
    provenance: { file: "x.jsonl", line: 3, key: "k" },
  };
}

describe("humanMessageRecordSchema", () => {
  it("accepts a fully populated human message record", () => {
    expect(humanMessageRecordSchema.parse(baseRecord())).toBeTruthy();
  });

  it("rejects non-sha256 dedup keys", () => {
    expect(() =>
      humanMessageRecordSchema.parse({ ...baseRecord(), dedupKey: "nothex" }),
    ).toThrow();
  });

  it("rejects timestamps that are not RFC 3339 UTC", () => {
    expect(() =>
      humanMessageRecordSchema.parse({ ...baseRecord(), timestamp: "2026-10-01 12:00:00" }),
    ).toThrow();
    expect(() =>
      humanMessageRecordSchema.parse({ ...baseRecord(), timestamp: "1727784000000" }),
    ).toThrow();
  });

  it("rejects roles other than human", () => {
    expect(() =>
      humanMessageRecordSchema.parse({ ...baseRecord(), role: "assistant" }),
    ).toThrow();
  });

  it("accepts every reserved source value", () => {
    for (const source of ["claude-code", "cursor-ide", "cursor-agent", "codex", "grok-bot"]) {
      expect(humanMessageRecordSchema.parse({ ...baseRecord(), source })).toBeTruthy();
    }
  });
});

describe("timestamp normalization", () => {
  it("normalizes ISO-8601 with Z (Claude Code style)", () => {
    expect(normalizeTimestampToRfc3339Utc("2026-10-01T12:00:00.123Z")).toBe(
      "2026-10-01T12:00:00.123Z",
    );
  });

  it("normalizes epoch milliseconds (Cursor style)", () => {
    expect(normalizeTimestampToRfc3339Utc(1727784000123)).toBe(
      "2024-10-01T12:00:00.123Z",
    );
  });

  it("normalizes RFC 3339 with milliseconds and offsets (Codex style)", () => {
    expect(normalizeTimestampToRfc3339Utc("2026-10-01T05:00:00.500-07:00")).toBe(
      "2026-10-01T12:00:00.500Z",
    );
  });

  it("treats timestamp-less naive strings as UTC", () => {
    expect(normalizeTimestampToRfc3339Utc("2026-10-01T12:00:00")).toBe(
      "2026-10-01T12:00:00Z",
    );
  });

  it("round-trips through Date without losing millisecond precision", () => {
    const date = parseTimestampToDate(1727784000123);
    expect(date.getTime()).toBe(1727784000123);
  });

  it("throws on garbage timestamps", () => {
    expect(() => normalizeTimestampToRfc3339Utc("not-a-date")).toThrow();
  });
});
