import fs from "fs";
import os from "os";
import path from "path";
import {
  conversationIdFromKeyName,
  createGrokBotAdapter,
  decodeBlobKeyName,
  defaultGrokBotDataDir,
  doctorGrokBot,
  extractGrokBotRecords,
} from "../../../src/sentiment/adapters/grok-bot";
import { scanAdapter } from "../../../src/sentiment/scan";
import { runSentimentMeter } from "../../../src/sentiment/run";

const FIXTURE_ROOT = path.join(__dirname, "../../fixtures/sentiment/grok-bot");
const CONV_A = "11111111-2222-4333-8444-555555555555";
const CONV_B = "22222222-3333-4444-8555-666666666666";
const CONV_BAD = "33333333-4444-5555-8666-777777777777";

describe("Grok Bot blob-key decoding", () => {
  it("decodes lowercase base32 filenames back to storage keys", () => {
    expect(decodeBlobKeyName("jbswy3dp")).toBe("Hello");
    expect(decodeBlobKeyName("!!")).toBeUndefined();
  });

  it("extracts conversation ids only from transcript.replicas keys", () => {
    expect(conversationIdFromKeyName("sand.client.slice.transcript.replicas." + CONV_A)).toBe(CONV_A);
    expect(conversationIdFromKeyName("sand.client.slice.account.auth0|u.transcript.replicas." + CONV_A)).toBe(CONV_A);
    expect(conversationIdFromKeyName("sand.client.slice.ui-layout")).toBeUndefined();
    expect(conversationIdFromKeyName("sand.client.slice.transcript.replicas.")).toBeUndefined();
  });

  it("honors grokBotDataDir / homeDir overrides", () => {
    expect(defaultGrokBotDataDir({ grokBotDataDir: "/custom" })).toBe("/custom");
    expect(defaultGrokBotDataDir({ homeDir: "/fakehome" })).toBe(
      path.join("/fakehome", "Library", "Application Support", "Grok Bot"),
    );
  });
});

describe("Grok Bot discovery", () => {
  it("finds transcript replicas and skips non-transcript blobs and bad roots", () => {
    const adapter = createGrokBotAdapter();
    const discovery = adapter.discover([FIXTURE_ROOT]);
    expect(discovery.sessions.map((s) => s.sessionId).sort()).toEqual(
      [CONV_A, CONV_B, CONV_BAD].sort(),
    );
    expect(discovery.sessions.every((s) => s.source === "grok-bot")).toBe(true);

    const missing = adapter.discover(["/nonexistent/grok"]);
    expect(missing.sessions).toEqual([]);
    expect(missing.skipCounter.missingRoots).toHaveLength(1);
  });

  it("defaults to ~/Library/Application Support/Grok Bot", () => {
    expect(defaultGrokBotDataDir()).toBe(
      path.join(process.env.HOME || "", "Library", "Application Support", "Grok Bot"),
    );
  });
});

describe("Grok Bot human-message extraction", () => {
  it("counts plain and fromUser role=user entries, skips persona/bot/assistant output", async () => {
    const session = {
      source: "grok-bot" as const,
      sessionId: CONV_A,
      file: path.join(
        FIXTURE_ROOT,
        "sand-client-persistence",
        "onqw4zbomnwgszlooqxhg3djmnss45dsmfxhgy3snfyhiltsmvygy2ldmfzs4mjrgeytcmjrgewtemrsgiwtimztgmwtqnbugqwtknjvgu2tknjvgu2tkni.blob",
      ),
    };
    const { records, skipCounter } = await extractGrokBotRecords(session);
    const texts = records.map((r) => r.text);
    expect(texts).toEqual([
      "thanks, the scan finally finished clean",
      "ok fuck, the build broke again",
      "thanks from the phone, that fixed it",
    ]);
    // send-message persona output, fromAgent crew speech, assistant relays,
    // voice-call and event entries are all skipped without counters.
    expect(texts.join("\n")).not.toMatch(/Good morning|persona reply|Blunt answers|Summarizing|widget/i);
    // The empty-content entry is malformed and counted, never fatal.
    expect(skipCounter.malformedLines).toBe(1);
    expect(skipCounter.unknownRecords).toBe(0);
    expect(skipCounter.failedFiles).toEqual([]);
    // Attribution and timestamps: epoch ms normalized to RFC 3339 UTC.
    expect(records[0].sessionId).toBe(CONV_A);
    expect(records[0].recordId).toBe(`${CONV_A}:t0s0`);
    expect(records[0].projectPath).toBe("grok-bot");
    expect(records[0].timestamp).toBe("2026-10-01T12:10:00Z");
    expect(records[0].dedupKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips crew send-message authors in a crew conversation", async () => {
    const session = {
      source: "grok-bot" as const,
      sessionId: CONV_B,
      file: path.join(
        FIXTURE_ROOT,
        "sand-client-persistence",
        "onqw4zbomnwgszlooqxhg3djmnss45dsmfxhgy3snfyhiltsmvygy2ldmfzs4mrsgizdemrsgiwtgmztgmwtinbugqwtqnjvguwtmnrwgy3dmnrwgy3dmnq.blob",
      ),
    };
    const { records } = await extractGrokBotRecords(session);
    expect(records.map((r) => r.text)).toEqual([
      "thanks for the blunt numbers, team",
      "the pipeline lost rows again, fuck",
    ]);
    expect(records.every((r) => r.timestamp.startsWith("2026-10-02T"))).toBe(true);
  });

  it("unparseable blobs fail per-file without aborting the scan", async () => {
    const session = {
      source: "grok-bot" as const,
      sessionId: CONV_BAD,
      file: path.join(
        FIXTURE_ROOT,
        "sand-client-persistence",
        "onqw4zbomnwgszlooqxhg3djmnss45dsmfxhgy3snfyhiltsmvygy2ldmfzs4mztgmztgmztgmwtinbugqwtknjvguwtqnrwgywtonzxg43tonzxg43tony.blob",
      ),
    };
    await expect(extractGrokBotRecords(session)).rejects.toThrow(/unparseable blob JSON/);
    const result = await scanAdapter(createGrokBotAdapter(), [FIXTURE_ROOT]);
    expect(result.records).toHaveLength(5);
    expect(result.skipCounter.failedFiles).toHaveLength(1);
    expect(result.skipCounter.failedFiles[0].error).toContain("unparseable blob JSON");
  });
});

describe("Grok Bot dedup", () => {
  it("keeps per-conversation-local entry ids distinct across conversations", async () => {
    // Entry ids like t0s0/tbs0 repeat across conversations with different
    // content (pinned on the real corpus): the record id embeds the
    // conversation id so fork-like copies are never collapsed.
    const result = await scanAdapter(createGrokBotAdapter(), [FIXTURE_ROOT]);
    expect(result.records).toHaveLength(5);
    expect(result.stats).toEqual({ seen: 5, unique: 5, collapsed: 0 });
    const t0s0 = result.records.filter((r) => r.recordId.endsWith(":t0s0"));
    expect(t0s0).toHaveLength(2);
    expect(new Set(t0s0.map((r) => r.dedupKey)).size).toBe(2);
    expect(result.records.map((r) => r.text).join("\n")).not.toMatch(
      /Good morning|Charlie Munger|Scanner|persona/i,
    );
  });
});

describe("Grok Bot doctor", () => {
  it("counts blobs and reports missing roots", () => {
    const report = doctorGrokBot({ grokBotDataDir: FIXTURE_ROOT });
    expect(report.blobCount).toBe(4);
    expect(report.transcriptBlobCount).toBe(3);
    expect(report.issues).toEqual([]);
    const missing = doctorGrokBot({ grokBotDataDir: "/nonexistent" });
    expect(missing.issues.some((i) => i.includes("sand-client-persistence/ missing"))).toBe(true);
  });
});

describe("Grok Bot meter integration", () => {
  it("flows through runSentimentMeter with root overrides", async () => {
    const { report, scanResults } = await runSentimentMeter({
      window: "all",
      now: Date.parse("2026-10-02T12:30:00Z"),
      sources: ["grok-bot"],
      roots: { "grok-bot": [FIXTURE_ROOT] },
    });
    expect(scanResults).toHaveLength(1);
    expect(report.humanMessages).toBe(5);
    expect(report.thanksMessages).toBe(3);
    expect(report.fbombMessages).toBe(2);
    expect(report.perSource["grok-bot"]?.messages).toBe(5);
  });
});