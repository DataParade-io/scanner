/**
 * Sentiment backend evaluation: gold-set accuracy, real-corpus agreement
 * between backends, and throughput on this machine.
 *
 * Runs under plain ts-node (not jest) because onnxruntime-node tensor
 * execution fails under jest's vm realm. Output carries aggregate numbers
 * only — no message text, no per-message scores.
 *
 * Usage:
 *   pnpm exec ts-node --files scripts/sentiment-backend-eval.ts [--window all] [--bench-messages 1000]
 */

import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";
import YAML from "yaml";

import { createSentimentBackendAsync } from "../src/sentiment/sentiment-classifier";
import type { AsyncSentimentBackend, SentimentLabel } from "../src/sentiment/sentiment-classifier";
import { createVaderBackend } from "../src/sentiment/sentiment-classifier";
import { createTransformerBackend } from "../src/sentiment/transformer-backend";
import { runSentimentMeter } from "../src/sentiment/run";
import { isInWindow, resolveWindow } from "../src/sentiment/windows";
import type { HumanMessageRecord } from "../src/sentiment/record";
import { loadSentimentConfig } from "../src/sentiment/config";

const GOLD_PATH = path.join(__dirname, "../annotations/KDATAP-fe4c1d/sentiment-gold.yaml");

interface GoldLabel {
  text: string;
  source: string;
  gold: SentimentLabel | "excluded";
}

function loadGold(): GoldLabel[] {
  return (YAML.parse(fs.readFileSync(GOLD_PATH, "utf8")) as { labels: GoldLabel[] }).labels;
}

interface AgreementStats {
  compared: number;
  labelAgreements: number;
  labelAgreementRate: number;
  meanCompoundVader: number;
  meanCompoundTransformer: number;
  meanAbsCompoundDiff: number;
}

async function realCorpusAgreement(
  windowSpec: string,
): Promise<{ overall: AgreementStats; perSource: Record<string, AgreementStats> }> {
  const config = loadSentimentConfig();
  const { scanResults } = await runSentimentMeter({
    window: windowSpec,
    sources: config.sources as never,
    roots: config.roots as never,
    sentimentBackend: "",
  });
  const window = resolveWindow(windowSpec, Date.now(), config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, config.dayStart ?? "00:00", {});
  const records = scanResults
    .flatMap((entry) => entry.result.records)
    .filter((r) => isInWindow(new Date(r.timestamp).getTime(), window)) as HumanMessageRecord[];

  const vader = createVaderBackend();
  const transformer = await createTransformerBackend();

  const perSource: Record<string, AgreementStats> = {};
  const overall: AgreementStats = {
    compared: 0,
    labelAgreements: 0,
    labelAgreementRate: 0,
    meanCompoundVader: 0,
    meanCompoundTransformer: 0,
    meanAbsCompoundDiff: 0,
  };
  for (const record of records) {
    const a = vader.scoreMessage(record.text);
    const b = await transformer.scoreMessage(record.text);
    if (!a || !b) continue;
    const stats: AgreementStats =
      perSource[record.source] ??
      (perSource[record.source] = {
        compared: 0,
        labelAgreements: 0,
        labelAgreementRate: 0,
        meanCompoundVader: 0,
        meanCompoundTransformer: 0,
        meanAbsCompoundDiff: 0,
      });
    for (const s of [overall, stats]) {
      s.compared += 1;
      if (a.label === b.label) s.labelAgreements += 1;
      s.meanCompoundVader += a.compound;
      s.meanCompoundTransformer += b.compound;
      s.meanAbsCompoundDiff += Math.abs(a.compound - b.compound);
    }
  }
  for (const s of [overall, ...Object.values(perSource)]) {
    if (s.compared > 0) {
      s.labelAgreementRate = s.labelAgreements / s.compared;
      s.meanCompoundVader /= s.compared;
      s.meanCompoundTransformer /= s.compared;
      s.meanAbsCompoundDiff /= s.compared;
    }
  }
  return { overall, perSource };
}

/** Synthetic message pool for throughput measurement (no real text). */
function syntheticPool(count: number): string[] {
  const templates = [
    "thanks, that fixed it",
    "run the tests again",
    "the parser throws an exception on empty input",
    "this is awful, nothing works",
    "kill the stale worker and retry",
    "I hate how slow this is",
    "continue with the refactor",
    "works great now, thanks so much",
    "the server returns error code 500",
    "perfect, exactly what I needed",
  ];
  const pool: string[] = [];
  for (let i = 0; i < count; i++) pool.push(templates[i % templates.length]);
  return pool;
}

async function throughput(backend: AsyncSentimentBackend, texts: string[]): Promise<{ msgsPerSec: number; totalMs: number }> {
  await backend.scoreMessage(texts[0]); // warmup
  const start = process.hrtime.bigint();
  for (const text of texts) await backend.scoreMessage(text);
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { msgsPerSec: (texts.length / totalMs) * 1000, totalMs };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      window: { type: "string", default: "all" },
      "bench-messages": { type: "string", default: "500" },
    },
  });
  const windowSpec = values.window ?? "all";
  const benchCount = Number(values["bench-messages"] ?? 500);

  process.stdout.write(`Sentiment backend eval (window: ${windowSpec})\n`);

  const gold = loadGold();
  const vader = createVaderBackend();
  const transformer = await createTransformerBackend();
  const vaderAsync: AsyncSentimentBackend = {
    name: vader.name,
    scoreMessage: async (text) => vader.scoreMessage(text),
  };

  // Gold accuracy (sequential to keep eval deterministic).
  for (const [name, backend] of [["vader", vaderAsync], ["transformer", transformer]] as const) {
    let correct = 0;
    let scored = 0;
    let excludedCorrect = 0;
    let excluded = 0;
    for (const label of gold) {
      const score = await backend.scoreMessage(label.text);
      if (label.gold === "excluded") {
        excluded += 1;
        if (score === null) excludedCorrect += 1;
        continue;
      }
      scored += 1;
      if (score?.label === label.gold) correct += 1;
    }
    process.stdout.write(
      `gold ${name}: ${correct}/${scored} non-excluded correct (accuracy ${(correct / scored).toFixed(3)}), ${excludedCorrect}/${excluded} excluded routed to null\n`,
    );
  }

  // Real-corpus agreement (aggregate numbers only).
  const { overall, perSource } = await realCorpusAgreement(windowSpec);
  process.stdout.write(
    `agreement overall: compared ${overall.compared}, label agreement ${(overall.labelAgreementRate * 100).toFixed(1)}%, mean compound vader ${overall.meanCompoundVader.toFixed(3)} transformer ${overall.meanCompoundTransformer.toFixed(3)}, mean |diff| ${overall.meanAbsCompoundDiff.toFixed(3)}\n`,
  );
  for (const [source, s] of Object.entries(perSource)) {
    process.stdout.write(
      `agreement ${source}: compared ${s.compared}, label agreement ${(s.labelAgreementRate * 100).toFixed(1)}%, mean compound vader ${s.meanCompoundVader.toFixed(3)} transformer ${s.meanCompoundTransformer.toFixed(3)}, mean |diff| ${s.meanAbsCompoundDiff.toFixed(3)}\n`,
    );
  }

  // Throughput on this machine.
  const pool = syntheticPool(benchCount);
  const vaderT = await throughput(vaderAsync, pool);
  const transformerT = await throughput(transformer, pool);
  process.stdout.write(
    `throughput vader: ${vaderT.msgsPerSec.toFixed(0)} msgs/sec (${vaderT.totalMs.toFixed(1)} ms for ${pool.length})\n`,
  );
  process.stdout.write(
    `throughput transformer: ${transformerT.msgsPerSec.toFixed(1)} msgs/sec (${transformerT.totalMs.toFixed(1)} ms for ${pool.length})\n`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };