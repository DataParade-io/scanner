import fs from "fs";
import os from "os";
import path from "path";
import { guardSentimentFixtures } from "../../../scripts/guard-sentiment-fixtures";

const FIXTURE_ROOT = path.join(__dirname, "../../fixtures/sentiment");

describe("sentiment fixture guard", () => {
  it("passes the committed synthetic fixtures", () => {
    const result = guardSentimentFixtures(FIXTURE_ROOT);
    expect(result.violations).toEqual([]);
    expect(result.checked).toBeGreaterThan(3);
  });

  it("rejects a file that looks like a real session dump", () => {
    const big = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-guard-"));
    const target = path.join(big, "dump.jsonl");
    fs.writeFileSync(target, Array.from({ length: 5001 }, () => "{}").join("\n"));
    const result = guardSentimentFixtures(big);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toContain("looks like a real dump");
    fs.rmSync(big, { recursive: true, force: true });
  });

  it("rejects committed binary databases", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-guard2-"));
    const target = path.join(dir, "state.vscdb");
    fs.writeFileSync(target, "fake");
    const result = guardSentimentFixtures(dir);
    expect(result.violations[0].reason).toContain("generated at test time");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
