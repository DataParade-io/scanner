import {
  createCursorAdapter,
  decodeSanitizedProject,
  discoverComposers,
  doctorCursor,
  isSubagentComposerId,
  workspaceFolderFromUri,
} from "../../../src/sentiment/adapters/cursor";
import { extractCursorRecords } from "../../../src/sentiment/adapters/cursor";
import { scanAdapter } from "../../../src/sentiment/scan";
import {
  cleanupCursorProfile,
  generateCursorProfile,
  type FixtureComposer,
} from "./helpers/cursor-fixture";

function composer(id: string, texts: string[], startMs = 1727784000000, extra: Partial<FixtureComposer> = {}): FixtureComposer {
  return {
    composerId: id,
    bubbles: texts.map((text, i) => ({
      bubbleId: `${id}-b${i}`,
      type: 1,
      text,
      createdAt: startMs + i * 1000,
    })),
    ...extra,
  };
}

describe("state.vscdb fixture generator", () => {
  it("produces databases the discovery code reads end to end, in both index shapes", () => {
    for (const shape of ["2x", "3x"] as const) {
      const profile = generateCursorProfile({
        shape,
        globalComposers: [composer("c1", ["thanks, works", "fuck, it broke again"])],
      });
      const { composers } = discoverComposers(profile.globalDb);
      expect(composers.map((c) => c.composerId)).toEqual(["c1"]);
      cleanupCursorProfile(profile);
    }
  });
});

describe("Cursor IDE discovery", () => {
  it("returns the same composer set from 2.x-shaped and 3.x-shaped fixtures", () => {
    const idsFrom: string[][] = [];
    for (const shape of ["2x", "3x"] as const) {
      const profile = generateCursorProfile({
        shape,
        globalComposers: [composer("c1", ["thanks"]), composer("c2", ["hello"])],
      });
      const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
      const discovery = adapter.discover();
      idsFrom.push(discovery.sessions.map((s) => s.sessionId).sort());
      expect(discovery.sessions.every((s) => s.source === "cursor-ide")).toBe(true);
      cleanupCursorProfile(profile);
    }
    expect(idsFrom[0]).toEqual(idsFrom[1]);
    expect(idsFrom[0]).toEqual(["c1", "c2"]);
  });

  it("attributes project paths via workspace.json folder URIs", () => {
    const profile = generateCursorProfile({
      workspaceComposers: [composer("w1", ["thanks"])],
      workspaceFolderUri: "file:///Users/ryan/demo",
    });
    const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
    const discovery = adapter.discover();
    const session = discovery.sessions.find((s) => s.sessionId === "w1");
    expect(session?.projectPath).toBe("/Users/ryan/demo");
    cleanupCursorProfile(profile);
  });

  it("excludes subagent composers", () => {
    expect(isSubagentComposerId("subagent-123")).toBe(true);
    expect(isSubagentComposerId("c1")).toBe(false);
  });

  it("reads safely while a writer holds the DB (WAL siblings present)", () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks"])],
      withWal: true,
    });
    const { composers, warnings } = discoverComposers(profile.globalDb);
    expect(composers).toHaveLength(1);
    expect(warnings).toEqual([]);
    cleanupCursorProfile(profile);
  });

  it("tolerates a missing root", () => {
    const adapter = createCursorAdapter({ cursorUserDir: "/nonexistent", cursorHomeDir: "/nonexistent-home" });
    const discovery = adapter.discover();
    expect(discovery.sessions).toEqual([]);
    expect(discovery.skipCounter.missingRoots).toContain("/nonexistent");
  });
});

describe("Cursor human-message extraction", () => {
  it("extracts type-1 user bubbles with createdAt timestamps, both shapes", async () => {
    for (const shape of ["2x", "3x"] as const) {
      const profile = generateCursorProfile({
        shape,
        globalComposers: [composer("c1", ["thanks, that fixed it", "fuck, the tests failed again"])],
      });
      const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
      const discovery = adapter.discover();
      const session = discovery.sessions.find((s) => s.sessionId === "c1");
      expect(session).toBeDefined();
      const { records } = await extractCursorRecords(session!);
      expect(records.map((r) => r.text)).toEqual(["thanks, that fixed it", "fuck, the tests failed again"]);
      expect(records[0].source).toBe("cursor-ide");
      expect(new Date(records[0].timestamp).getTime()).toBe(1727784000000);
      cleanupCursorProfile(profile);
    }
  });

  it("orders bubbles by fullConversationHeadersOnly, not by insertion", async () => {
    const profile = generateCursorProfile({
      globalComposers: [
        composer("c1", ["second message", "first message"], 1727784000000, {
          headers: [{ bubbleId: "c1-b1" }, { bubbleId: "c1-b0" }],
        }),
      ],
    });
    const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
    const discovery = adapter.discover();
    const { records } = await extractCursorRecords(discovery.sessions[0]);
    expect(records.map((r) => r.text)).toEqual(["second message", "first message"]);
    cleanupCursorProfile(profile);
  });

  it("ignores assistant (type-2) bubbles and empty texts", async () => {
    const profile = generateCursorProfile({
      globalComposers: [{
        composerId: "c1",
        bubbles: [
          { bubbleId: "b0", type: 1, text: "thanks", createdAt: 1727784000000 },
          { bubbleId: "b1", type: 2, text: "assistant reply", createdAt: 1727784001000 },
          { bubbleId: "b2", type: 1, text: "   ", createdAt: 1727784002000 },
        ],
      }],
    });
    const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
    const discovery = adapter.discover();
    const { records } = await extractCursorRecords(discovery.sessions[0]);
    expect(records.map((r) => r.text)).toEqual(["thanks"]);
    cleanupCursorProfile(profile);
  });
});

describe("Cursor agent transcripts", () => {
  it("extracts user-role lines and excludes injected context", async () => {
    const profile = generateCursorProfile({
      agentTranscripts: [{
        sanitizedProject: "-Users-ryan-demo",
        sessionId: "sess-1",
        lines: [
          { type: "message", role: "user", text: "thanks, saved me", timestamp: 1727784000000 },
          { type: "message", role: "assistant", text: "glad", timestamp: 1727784001000 },
          { type: "message", role: "user", text: "<system-reminder>injected</system-reminder>", timestamp: 1727784002000 },
          { type: "context", role: "user", text: "not a message bubble", timestamp: 1727784003000 },
        ],
      }],
    });
    const adapter = createCursorAdapter({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
    const discovery = adapter.discover();
    expect(discovery.sessions.map((s) => s.sessionId)).toEqual(["sess-1"]);
    expect(discovery.sessions[0].source).toBe("cursor-agent");
    const { records } = await extractCursorRecords(discovery.sessions[0]);
    expect(records.map((r) => r.text)).toEqual(["thanks, saved me"]);
    expect(records[0].source).toBe("cursor-agent");
    cleanupCursorProfile(profile);
  });
});

describe("Cursor dedup and doctor", () => {
  it("counts a composer surfaced by multiple indexes once", async () => {
    const profile = generateCursorProfile({
      globalComposers: [composer("c1", ["thanks"])],
      workspaceComposers: [composer("c1", ["thanks"])],
    });
    // Same composerId in global and workspace DBs: union dedup collapses.
    const result = await scanAdapter(createCursorAdapter({
      cursorUserDir: profile.userDir,
      cursorHomeDir: profile.cursorHome,
    }));
    expect(result.records.filter((r) => r.text === "thanks")).toHaveLength(1);
    expect(result.stats.collapsed).toBe(1);
    cleanupCursorProfile(profile);
  });

  it("reports doctor diagnostics", () => {
    const profile = generateCursorProfile({ globalComposers: [composer("c1", ["thanks"])] });
    const report = doctorCursor({ cursorUserDir: profile.userDir, cursorHomeDir: profile.cursorHome });
    expect(report.globalDbPresent).toBe(true);
    expect(report.issues).toEqual([]);
    cleanupCursorProfile(profile);
  });

  it("flags a missing global db", () => {
    const report = doctorCursor({ cursorUserDir: "/nonexistent", cursorHomeDir: "/nonexistent-home" });
    expect(report.globalDbPresent).toBe(false);
    expect(report.issues).toContain("global state.vscdb missing");
  });
});

describe("helpers", () => {
  it("decodes sanitized project names and workspace URIs", () => {
    expect(decodeSanitizedProject("-Users-ryan-demo")).toBe("/Users/ryan/demo");
    expect(workspaceFolderFromUri("file:///Users/ryan/demo")).toBe("/Users/ryan/demo");
    expect(workspaceFolderFromUri("not-a-uri")).toBeUndefined();
  });
});
