import fs from "fs";
import path from "path";
import YAML from "yaml";
import { createVaderBackend } from "../../../src/sentiment/sentiment-classifier";
import type { SentimentBackend, SentimentLabel } from "../../../src/sentiment/sentiment-classifier";

const GOLD_PATH = path.join(__dirname, "../../../annotations/KDATAP-fe4c1d/sentiment-gold.yaml");

interface GoldLabel {
  text: string;
  source: string;
  gold: SentimentLabel | "excluded";
}

interface GoldFile {
  version: number;
  task: string;
  labels: GoldLabel[];
}

function loadGold(): GoldFile {
  return YAML.parse(fs.readFileSync(GOLD_PATH, "utf8")) as GoldFile;
}

/** Accuracy over the non-excluded labels; excluded labels check the null path. */
function evalBackend(backend: SentimentBackend, gold: GoldFile): {
  accuracy: number;
  correct: number;
  scored: number;
  excludedCorrect: number;
} {
  let correct = 0;
  let scored = 0;
  let excludedCorrect = 0;
  for (const label of gold.labels) {
    const score = backend.scoreMessage(label.text);
    if (label.gold === "excluded") {
      if (score === null) excludedCorrect += 1;
      continue;
    }
    scored += 1;
    if (score?.label === label.gold) correct += 1;
  }
  return { accuracy: scored > 0 ? correct / scored : 0, correct, scored, excludedCorrect };
}

/**
 * Documented accuracy gate for the synthetic gold set (KDATAP-fe4c1d): a
 * local backend must classify at least 85 percent of non-excluded gold
 * messages with the operator-facing label, and route all excluded messages
 * to the null path.
 */
const GOLD_ACCURACY_GATE = 0.85;

describe("sentiment gold eval (KDATAP-fe4c1d)", () => {
  const gold = loadGold();

  it("has a synthetic, non-empty gold set", () => {
    expect(gold.task).toBe("KDATAP-fe4c1d");
    expect(gold.labels.length).toBeGreaterThanOrEqual(30);
  });

  it("VADER meets the accuracy gate", () => {
    const result = evalBackend(createVaderBackend(), gold);
    expect(result.excludedCorrect).toBe(gold.labels.filter((l) => l.gold === "excluded").length);
    expect(result.accuracy).toBeGreaterThanOrEqual(GOLD_ACCURACY_GATE);
  });

  it("every gold label is one of pos/neu/neg/excluded", () => {
    for (const label of gold.labels) {
      expect(["pos", "neu", "neg", "excluded"]).toContain(label.gold);
    }
  });
});