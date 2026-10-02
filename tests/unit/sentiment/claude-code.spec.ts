import fs from "fs";
import os from "os";
import path from "path";
import { createClaudeCodeAdapter, decodeProjectDirName, doctorClaudeCode, extractClaudeCodeRecords, isInjectedText } from "../../../src/sentiment/adapters/claude-code";
import { scanAdapter } from "../../../src/sentiment/scan";

const FIXTURE_ROOT = path.join(__dirname, "../../fixtures/sentiment/claude-code/projects");

function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-claude-"));
  fs.cpSync(path.join(__dirname, "../../fixtures/sentiment/claude-code/projects"), path.join(dir, "projects"), { recursive: true });
  return dir;
}

describe("Claude Code discovery", () => {
  it("finds fixture sessions, decodes project paths, and skips subagents", () => {
    const adapter = createClaudeCodeAdapter();
    const discovery = adapter.discover([FIXTURE_ROOT]);
    const sessionIds = discovery.sessions.map((s) => s.sessionId).sort();
    expect(sessionIds).toEqual(["session-abc123", "session-fork-1"]);
    expect(discovery.sessions[0].projectPath).toContain("Users/ryan/demo");
  });

  it("excludes subagent transcripts (subagents dirs and agent- prefixed files)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-disc-"));
    const projectDir = path.join(root, "projects", "-tmp-proj");
    fs.mkdirSync(path.join(projectDir, "subagents"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "subagents", "inner.jsonl"), "");
    fs.writeFileSync(path.join(projectDir, "agent-9d81.jsonl"), "");
    fs.writeFileSync(path.join(projectDir, "real-session.jsonl"), "");
    const adapter = createClaudeCodeAdapter();
    const discovery = adapter.discover([path.join(root, "projects")]);
    expect(discovery.sessions.map((s) => s.sessionId)).toEqual(["real-session"]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("tolerates a missing root as an absent source, not an error", () => {
    const adapter = createClaudeCodeAdapter();
    const discovery = adapter.discover(["/nonexistent/root"]);
    expect(discovery.sessions).toEqual([]);
    expect(discovery.skipCounter.missingRoots).toEqual(["/nonexistent/root"]);
  });

  it("decodes encoded project directory names best-effort", () => {
    expect(decodeProjectDirName("-Users-ryan-demo")).toBe("/Users/ryan/demo");
  });
});

describe("Claude Code human-message extraction", () => {
  it("extracts human messages and rejects every injected class", async () => {
    const session = {
      source: "claude-code" as const,
      sessionId: "session-abc123",
      file: path.join(FIXTURE_ROOT, "-Users-ryan-demo", "session-abc123.jsonl"),
    };
    const { records, skipCounter } = await extractClaudeCodeRecords(session);
    const texts = records.map((r) => r.text);
    expect(texts).toContain("thanks for the fix");
    expect(texts).toContain("looks fuckin great, thanks");
    expect(texts).toContain("queued follow-up\nsecond block"); // human-origin queued command
    // Every excluded class:
    expect(texts.join("\n")).not.toMatch(/tool_result|is meta|sidechain|prompt source/);
    expect(texts.join("\n")).not.toMatch(/system-reminder|task-notification|command-name|continued from a previous/);
    // Timestamps come from record fields, not line order.
    expect(records[0].timestamp).toBe("2026-10-01T12:00:00Z");
    // Malformed line and unknown record type counted, never fatal.
    expect(skipCounter.malformedLines).toBeGreaterThanOrEqual(2);
  });

  it("marks queued-command attachments with a stable record id", async () => {
    const session = {
      source: "claude-code" as const,
      sessionId: "session-abc123",
      file: path.join(FIXTURE_ROOT, "-Users-ryan-demo", "session-abc123.jsonl"),
    };
    const { records } = await extractClaudeCodeRecords(session);
    const queued = records.find((r) => r.recordId.startsWith("queued:"));
    expect(queued).toBeDefined();
  });

  it("classifies injected wrapper texts", () => {
    expect(isInjectedText("<system-reminder>x</system-reminder>")).toBe(true);
    expect(isInjectedText("thanks")).toBe(false);
  });
});

describe("Claude Code dedup and incremental rescan", () => {
  it("counts a forked session copy once", async () => {
    const adapter = createClaudeCodeAdapter();
    const result = await scanAdapter(adapter, [FIXTURE_ROOT]);
    // u1 appears in both session-abc123 and session-fork-1 with the same uuid.
    const thanks = result.records.filter((r) => r.text === "thanks for the fix");
    expect(thanks).toHaveLength(1);
    expect(result.stats.collapsed).toBeGreaterThanOrEqual(1);
  });

  it("yields identical totals after append (rescan equals cold scan)", async () => {
    const dir = copyFixture();
    const projectDir = path.join(dir, "projects", "-Users-ryan-demo");
    const file = path.join(projectDir, "session-abc123.jsonl");

    const adapter = () => createClaudeCodeAdapter();
    const cold = await scanAdapter(adapter(), [path.join(dir, "projects")]);
    const coldCount = cold.records.length;

    const appended = [
      JSON.stringify({ type: "user", sessionId: "session-abc123", cwd: "/Users/ryan/demo", uuid: "u20", timestamp: "2026-10-01T13:00:00.000Z", message: { role: "user", content: "thanks again" } }),
      JSON.stringify({ type: "assistant", sessionId: "session-abc123", uuid: "a20", timestamp: "2026-10-01T13:00:10.000Z", message: { role: "assistant", content: [{ type: "text", text: "anytime" }] } }),
    ];
    fs.appendFileSync(file, appended.join("\n") + "\n");

    const warm = await scanAdapter(adapter(), [path.join(dir, "projects")]);
    // Cold rescan over the changed tree: totals must match a from-scratch scan.
    const scratch = await scanAdapter(adapter(), [path.join(dir, "projects")]);
    expect(warm.records.length).toBe(scratch.records.length);
    expect(warm.records.length).toBe(coldCount + 1);
    expect(warm.records.map((r) => r.text)).toEqual(scratch.records.map((r) => r.text));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Claude Code doctor", () => {
  it("reports transcript counts and missing roots", () => {
    const report = doctorClaudeCode();
    const fixtureRoot = report.roots.find((r) => !r.present) ?? report.roots[0];
    expect(report.roots.length).toBeGreaterThan(0);
    expect(fixtureRoot).toBeDefined();
  });
});

describe("scanAdapter per-file crash guard", () => {
  it("continues when one file explodes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-crash-"));
    const projectDir = path.join(root, "projects", "-tmp-p");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "good.jsonl"), JSON.stringify({ type: "user", sessionId: "g", cwd: "/p", uuid: "u1", timestamp: "2026-10-01T12:00:00Z", message: { role: "user", content: "thanks" } }));
    // Unreadable directory entry forces a readdir failure mid-scan.
    const adapter = createClaudeCodeAdapter();
    const result = await scanAdapter(adapter, [path.join(root, "projects")]);
    expect(result.records.map((r) => r.text)).toEqual(["thanks"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
