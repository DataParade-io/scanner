import { computeMeter, DEFAULT_METER_BANDS, gaugeBar, meterOverRecords } from "../../../src/sentiment/meter";
import type { HumanMessageRecord } from "../../../src/sentiment/record";
import { buildDedupKey } from "../../../src/sentiment/dedup";
import { createVaderBackend } from "../../../src/sentiment/sentiment-classifier";

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
    // Two records in the same session count as one scanned session.
    const sharedSession = computeMeter(
      [rec("thanks", "claude-code", "s9"), rec("fuck", "claude-code", "s9")],
      { startMs: 0, endMs: now + 1, label: "test" },
    );
    expect(sharedSession.sessionsScanned).toBe(1);
    expect(sharedSession.messagesScanned).toBe(2);
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

describe("computeMeter with a sentiment backend", () => {
  const win = { startMs: 0, endMs: now + 1, label: "test" };
  const vader = createVaderBackend();

  it("aggregates mean compound and pos/neu/neg counts overall and per source", () => {
    const texts = [
      "this works great, thanks",
      "kill the stale worker process",
      "I hate this, it sucks",
    ];
    const report = computeMeter(
      texts.map((text, i) => rec(text, i === 2 ? "codex" : "claude-code", `s${i}`)),
      win,
      { sentimentBackend: vader },
    );
    const overall = report.sentiment!;
    expect(overall.backend).toBe("vader");
    expect(overall.scoredMessages).toBe(3);
    expect(overall.pos).toBe(1);
    expect(overall.neu).toBe(1);
    expect(overall.neg).toBe(1);
    const expectedMean =
      texts.reduce((sum, text) => sum + vader.scoreMessage(text)!.compound, 0) / 3;
    expect(overall.meanCompound).toBeCloseTo(expectedMean, 10);

    const claude = report.perSource["claude-code"].sentiment!;
    expect(claude.scoredMessages).toBe(2);
    expect(claude.neg).toBe(0);
    expect(claude.neu).toBe(1);
    const codex = report.perSource["codex"].sentiment!;
    expect(codex.scoredMessages).toBe(1);
    expect(codex.neg).toBe(1);
  });

  it("skips fully excluded messages from the scored set", () => {
    const report = computeMeter(
      [rec("thanks a lot"), rec("```\nkill -9 1\n```")],
      win,
      { sentimentBackend: vader },
    );
    expect(report.sentiment!.scoredMessages).toBe(1);
    expect(report.sentiment!.pos).toBe(1);
  });

  it("reports a zero-scored aggregate with null mean", () => {
    const report = computeMeter([rec("```\nrm -rf /\n```")], win, {
      sentimentBackend: vader,
    });
    expect(report.sentiment!.scoredMessages).toBe(0);
    expect(report.sentiment!.meanCompound).toBeNull();
  });

  it("omits sentiment fields without a backend", () => {
    const report = computeMeter([rec("thanks")], win);
    expect(report.sentiment).toBeUndefined();
    expect(report.perSource["claude-code"].sentiment).toBeUndefined();
  });

  it("accepts a backend name in meterOverRecords", () => {
    const report = meterOverRecords(
      [rec("works perfectly, thanks", "claude-code", "s1", "2026-10-02T10:00:00Z")],
      {
        window: "today",
        now,
        timezone: "UTC",
        sentimentBackend: "vader",
      },
    );
    expect(report.sentiment!.backend).toBe("vader");
    expect(report.sentiment!.pos).toBe(1);
  });
});
