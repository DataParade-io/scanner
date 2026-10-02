import fs from "fs";
import path from "path";
import YAML from "yaml";
import { createClaudeCodeAdapter } from "../../../src/sentiment/adapters/claude-code";
import { createCursorAdapter } from "../../../src/sentiment/adapters/cursor";
import { createCodexAdapter } from "../../../src/sentiment/adapters/codex";
import { scanAdapter } from "../../../src/sentiment/scan";
import { countMessage } from "../../../src/sentiment/counting";
import { loadSentimentWordList } from "../../../src/sentiment/word-lists";

const GOLD_PATH = path.join(__dirname, "../../../annotations/KDATAP-da54f5/gold-labels.yaml");

interface GoldLabel {
  text: string;
  source: string;
  gold: "thanks" | "fbomb" | "both" | "neither" | "excluded";
}

function classify(text: string): "thanks" | "fbomb" | "both" | "neither" | "excluded" {
  const result = countMessage(text, loadSentimentWordList());
  if (result.excluded) return "excluded";
  const g = result.families.gratitude.messageCount > 0;
  const f = result.families.fbomb.messageCount > 0;
  if (g && f) return "both";
  if (g) return "thanks";
  if (f) return "fbomb";
  return "neither";
}

async function collectFixtureRecords(): Promise<{ text: string; source: string }[]> {
  const records: { text: string; source: string }[] = [];
  const claude = await scanAdapter(
    createClaudeCodeAdapter(),
    [path.join(__dirname, "../../fixtures/sentiment/claude-code/projects")],
  );
  for (const r of claude.records) records.push({ text: r.text, source: r.source });
  const cursor = await scanAdapter(
    createCursorAdapter({
      cursorUserDir: "/nonexistent",
      cursorHomeDir: path.join(__dirname, "../../fixtures/sentiment/cursor-home"),
    }),
  );
  for (const r of cursor.records) records.push({ text: r.text, source: r.source });
  const codex = await scanAdapter(
    createCodexAdapter({ codexHome: path.join(__dirname, "../../fixtures/sentiment/codex") }),
  );
  for (const r of codex.records) records.push({ text: r.text, source: r.source });
  return records;
}

describe("gold eval: exact match on synthetic fixtures", () => {
  it("classifies every fixture human message exactly as labeled", async () => {
    const gold = (YAML.parse(fs.readFileSync(GOLD_PATH, "utf8")) as { labels: GoldLabel[] }).labels;
    const extracted = await collectFixtureRecords();
    const byText = new Map(extracted.map((r) => [r.text, r.source]));
    // Every gold row must be present in the extracted corpus.
    for (const row of gold) {
      expect({ text: row.text, present: byText.has(row.text) }).toEqual({ text: row.text, present: true });
    }
    // And vice versa (no unlabeled human messages in the corpus).
    expect(byText.size).toBe(gold.length);
    // Exact match: 100 percent.
    for (const row of gold) {
      expect({ text: row.text, got: classify(row.text) }).toEqual({ text: row.text, got: row.gold });
    }
  });
});
