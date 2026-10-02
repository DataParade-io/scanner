import assert from "node:assert";
import { Given, When, Then } from "@cucumber/cucumber";
import { buildDedupKey, dedupeRecords } from "../../src/sentiment/dedup";
import type { HumanMessageRecord } from "../../src/sentiment/record";
import { meterOverRecords } from "../../src/sentiment/meter";
import { formatMeterText } from "../../src/sentiment/run";
import type { MeterReport } from "../../src/sentiment/meter";

interface MeterWorld {
  records: HumanMessageRecord[];
  windowKind: "last-24h" | "today" | "yesterday" | "all";
  reports: Record<string, MeterReport>;
  textOutput?: string;
  excludedSeen?: boolean;
}

function getWorld(context: unknown): MeterWorld {
  return context as MeterWorld;
}

let seq = 0;
function makeRecord(
  text: string,
  timestamp: string,
  sessionId = "s1",
  recordId?: string,
): HumanMessageRecord {
  seq += 1;
  const id = recordId ?? `r${seq}`;
  return {
    source: "claude-code",
    sessionId,
    recordId: id,
    projectPath: "/repo",
    timestamp,
    role: "human",
    text,
    dedupKey: buildDedupKey({ source: "claude-code", recordId: id, sessionId, timestamp, text }),
    provenance: { file: "f.jsonl", line: seq, key: id },
  };
}

const NOW = new Date("2026-10-02T12:00:00Z").getTime();

Given("a human message {string} in the last day", function (text: string) {
  const w = getWorld(this);
  w.records = [makeRecord(text, new Date(NOW - 3600_000).toISOString())];
});

Given("a human message that is a 2500-character pasted log containing an F-bomb", function () {
  const w = getWorld(this);
  const lines = Array.from({ length: 12 }, (_, i) => `fuck ERROR at line ${i}: ${"x".repeat(180)}`);
  w.records = [makeRecord(lines.join("\n"), new Date(NOW - 3600_000).toISOString())];
});

Given("a human message at 03:59 local time today with day-start 04:00", function () {
  const w = getWorld(this);
  // 03:59 America/Los_Angeles on 2026-10-02 = 10:59 UTC.
  w.records = [makeRecord("thanks", "2026-10-02T10:59:00Z")];
});

Given("a human message 23 hours ago", function () {
  const w = getWorld(this);
  w.records = [makeRecord("thanks", new Date(NOW - 23 * 3600_000).toISOString())];
});

Given("a human message 25 hours ago", function () {
  const w = getWorld(this) as MeterWorld & { extra?: HumanMessageRecord[] };
  w.extra = [makeRecord("thanks", new Date(NOW - 25 * 3600_000).toISOString())];
});

Given("the same human message in a session and its forked copy", function () {
  const w = getWorld(this);
  const original = makeRecord("thanks", "2026-10-01T12:00:00Z", "session-a", "shared-uuid");
  const fork = makeRecord("thanks", "2026-10-01T12:00:00Z", "session-b", "shared-uuid");
  w.records = [original, fork];
});

When("I compute the meter over the last-24h window", async function () {
  await computeInto(this, "last-24h");
});

When("I compute the meter over the today window", async function () {
  await computeInto(this, "today");
});

When("I compute the meter over the yesterday window", async function () {
  await computeInto(this, "yesterday");
});

When("I compute the meter over the all window", async function () {
  await computeInto(this, "all");
});

async function computeInto(context: unknown, kind: "last-24h" | "today" | "yesterday" | "all"): Promise<void> {
  const w = getWorld(context);
  w.windowKind = kind;
  const records = [...(w.records ?? []), ...((w as MeterWorld & { extra?: HumanMessageRecord[] }).extra ?? [])];
  const deduped = dedupeRecords(records).records;
  const { meterOverRecords } = await import("../../src/sentiment/meter");
  const dayStart = kind === "today" || kind === "yesterday" ? "04:00" : "00:00";
  const report = meterOverRecords(deduped, {
    window: kind,
    now: NOW,
    timezone: "America/Los_Angeles",
    dayStart,
  });
  w.reports = w.reports ?? {};
  w.reports[kind] = report;
  w.excludedSeen = report.excludedMessages > 0;
}

Then("the thanks count is {int}", function (count: number) {
  const w = getWorld(this);
  assert.equal(w.reports[w.windowKind].thanksTokens, count);
});

Then("the F-bomb count is {int}", function (count: number) {
  const w = getWorld(this);
  assert.equal(w.reports[w.windowKind].fbombTokens, count);
});

Then("the band is {string}", function (band: string) {
  const w = getWorld(this);
  assert.equal(w.reports[w.windowKind].band, band);
});

Then("the message is excluded", function () {
  const w = getWorld(this);
  assert.ok((w.reports[w.windowKind]?.excludedMessages ?? 0) >= 1);
});

When("I format the meter as text", function () {
  const w = getWorld(this);
  const report = w.reports?.["last-24h"] ?? computeDirect(w.records ?? [], "last-24h");
  w.reports = { ...(w.reports ?? {}), "last-24h": report };
  w.textOutput = formatMeterText(report);
});

function computeDirect(records: HumanMessageRecord[], kind: "last-24h" | "today" | "yesterday" | "all"): MeterReport {
  const deduped = dedupeRecords(records).records;
  const dayStart = kind === "today" || kind === "yesterday" ? "04:00" : "00:00";
  return meterOverRecords(deduped, {
    window: kind,
    now: NOW,
    timezone: "America/Los_Angeles",
    dayStart,
  });
}

Then("the output contains {string}", function (snippet: string) {
  const w = getWorld(this);
  assert.ok(w.textOutput?.includes(snippet), `expected output to contain ${snippet}: ${w.textOutput}`);
});

Then("the output does not contain {string}", function (snippet: string) {
  const w = getWorld(this);
  assert.ok(!w.textOutput?.includes(snippet), "output leaked message text");
});
