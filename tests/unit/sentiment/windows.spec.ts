import { parseDayStart, parseWindowSpec, isInWindow, resolveWindow } from "../../../src/sentiment/windows";
import { parseTimestampToDate } from "../../../src/sentiment/record";

const HOUR = 3_600_000;

describe("parseWindowSpec", () => {
  it("parses rolling and calendar specs", () => {
    expect(parseWindowSpec("today")).toBe("today");
    expect(parseWindowSpec("yesterday")).toBe("yesterday");
    expect(parseWindowSpec("last-24h")).toBe("last-24h");
    expect(parseWindowSpec("all")).toBe("all");
    expect(parseWindowSpec("6h")).toEqual({ kind: "hours", hours: 6 });
    expect(parseWindowSpec("3d")).toEqual({ kind: "days", days: 3 });
  });

  it("rejects unknown specs", () => {
    expect(() => parseWindowSpec("fortnight")).toThrow(/invalid window spec/);
    expect(() => parseWindowSpec("4w")).toThrow(/invalid window spec/);
  });
});

describe("parseDayStart", () => {
  it("parses HH:MM and rejects garbage", () => {
    expect(parseDayStart("04:00")).toEqual({ hours: 4, minutes: 0 });
    expect(parseDayStart("23:30")).toEqual({ hours: 23, minutes: 30 });
    expect(() => parseDayStart("25:00")).toThrow(/invalid day-start/);
    expect(() => parseDayStart("4am")).toThrow(/invalid day-start/);
  });
});

describe("resolveWindow — UTC", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);

  it("resolves today at day-start 00:00", () => {
    const w = resolveWindow("today", now, "UTC");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 2, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 9, 3, 0, 0, 0));
    expect(w.label).toBe("today 00:00-00:00 UTC");
  });

  it("resolves yesterday at day-start 00:00", () => {
    const w = resolveWindow("yesterday", now, "UTC");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 1, 0, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 9, 2, 0, 0, 0));
  });

  it("moves the calendar anchor with day-start 04:00", () => {
    const w = resolveWindow("today", now, "UTC", "04:00");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 2, 4, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 9, 3, 4, 0, 0));
  });
});

describe("resolveWindow — day-start boundary semantics", () => {
  // 2026-10-02 11:59 UTC; in America/Los_Angeles (UTC-7) that is 04:59.
  const now = Date.UTC(2026, 9, 2, 11, 59, 0);

  it("assigns a 03:59 message to yesterday when day-start is 04:00", () => {
    const w = resolveWindow("today", now, "America/Los_Angeles", "04:00");
    // 03:59 local = 10:59 UTC on Oct 2.
    expect(isInWindow(Date.UTC(2026, 9, 2, 10, 59, 0), w)).toBe(false);
    const yesterday = resolveWindow("yesterday", now, "America/Los_Angeles", "04:00");
    expect(isInWindow(Date.UTC(2026, 9, 2, 10, 59, 0), yesterday)).toBe(true);
  });

  it("assigns a 04:00:00 message to today when day-start is 04:00", () => {
    const w = resolveWindow("today", now, "America/Los_Angeles", "04:00");
    expect(isInWindow(Date.UTC(2026, 9, 2, 11, 0, 0), w)).toBe(true);
  });

  it("is start-inclusive and end-exclusive", () => {
    const w = resolveWindow("today", now, "UTC", "00:00");
    expect(isInWindow(w.startMs, w)).toBe(true);
    expect(isInWindow(w.endMs, w)).toBe(false);
    expect(isInWindow(w.endMs - 1, w)).toBe(true);
  });
});

describe("resolveWindow — America/Los_Angeles DST", () => {
  const tz = "America/Los_Angeles";

  it("gives a 23-hour day on the 2026-03-08 spring-forward date", () => {
    const now = Date.UTC(2026, 2, 8, 20, 0, 0); // 13:00 PDT, still Mar 8 local
    const w = resolveWindow("today", now, tz, "00:00");
    expect(w.endMs - w.startMs).toBe(23 * HOUR);
  });

  it("gives a 25-hour day on the 2026-11-01 fall-back date", () => {
    const now = Date.UTC(2026, 10, 1, 20, 0, 0); // 12:00 PST, still Nov 1 local
    const w = resolveWindow("today", now, tz, "00:00");
    expect(w.endMs - w.startMs).toBe(25 * HOUR);
  });

  it("clamps a spring-forward gap wall time forward (02:30 does not exist)", () => {
    const now = Date.UTC(2026, 2, 8, 12, 0, 0);
    const w = resolveWindow("today", now, tz, "02:30");
    // 2026-03-08 02:30 PST is skipped; clamp forward to 03:00 PDT = 10:00 UTC.
    expect(w.startMs).toBe(Date.UTC(2026, 2, 8, 10, 0, 0));
  });

  it("resolves fall-back ambiguity to the earlier instant (01:30 occurs twice)", () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const w = resolveWindow("today", now, tz, "01:30");
    // Earlier 01:30 is PDT (UTC-7) = 08:30 UTC.
    expect(w.startMs).toBe(Date.UTC(2026, 10, 1, 8, 30, 0));
  });

  it("handles a rolling 24h window crossing a DST change deterministically", () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const w = resolveWindow("last-24h", now, tz);
    expect(w.endMs - w.startMs).toBe(24 * HOUR);
    expect(w.startMs).toBe(Date.UTC(2026, 10, 1, 12, 0, 0) - 24 * HOUR);
  });
});

describe("resolveWindow — other zones", () => {
  it("resolves Asia/Tokyo calendar days", () => {
    const now = Date.UTC(2026, 9, 2, 15, 0, 0); // 2026-10-03 00:00 JST
    const w = resolveWindow("today", now, "Asia/Tokyo");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 2, 15, 0, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 9, 3, 15, 0, 0));
  });

  it("resolves Australia/Lord_Howe with its half-hour offset", () => {
    const now = Date.UTC(2026, 9, 2, 3, 0, 0); // 2026-10-02 13:30 LHST (+10:30, DST ends Oct 4)
    const w = resolveWindow("today", now, "Australia/Lord_Howe");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 1, 13, 30, 0)); // 00:00 +10:30
    expect(w.endMs).toBe(Date.UTC(2026, 9, 2, 13, 30, 0));
  });

  it("supports day-start 23:30", () => {
    const now = Date.UTC(2026, 9, 2, 12, 0, 0);
    const w = resolveWindow("today", now, "UTC", "23:30");
    expect(w.startMs).toBe(Date.UTC(2026, 9, 2, 23, 30, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 9, 3, 23, 30, 0));
  });
});

describe("resolveWindow — rolling and absolute", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);

  it("resolves rolling windows relative to now, ignoring timezone", () => {
    const utc = resolveWindow("last-24h", now, "UTC");
    const tokyo = resolveWindow("last-24h", now, "Asia/Tokyo");
    expect(utc.startMs).toBe(tokyo.startMs);
    expect(utc.endMs).toBe(tokyo.endMs);
  });

  it("resolves Nh and Nd windows", () => {
    expect(resolveWindow("6h", now, "UTC").startMs).toBe(now - 6 * HOUR);
    expect(resolveWindow("3d", now, "UTC").startMs).toBe(now - 3 * 24 * HOUR);
  });

  it("resolves all", () => {
    const w = resolveWindow("all", now, "UTC");
    expect(w.startMs).toBe(0);
    expect(w.label).toBe("all time");
  });

  it("absolute since/until override the spec", () => {
    const w = resolveWindow("today", now, "UTC", "00:00", {
      since: "2026-09-01T00:00:00Z",
      until: "2026-09-15T00:00:00Z",
    });
    expect(w.startMs).toBe(Date.UTC(2026, 8, 1));
    expect(w.endMs).toBe(Date.UTC(2026, 8, 15));
    expect(w.label).toContain("since 2026-09-01T00:00:00Z");
  });

  it("fails fast on invalid IANA timezones", () => {
    expect(() => resolveWindow("today", now, "Mars/Olympus")).toThrow(/invalid IANA timezone/);
  });
});

describe("per-source timestamp parsing feeding the window filter", () => {
  it("filters epoch-ms, ISO-Z, and RFC3339+ms records through one window", () => {
    const now = Date.UTC(2026, 9, 2, 12, 0, 0);
    const w = resolveWindow("today", now, "UTC");
    const stamps = [
      parseTimestampToDate("2026-10-02T08:00:00.000Z"), // Claude Code ISO-Z
      parseTimestampToDate(Date.UTC(2026, 9, 2, 9, 0, 0)), // Cursor epoch ms
      parseTimestampToDate("2026-10-02T10:30:00.500Z"), // Codex RFC3339+ms
      parseTimestampToDate("2026-10-01T23:59:59.000Z"), // before window
    ];
    const inWindow = stamps.filter((d) => isInWindow(d.getTime(), w));
    expect(inWindow).toHaveLength(3);
  });
});
