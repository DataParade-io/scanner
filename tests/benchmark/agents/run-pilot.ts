/**
 * End-to-end harness: materialized benchmark repo -> clean workspace -> Pi -> facts.json ->
 * validate -> score; scanner scored on the same repo; results written to results/<date>-<tag>.{json,md}.
 *
 * Run: pnpm run benchmark:agent-pilot <repoKey> [--model openai/gpt-6-luna] [--thinking low]
 *      (needs `pnpm run benchmark:materialize <repoKey>` first, and OPENAI_API_KEY in the env)
 */
import fs from "fs";
import os from "os";
import path from "path";

import { createDefaultScanConfiguration, scan } from "../../../src/core/pipeline/orchestrator";
import { assertMaterialized, runBenchmarkRepo } from "../run-benchmark";
import { scanRepoByManifestLayers } from "../scan-repo";
import { resolveDefaultBenchmarkRoot, findPackageRoot } from "../paths";
import { validateFactsText } from "./validate-facts";
import {
  itemsFromFacts,
  itemsFromScanner,
  loadGold,
  repoDirFor,
  scoreArm,
} from "./score-facts";
import { loadPrice, parsePiEvents, requestCostUsd, runPi, transcriptName } from "./pi-runner";
import { renderComparisonTable, renderCounts, type ArmResult } from "./report";

const agentsSrcDir = path.join(findPackageRoot(__dirname), "tests/benchmark/agents");

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function prepareWorkspace(materializedPath: string): { root: string; repo: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-eval-"));
  const repo = path.join(root, "repo");
  fs.cpSync(materializedPath, repo, {
    recursive: true,
    filter: (src) => path.basename(src) !== ".git",
  });
  // Validator tooling only: no scanner, no labels. dist/ holds the compiled harness.
  const tools = path.join(repo, ".tools");
  fs.mkdirSync(path.join(tools, "node_modules"), { recursive: true });
  const distAgents = __dirname;
  for (const f of ["validate-facts.js", "facts-schema.js", "vocabulary.json"]) {
    fs.copyFileSync(path.join(distAgents, f), path.join(tools, f));
  }
  fs.copyFileSync(path.join(agentsSrcDir, "vocabulary.json"), path.join(repo, "vocabulary.json"));
  const zodDir = path.dirname(require.resolve("zod/package.json"));
  fs.cpSync(fs.realpathSync(zodDir), path.join(tools, "node_modules", "zod"), { recursive: true });
  return { root, repo };
}

async function main(): Promise<void> {
  const repoKey = process.argv[2];
  if (!repoKey || repoKey.startsWith("--")) throw new Error("usage: run-pilot <repoKey> [--model m] [--thinking t]");
  const model = argValue("--model", "openai/gpt-6-luna");
  const thinking = argValue("--thinking", "low");
  const maxCostUsd = Number(argValue("--max-cost", "2"));
  const modelId = model.split("/").pop()!;
  const date = new Date().toISOString().slice(0, 10);
  const benchmarkRoot = resolveDefaultBenchmarkRoot();

  const materialized = assertMaterialized(repoKey);
  const gold = loadGold(repoDirFor(benchmarkRoot, repoKey));
  const price = loadPrice(path.join(agentsSrcDir, "prices.json"), modelId);
  const notes: string[] = [];
  if (!price) notes.push(`NO PRICE for ${modelId} in prices.json: tokens recorded, dollar cost UNKNOWN.`);
  if (gold.skippedFlows) notes.push(`${gold.skippedFlows} accepted gold flow(s) lack flow_canonical endpoints and were skipped.`);

  // ---- agent arm
  const { root, repo } = prepareWorkspace(materialized);
  const prompt = fs.readFileSync(path.join(agentsSrcDir, "assignment.md"), "utf8");
  const run = await runPi({
    workspace: repo,
    prompt,
    model,
    thinking,
    transcriptPath: transcriptName(root),
    maxCostUsd,
    timeoutMs: 20 * 60 * 1000,
    price,
  });
  if (run.aborted) notes.push(`Pi run aborted: ${run.aborted}.`);
  if (run.exitCode !== 0) notes.push(`Pi exit code ${run.exitCode}. stderr tail: ${run.stderrTail.trim().slice(-300)}`);

  const { requests, summary } = parsePiEvents(run.lines);
  const costUsd = price ? requests.reduce((a, r) => a + requestCostUsd(r, price), 0) : null;
  if (price && summary.piReportedCostUsd !== null && Math.abs(summary.piReportedCostUsd - (costUsd ?? 0)) > 0.0005) {
    notes.push(`Cost cross-check differs: computed ${costUsd?.toFixed(5)} vs Pi-reported ${summary.piReportedCostUsd.toFixed(5)}.`);
  }

  const factsPath = path.join(repo, "facts.json");
  let validation = "facts.json missing";
  let agentArm: ArmResult | null = null;
  if (fs.existsSync(factsPath)) {
    const result = validateFactsText(fs.readFileSync(factsPath, "utf8"));
    if (result.ok) {
      validation = "valid";
      const scored = scoreArm(itemsFromFacts(result.facts), gold);
      agentArm = {
        arm: `pi + ${modelId}`,
        repoKey,
        ...scored,
        cost: {
          usd: costUsd,
          inputTokens: summary.inputTokens,
          cachedInputTokens: summary.cachedInputTokens,
          outputTokens: summary.outputTokens,
          wallSeconds: run.wallSeconds,
          note: `thinking=${thinking}, ${summary.requests} requests, ${summary.toolCalls} tool calls`,
        },
      };
      fs.copyFileSync(factsPath, path.join(agentsSrcDir, "results", `${date}-${repoKey}-facts.json`));
    } else {
      validation = `invalid: ${result.errors.slice(0, 5).join("; ")}`;
    }
  }
  notes.push(`facts.json: ${validation}`);

  // ---- scanner arm (AI inference off => zero LLM tokens)
  const t0 = Date.now();
  const { scanResult } = await scan(materialized, createDefaultScanConfiguration({ enableAiInference: false }));
  const scannerWall = (Date.now() - t0) / 1000;
  const scannerScored = scoreArm(itemsFromScanner(scanResult), gold);
  const scannerArm: ArmResult = {
    arm: "scanner (AI off)",
    repoKey,
    ...scannerScored,
    cost: { usd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, wallSeconds: scannerWall, note: "no LLM calls" },
  };

  // ---- existing identity-key scorer on the scanner, for reference
  const existing = await runBenchmarkRepo(repoKey, {
    scanRepo: (key, root2) => scanRepoByManifestLayers(key, root2, ["components", "data_flows"]),
  });
  const ex = (layer: "components" | "data-flows") => existing.layerScores[layer]?.scores;
  const exLine = (layer: "components" | "data-flows") => {
    const s = ex(layer);
    const f = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);
    return `${layer}: precision ${f(s?.precision)}, recall ${f(s?.recall)}`;
  };

  const arms = [agentArm, scannerArm].filter((a): a is ArmResult => a !== null);
  const md = [
    `# Agent vs scanner pilot: ${repoKey} (${date})`,
    "",
    `Model: \`${model}\` via Pi, thinking=${thinking}. Gold: accepted components ${gold.components.length}, data flows ${gold.flows.length}.`,
    price
      ? `Price: ${price.tier} tier, USD per 1M tokens input ${price.usdPerMillion.short.input} / cached ${price.usdPerMillion.short.cachedInput} / output ${price.usdPerMillion.short.output}; source ${price.sourceUrl}, retrieved ${price.retrievedOn}.`
      : "**PRICE UNKNOWN: dollar cost not computed.**",
    "",
    "## Accuracy and cost side by side",
    "",
    renderComparisonTable(arms),
    "Precision is over items with evidence inside the reviewed scope files; match = same type and overlapping file/line evidence (see score-facts.ts).",
    "",
    renderCounts(arms),
    "## Existing identity-key scorer, scanner only (reference)",
    "",
    `- ${exLine("components")}`,
    `- ${exLine("data-flows")}`,
    "",
    "## Run notes",
    "",
    ...notes.map((n) => `- ${n}`),
    "",
    ...arms.flatMap((a) => [
      `## ${a.arm}: misses and false positives`,
      "",
      `Missed gold components: ${a.components.missedGold.join(" | ") || "none"}`,
      "",
      `False-positive components: ${a.components.falsePositives.join(" | ") || "none"}`,
      "",
      `Missed gold flows: ${a.flows.missedGold.join(" | ") || "none"}`,
      "",
      `False-positive flows: ${a.flows.falsePositives.join(" | ") || "none"}`,
      "",
    ]),
  ].join("\n");

  const outDir = path.join(agentsSrcDir, "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}-pilot.md`), md);
  fs.writeFileSync(
    path.join(outDir, `${date}-pilot.json`),
    `${JSON.stringify({ date, repoKey, model, thinking, price, arms, existingScorerScanner: { components: ex("components"), dataFlows: ex("data-flows") }, notes, usage: summary }, null, 2)}\n`,
  );
  console.log(md.split("## Run notes")[0]);
  console.log(`workspace (not committed): ${root}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
