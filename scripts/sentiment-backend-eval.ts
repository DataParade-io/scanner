/**
 * Sentiment backend evaluation: gold-set accuracy (tuning + held-out with
 * confusion matrix), real-corpus agreement between backends, model size, and
 * throughput on this machine.
 *
 * Runs under plain ts-node (not jest) because onnxruntime-node tensor
 * execution fails under jest's vm realm. Output carries aggregate numbers
 * only — no message text, no per-message scores.
 *
 * Usage:
 *   pnpm run sentiment:eval [--window all] [--bench-messages 300] [--models transformer,transformer-xlmr,...]
 */

import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";
import YAML from "yaml";

import { createSentimentBackendAsync } from "../src/sentiment/sentiment-classifier";
import type { AsyncSentimentBackend, SentimentLabel } from "../src/sentiment/sentiment-classifier";
import { createVaderBackend } from "../src/sentiment/sentiment-classifier";
import { TRANSFORMER_MODELS, defaultTransformerCacheDir } from "../src/sentiment/transformer-backend";
import { runSentimentMeter } from "../src/sentiment/run";
import { isInWindow, resolveWindow } from "../src/sentiment/windows";
import type { HumanMessageRecord } from "../src/sentiment/record";
import { loadSentimentConfig } from "../src/sentiment/config";

const TUNING_GOLD_PATH = path.join(__dirname, "../annotations/KDATAP-fe4c1d/sentiment-gold.yaml");
const HELDOUT_GOLD_PATH = path.join(__dirname, "../annotations/KDATAP-5fc7c8/sentiment-gold-heldout.yaml");

interface GoldLabel {
  text: string;
  source: string;
  gold: SentimentLabel | "excluded";
  kind?: string;
}

function loadGold(pathname: string): GoldLabel[] {
  return (YAML.parse(fs.readFileSync(pathname, "utf8")) as { labels: GoldLabel[] }).labels;
}

interface AgreementStats {
  compared: number;
  labelAgreements: number;
  labelAgreementRate: number;
  meanCompoundVader: number;
  meanCompoundOther: number;
  meanAbsCompoundDiff: number;
}

async function realCorpusAgreement(
  windowSpec: string,
  backend: AsyncSentimentBackend,
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

  const perSource: Record<string, AgreementStats> = {};
  const overall: AgreementStats = {
    compared: 0,
    labelAgreements: 0,
    labelAgreementRate: 0,
    meanCompoundVader: 0,
    meanCompoundOther: 0,
    meanAbsCompoundDiff: 0,
  };
  for (const record of records) {
    const a = vader.scoreMessage(record.text);
    const b = await backend.scoreMessage(record.text);
    if (!a || !b) continue;
    const stats: AgreementStats =
      perSource[record.source] ??
      (perSource[record.source] = {
        compared: 0,
        labelAgreements: 0,
        labelAgreementRate: 0,
        meanCompoundVader: 0,
        meanCompoundOther: 0,
        meanAbsCompoundDiff: 0,
      });
    for (const s of [overall, stats]) {
      s.compared += 1;
      if (a.label === b.label) s.labelAgreements += 1;
      s.meanCompoundVader += a.compound;
      s.meanCompoundOther += b.compound;
      s.meanAbsCompoundDiff += Math.abs(a.compound - b.compound);
    }
  }
  for (const s of [overall, ...Object.values(perSource)]) {
    if (s.compared > 0) {
      s.labelAgreementRate = s.labelAgreements / s.compared;
      s.meanCompoundVader /= s.compared;
      s.meanCompoundOther /= s.compared;
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

interface GoldEvalResult {
  correct: number;
  scored: number;
  excludedCorrect: number;
  excluded: number;
  /** confusion[actual][predicted] over non-excluded labels */
  confusion: Record<string, Record<string, number>>;
  byKind: Record<string, { correct: number; total: number }>;
}

function emptyConfusion(): Record<string, Record<string, number>> {
  return { pos: {}, neu: {}, neg: {} };
}

function evalGold(backend: AsyncSentimentBackend, gold: GoldLabel[]): Promise<GoldEvalResult> {
  const result: GoldEvalResult = {
    correct: 0, scored: 0, excludedCorrect: 0, excluded: 0,
    confusion: emptyConfusion(), byKind: {},
  };
  return (async () => {
    for (const label of gold) {
      const score = await backend.scoreMessage(label.text);
      if (label.gold === "excluded") {
        result.excluded += 1;
        if (score === null) result.excludedCorrect += 1;
        continue;
      }
      result.scored += 1;
      const predicted = score?.label ?? "(none)";
      result.confusion[label.gold][predicted] = (result.confusion[label.gold][predicted] ?? 0) + 1;
      if (label.kind) {
        result.byKind[label.kind] ??= { correct: 0, total: 0 };
        result.byKind[label.kind].total += 1;
      }
      if (score?.label === label.gold) {
        result.correct += 1;
        if (label.kind) result.byKind[label.kind].correct += 1;
      }
    }
    return result;
  })();
}

function confusionMatrix(m: Record<string, Record<string, number>>): string {
  const rows = ["pos", "neu", "neg"];
  return rows
    .map((actual) => `${actual}-> p${m[actual]?.pos ?? 0} u${m[actual]?.neu ?? 0} n${m[actual]?.neg ?? 0}`)
    .join(", ");
}

/** Size in MB of the quantized ONNX file cached on disk for a backend. */
function modelSizeMb(name: string): number | null {
  const spec = TRANSFORMER_MODELS[name];
  if (!spec) return null;
  const onnxDir = path.join(
    defaultTransformerCacheDir(),
    spec.repo,
    "onnx",
  );
  const candidates = ["model_quantized.onnx", "model_int8.onnx", "model.onnx"];
  for (const file of candidates) {
    const full = path.join(onnxDir, file);
    if (fs.existsSync(full)) return fs.statSync(full).size / (1024 * 1024);
  }
  return null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      window: { type: "string", default: "all" },
      "bench-messages": { type: "string", default: "300" },
      models: { type: "string", default: "transformer,transformer-cardiff,transformer-xlmr,transformer-sst2" },
    },
  });
  const windowSpec = values.window ?? "all";
  const benchCount = Number(values["bench-messages"] ?? 300);
  const modelNames = (values.models ?? "").split(",").map((m) => m.trim()).filter(Boolean);

  process.stdout.write(`Sentiment backend eval (window: ${windowSpec})\n`);

  const tuningGold = loadGold(TUNING_GOLD_PATH);
  const heldoutGold = loadGold(HELDOUT_GOLD_PATH);

  const vader = createVaderBackend();
  const vaderAsync: AsyncSentimentBackend = {
    name: "vader",
    scoreMessage: async (text) => vader.scoreMessage(text),
  };

  const backends: { name: string; backend: AsyncSentimentBackend }[] = [
    { name: "vader", backend: vaderAsync },
  ];
  for (const name of modelNames) {
    backends.push({ name, backend: await createSentimentBackendAsync(name) });
  }

  for (const { name, backend } of backends) {
    const tuning = await evalGold(backend, tuningGold);
    const heldout = await evalGold(backend, heldoutGold);
    process.stdout.write(
      `${name}: tuning accuracy ${tuning.correct}/${tuning.scored} = ${(tuning.correct / tuning.scored).toFixed(3)} (excluded ${tuning.excludedCorrect}/${tuning.excluded})\n`,
    );
    process.stdout.write(
      `${name}: heldout accuracy ${heldout.correct}/${heldout.scored} = ${(heldout.correct / heldout.scored).toFixed(3)} (excluded ${heldout.excludedCorrect}/${heldout.excluded}); confusion ${confusionMatrix(heldout.confusion)}\n`,
    );
    const kinds = Object.entries(heldout.byKind)
      .map(([kind, k]) => `${kind} ${k.correct}/${k.total}`)
      .join(", ");
    process.stdout.write(`${name}: heldout by kind: ${kinds}\n`);
  }

  // Real-corpus agreement vs VADER (aggregate numbers only), per ML backend.
  for (const { name, backend } of backends) {
    if (name === "vader") continue;
    const { overall, perSource } = await realCorpusAgreement(windowSpec, backend);
    process.stdout.write(
      `agreement ${name} vs vader overall: compared ${overall.compared}, labels ${(overall.labelAgreementRate * 100).toFixed(1)}%, mean compound vader ${overall.meanCompoundVader.toFixed(3)} ${name} ${overall.meanCompoundOther.toFixed(3)}, mean |diff| ${overall.meanAbsCompoundDiff.toFixed(3)}\n`,
    );
    for (const [source, s] of Object.entries(perSource)) {
      process.stdout.write(
        `agreement ${name} ${source}: compared ${s.compared}, labels ${(s.labelAgreementRate * 100).toFixed(1)}%, mean compound vader ${s.meanCompoundVader.toFixed(3)} ${name} ${s.meanCompoundOther.toFixed(3)}, mean |diff| ${s.meanAbsCompoundDiff.toFixed(3)}\n`,
      );
    }
  }

  // Throughput on this machine + model size.
  const pool = syntheticPool(benchCount);
  for (const { name, backend } of backends) {
    const t = await throughput(backend, pool);
    const size = modelSizeMb(name);
    process.stdout.write(
      `throughput ${name}: ${t.msgsPerSec.toFixed(0)} msgs/sec (${t.totalMs.toFixed(1)} ms for ${pool.length})${size !== null ? `, model ${size.toFixed(1)} MB` : ""}\n`,
    );
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };