import path from "path";
import {
  agentPayload,
  artifactAttachPayload,
  cleanupAntigravityProfile,
  generateAntigravityProfile,
  userTurnPayload,
} from "../../unit/sentiment/helpers/antigravity-fixture";
import type { FixtureConversation } from "../../unit/sentiment/helpers/antigravity-fixture";
import {
  antigravityStepTimestampMs,
  antigravityUserText,
  createAntigravityAdapter,
  defaultAntigravityRoots,
  doctorAntigravity,
  extractAntigravityRecords,
  isArtifactAttachStep,
} from "../../../src/sentiment/adapters/antigravity";
import { scanAdapter } from "../../../src/sentiment/scan";
import { runSentimentMeter } from "../../../src/sentiment/run";

const T0 = Date.parse("2026-10-01T12:00:00Z");

const CONV_A: FixtureConversation = {
  conversationId: "aaaaaaaa-0000-4000-8000-000000000001",
  workspaceUris: "file:///Users/ryan/demo",
  steps: [
    { stepType: 14, payload: userTurnPayload({ text: "thanks, that build finally passed", timestampMs: T0 }) },
    { stepType: 15, payload: agentPayload({ marker: "agent narration", timestampMs: T0 + 1000 }) },
    { stepType: 132, payload: agentPayload({ marker: "run_command", timestampMs: T0 + 2000 }) },
    { stepType: 14, payload: userTurnPayload({ text: "ok fuck, the types broke again", timestampMs: T0 + 3000 }) },
    { stepType: 14, payload: artifactAttachPayload({ uri: "file:///tmp/implementation_plan.md", timestampMs: T0 + 4000 }) },
    { stepType: 23, payload: agentPayload({ marker: "summary", timestampMs: T0 + 5000 }) },
  ],
  malformedPayload: Buffer.from([0xff, 0xff, 0xff]),
};

const CONV_B_NESTED: FixtureConversation = {
  conversationId: "bbbbbbbb-0000-4000-8000-000000000002",
  parentConversationId: "aaaaaaaa-0000-4000-8000-000000000001",
  steps: [
    { stepType: 14, payload: userTurnPayload({ text: "You are tasked with Kanbus issue abc: fix the thing", timestampMs: T0 + 6000 }) },
  ],
};

const CONV_C_CLI: FixtureConversation = {
  conversationId: "cccccccc-0000-4000-8000-000000000003",
  steps: [
    { stepType: 14, payload: userTurnPayload({ text: "wtf, the cache ate my changes", timestampMs: T0 + 7000 }) },
  ],
};

describe("Antigravity payload decoding", () => {
  it("reads the user text, artifact-attach marker, and timestamp", () => {
    const payload = userTurnPayload({ text: "hello world", timestampMs: 1790856000123 });
    expect(antigravityUserText(payload)).toBe("hello world");
    expect(isArtifactAttachStep(payload)).toBe(false);
    expect(antigravityStepTimestampMs(payload)).toBe(1790856000123);

    const attach = artifactAttachPayload({ uri: "file:///tmp/plan.md", timestampMs: T0 });
    expect(antigravityUserText(attach)).toBeUndefined();
    expect(isArtifactAttachStep(attach)).toBe(true);
    expect(antigravityUserText(Buffer.from([0xff, 0x01]))).toBeUndefined();
  });
});

describe("Antigravity discovery", () => {
  it("finds top-level conversations in both roots, skips nested ones, and decodes project paths", () => {
    const profile = generateAntigravityProfile([CONV_A, CONV_B_NESTED], [CONV_C_CLI]);
    try {
      const adapter = createAntigravityAdapter({ antigravityHome: profile.home });
      const discovery = adapter.discover();
      const sessions = discovery.sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
      expect(sessions.map((s) => s.sessionId)).toEqual([CONV_A.conversationId, CONV_C_CLI.conversationId]);
      expect(sessions.every((s) => s.source === "antigravity")).toBe(true);
      const desktop = sessions.find((s) => s.sessionId === CONV_A.conversationId);
      expect(desktop?.projectPath).toBe("/Users/ryan/demo");
      const cli = sessions.find((s) => s.sessionId === CONV_C_CLI.conversationId);
      expect(cli?.projectPath).toBe("antigravity");

      const missing = adapter.discover(["/nonexistent/antigravity"]);
      expect(missing.sessions).toEqual([]);
      expect(missing.skipCounter.missingRoots).toHaveLength(1);
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });

  it("honors home and root overrides", () => {
    expect(defaultAntigravityRoots({ antigravityHome: "/custom/gemini" })).toEqual([
      path.join("/custom/gemini", "antigravity"),
      path.join("/custom/gemini", "antigravity-cli"),
    ]);
    expect(defaultAntigravityRoots({ antigravityRoots: ["/only"] })).toEqual(["/only"]);
  });
});

describe("Antigravity extraction", () => {
  it("counts type-14 user text, skips artifact sends, agent steps, and malformed payloads", async () => {
    const profile = generateAntigravityProfile([CONV_A], []);
    try {
      const session = {
        source: "antigravity" as const,
        sessionId: CONV_A.conversationId,
        file: path.join(profile.desktopRoot, "conversations", `${CONV_A.conversationId}.db`),
        projectPath: "/Users/ryan/demo",
      };
      const { records, skipCounter } = await extractAntigravityRecords(session);
      expect(records.map((r) => r.text)).toEqual([
        "thanks, that build finally passed",
        "ok fuck, the types broke again",
      ]);
      expect(skipCounter.malformedLines).toBe(1);
      expect(skipCounter.failedFiles).toEqual([]);
      expect(records[0].recordId).toBe(`${CONV_A.conversationId}:0`);
      expect(records[0].projectPath).toBe("/Users/ryan/demo");
      expect(records[0].timestamp).toBe("2026-10-01T12:00:00Z");
      expect(records[1].timestamp).toBe("2026-10-01T12:00:03Z");
      expect(records[0].dedupKey).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });

  it("never counts nested sub-cascade dispatch prompts", async () => {
    const profile = generateAntigravityProfile([CONV_A, CONV_B_NESTED], []);
    try {
      const result = await scanAdapter(createAntigravityAdapter(), [profile.desktopRoot]);
      expect(result.records).toHaveLength(2);
      expect(result.records.map((r) => r.text).join("\n")).not.toContain("You are tasked");
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });

  it("reports unreadable conversation dbs as failedFiles", async () => {
    const profile = generateAntigravityProfile([], []);
    try {
      const bad = path.join(profile.desktopRoot, "conversations", "bad.db");
      require("fs").writeFileSync(bad, "this is not a sqlite db");
      const { records, skipCounter } = await extractAntigravityRecords({
        source: "antigravity",
        sessionId: "bad",
        file: bad,
      });
      expect(records).toEqual([]);
      expect(skipCounter.failedFiles).toHaveLength(1);
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });
});

describe("Antigravity doctor", () => {
  it("counts conversations and nested ones per root", () => {
    const profile = generateAntigravityProfile([CONV_A, CONV_B_NESTED], [CONV_C_CLI]);
    try {
      const report = doctorAntigravity({ antigravityHome: profile.home });
      expect(report.roots).toHaveLength(2);
      const desktop = report.roots.find((r) => r.root === profile.desktopRoot);
      expect(desktop).toMatchObject({ present: true, conversationCount: 2, nestedCount: 1 });
      const cli = report.roots.find((r) => r.root === profile.cliRoot);
      expect(cli).toMatchObject({ present: true, conversationCount: 1, nestedCount: 0 });
      const missing = doctorAntigravity({ antigravityHome: "/nonexistent" });
      expect(missing.issues).toHaveLength(2);
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });
});

describe("Antigravity meter integration", () => {
  it("flows through runSentimentMeter with root overrides", async () => {
    const profile = generateAntigravityProfile([CONV_A], [CONV_C_CLI]);
    try {
      const { report, scanResults } = await runSentimentMeter({
        window: "all",
        now: Date.parse("2026-10-02T12:30:00Z"),
        sources: ["antigravity"],
        roots: { antigravity: [profile.desktopRoot, profile.cliRoot] },
      });
      expect(scanResults).toHaveLength(1);
      expect(report.humanMessages).toBe(3);
      expect(report.thanksTokens).toBe(1);
      expect(report.fbombTokens).toBe(2);
      expect(report.perSource.antigravity?.messages).toBe(3);
    } finally {
      cleanupAntigravityProfile(profile);
    }
  });
});