import { computeMeter, DEFAULT_METER_BANDS, gaugeBar, meterOverRecords } from "../../../src/sentiment/meter";
import type { HumanMessageRecord } from "../../../src/sentiment/record";
import { buildDedupKey } from "../../../src/sentiment/dedup";

let seq = 0;
function rec(text: string, source: HumanMessageRecord["source"] = "claude-code", sessionId = "s1", timestamp = "2026-10-01T12:00:00Z"): HumanMessageRecord {
  seq += 1;
  return {
    source,
    sessionId,
    recordId: `r${seq}`,
    projectPath: "/repo",
    timestamp,
    role: "human",
    text,
    dedupKey: buildDedupKey({ source, recordId: `r${seq}`, sessionId, timestamp, text }),
    provenance: { file: "f", line: seq, key: `r${seq}` },
  };
}

const now = Date.UTC(2026, 9, 2, 12, 0, 0);

describe("computeMeter", () => {
  it("aggregates token counts, message-level counts, and per-source breakdown", () => {
    const report = computeMeter(
      [
        rec("thanks"),
        rec("thanks, fuck", "claude-code", "s2"),
        rec("hello world", "codex", "s3"),
      ],
      { startMs: 0, endMs: now + 1, label: "test" },
    );
    expect(report.thanksTokens).toBe(2);
    expect(report.fbombTokens).toBe(1);
    expect(report.thanksMessages).toBe(2);
    expect(report.fbombMessages).toBe(1);
    expect(report.humanMessages).toBe(3);
    expect(report.sessionsScanned).toBe(3);
    expect(report.perSource["claude-code"].messages).toBe(2);
    expect(report.perSource["codex"].messages).toBe(1);
    expect(report.perSource["codex"].sessions).toBe(1);
    expect(report.messagesScanned).toBe(3);
  });

  it("computes the gauge as thanks / (thanks + F-bombs) on token counts", () => {
    const report = computeMeter([rec("thanks"), rec("thanks again"), rec("fuck")], {
      startMs: 0,
      endMs: now + 1,
      label: "test",
    });
    expect(report.gauge).toBeCloseTo(2 / 3);
    expect(report.band).toBe("mixed");
  });

  it("bands at the configured thresholds", () => {
    const bands = DEFAULT_METER_BANDS;
    const grateful = computeMeter([rec("thanks"), rec("thanks"), rec("thanks"), rec("fuck")], { startMs: 0, endMs: 1, label: "t" }, { bands });
    expect(grateful.band).toBe("mostly grateful"); // 0.75
    const cursing = computeMeter([rec("fuck"), rec("fuck"), rec("fuck"), rec("thanks")], { startMs: 0, endMs: 1, label: "t" });
    expect(cursing.band).toBe("cursing at the machine"); // 0.25
    void bands;
  });

  it("is quiet when there are no human messages", () => {
    const report = computeMeter([], { startMs: 0, endMs: 1, label: "t" });
    expect(report.gauge).toBeNull();
    expect(report.band).toBe("quiet");
  });

  it("is deterministic", () => {
    const records = [rec("thanks, fuck"), rec("meh")];
    expect(computeMeter(records, { startMs: 0, endMs: 1, label: "t" })).toEqual(
      computeMeter(records, { startMs: 0, endMs: 1, label: "t" }),
    );
  });

  it("includes the window label", () => {
    const report = computeMeter([], { startMs: 0, endMs: 1, label: "today 00:00-00:00 UTC" });
    expect(report.window.label).toBe("today 00:00-00:00 UTC");
  });
});

describe("gaugeBar", () => {
  it("renders a bar and a quiet state", () => {
    expect(gaugeBar(0.8)).toContain("80%");
    expect(gaugeBar(null)).toContain("quiet");
  });
});

describe("meterOverRecords", () => {
  it("filters records into the resolved window before counting", () => {
    const inside = rec("thanks", "claude-code", "s1", "2026-10-02T10:00:00Z");
    const outside = rec("fuck", "claude-code", "s1", "2026-10-01T02:00:00Z");
    const report = meterOverRecords([inside, outside], {
      window: "today",
      now,
      timezone: "UTC",
    });
    expect(report.humanMessages).toBe(1);
    expect(report.thanksTokens).toBe(1);
    expect(report.fbombTokens).toBe(0);
  });
});
