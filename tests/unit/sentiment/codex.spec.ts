import fs from "fs";
import os from "os";
import path from "path";
import {
  CODEX_INJECTED_MARKERS,
  createCodexAdapter,
  defaultCodexHome,
  doctorCodex,
  extractCodexRecords,
  isCodexInjectedText,
} from "../../../src/sentiment/adapters/codex";
import { scanAdapter } from "../../../src/sentiment/scan";

const FIXTURE_ROOT = path.join(__dirname, "../../fixtures/sentiment/codex");

function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-codex-"));
  fs.cpSync(FIXTURE_ROOT, dir, { recursive: true });
  return dir;
}

describe("Codex discovery", () => {
  it("finds date-partitioned fixture rollouts and tolerates a missing root", () => {
    const adapter = createCodexAdapter();
    const discovery = adapter.discover([FIXTURE_ROOT]);
    expect(discovery.sessions).toHaveLength(3);
    expect(discovery.sessions.every((s) => s.source === "codex")).toBe(true);

    const missing = adapter.discover(["/nonexistent/codex"]);
    expect(missing.sessions).toEqual([]);
    expect(missing.skipCounter.missingRoots).toEqual(["/nonexistent/codex"]);
  });

  it("honors CODEX_HOME / codexHome override", () => {
    expect(defaultCodexHome({ codexHome: "/custom" })).toBe("/custom");
    expect(defaultCodexHome({ homeDir: "/fakehome" })).toBe("/fakehome/.codex");
  });

  it("covers archived_sessions", async () => {
    const dir = copyFixture();
    const archived = path.join(dir, "archived_sessions", "2026", "10", "01");
    fs.mkdirSync(archived, { recursive: true });
    fs.copyFileSync(
      path.join(dir, "sessions", "2026", "10", "01", "rollout-1727784000-00000000-0000-0000-0000-000000000001.jsonl"),
      path.join(archived, "rollout-1727784000-00000000-0000-0000-0000-000000000001.jsonl"),
    );
    const result = await scanAdapter(createCodexAdapter({ codexHome: dir }));
    // Same session_meta id in sessions and archived_sessions: counted once.
    const thanks = result.records.filter((r) => r.text === "thanks, this works");
    expect(thanks).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Codex human-message extraction", () => {
  it("extracts response_item user messages and rejects injected content, mirrors, and unknown types", async () => {
    const session = {
      source: "codex" as const,
      sessionId: "00000000-0000-0000-0000-000000000001",
      file: path.join(FIXTURE_ROOT, "sessions", "2026", "10", "01", "rollout-1727784000-00000000-0000-0000-0000-000000000001.jsonl"),
    };
    const { records, skipCounter } = await extractCodexRecords(session);
    const texts = records.map((r) => r.text);
    // response_item user messages survive…
    expect(texts).toContain("thanks, this works");
    expect(texts).toContain("now fuck this linter into shape");
    expect(texts).toContain("kinds say user text, thanks");
    expect(texts).toContain("# Files mentioned by the user:\n\n## screenshot.png: /Users/ryan/demo/screenshot.png\nthe screenshot made it click, thanks");
    // …event_msg mirrors are not double-counted…
    expect(records.filter((r) => r.text === "thanks, this works")).toHaveLength(1);
    // …injected wrappers are excluded…
    expect(texts.join("\n")).not.toMatch(/user_instructions|environment_context|recommended_plugins|subagent_notification|in-app-browser-context|codex_internal_context|turn_aborted|realtime_delegation/);
    // …heading-shaped injections and kind-tagged injected records are excluded…
    expect(texts.join("\n")).not.toMatch(/do the thing|AGENTS\.md instructions|Chrome tabs/);
    // …compacted summary records stay out (message lives inside the payload).
    expect(texts.join("\n")).not.toMatch(/compaction summary/);
    // …malformed lines are counted, never fatal.
    expect(skipCounter.malformedLines).toBeGreaterThanOrEqual(2);
    // Session and project attribution from session_meta.
    expect(records[0].sessionId).toBe("00000000-0000-0000-0000-000000000001");
    expect(records[0].projectPath).toBe("/Users/ryan/demo");
    // Timestamps from record fields (RFC3339 with milliseconds).
    expect(records[0].timestamp).toBe("2026-10-01T12:00:01Z");
  });

  it("concatenates input_text blocks", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-codex2-"));
    const file = path.join(dir, "rollout-x.jsonl");
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ timestamp: "2026-10-01T12:00:00.000Z", type: "session_meta", payload: { id: "s1", cwd: "/p" } }),
        JSON.stringify({ timestamp: "2026-10-01T12:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "line one" }, { type: "input_text", text: "line two" }] } }),
      ].join("\n") + "\n",
    );
    const { records } = await extractCodexRecords({ source: "codex", sessionId: "s1", file });
    expect(records[0].text).toBe("line one\nline two");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Codex forked/resumed rollouts", () => {
  it("counts inherited messages exactly once across the fork pair", async () => {
    const result = await scanAdapter(createCodexAdapter({ codexHome: FIXTURE_ROOT }));
    // The fork re-records the two inherited messages (real ordinals 1 and 5,
    // below forked_from_ordinal_exclusive 6); they are skipped there and
    // counted once from the original rollout.
    expect(result.records.filter((r) => r.text === "thanks, this works")).toHaveLength(1);
    expect(result.records.filter((r) => r.text === "now fuck this linter into shape")).toHaveLength(1);
    // The fork's own new message appears once.
    expect(result.records.filter((r) => r.text === "one more thing, thanks")).toHaveLength(1);
  });
});

describe("Codex subagent rollouts", () => {
  it("skips subagent rollouts: their user items are delegation prompts", async () => {
    const session = {
      source: "codex" as const,
      sessionId: "00000000-0000-0000-0000-000000000003",
      file: path.join(FIXTURE_ROOT, "sessions", "2026", "10", "01", "rollout-1727784200-00000000-0000-0000-0000-000000000003.jsonl"),
    };
    const { records } = await extractCodexRecords(session);
    expect(records).toEqual([]);
  });
});

describe("Codex doctor", () => {
  it("reports rollout counts and missing roots", () => {
    const report = doctorCodex({ codexHome: FIXTURE_ROOT });
    expect(report.rolloutCount).toBe(3);
    expect(report.issues.some((i) => i.includes("sessions/ missing"))).toBe(false);
    const missing = doctorCodex({ codexHome: "/nonexistent" });
    expect(missing.issues).toContain("sessions/ missing");
  });
});

describe("Codex injected markers", () => {
  it("marks documented wrapper shapes", () => {
    expect(isCodexInjectedText("<environment_context> x")).toBe(true);
    expect(isCodexInjectedText("<recommended_plugins>x</recommended_plugins>")).toBe(true);
    expect(isCodexInjectedText("<turn_aborted>x</turn_aborted>")).toBe(true);
    expect(isCodexInjectedText("<in-app-browser-context source=\"tab\">x</in-app-browser-context>")).toBe(true);
    expect(isCodexInjectedText("<codex_internal_context source=\"plan\">x</codex_internal_context>")).toBe(true);
    expect(isCodexInjectedText("thanks")).toBe(false);
    expect(isCodexInjectedText("PLEASE IMPLEMENT THIS PLAN: do things")).toBe(false);
    expect(CODEX_INJECTED_MARKERS.length).toBeGreaterThan(0);
  });
});
