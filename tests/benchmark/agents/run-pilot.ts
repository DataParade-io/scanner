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

interface RepoRun {
  repoKey: string;
  arms: ArmResult[];
  gold: { components: number; flows: number };
  existing: string[];
  notes: string[];
}

async function runRepo(repoKey: string, opts: { models: string[]; thinking: string; maxCostUsd: number; date: string; tag: string }): Promise<RepoRun> {
  const { models, thinking, maxCostUsd, date, tag } = opts;
  const benchmarkRoot = resolveDefaultBenchmarkRoot();

  const materialized = assertMaterialized(repoKey);
  const gold = loadGold(repoDirFor(benchmarkRoot, repoKey));
  const notes: string[] = [];
  if (gold.skippedFlows) notes.push(`${gold.skippedFlows} accepted gold flow(s) lack flow_canonical endpoints and were skipped.`);

  const agentArms: ArmResult[] = [];
  for (const model of models) {
    const modelId = model.split("/").pop()!;
    const price = loadPrice(path.join(agentsSrcDir, "prices.json"), modelId);
    if (!price) notes.push(`NO PRICE for ${modelId} in prices.json: tokens recorded, dollar cost UNKNOWN.`);
  const { root, repo } = prepareWorkspace(materialized);
  const prompt = fs.readFileSync(path.join(agentsSrcDir, "assignment.md"), "utf8");
  const run = await runPi({
    workspace: repo,
    prompt,
    model,
    thinking,
    transcriptPath: transcriptName(root),
    maxCostUsd,
    timeoutMs: 25 * 60 * 1000,
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
      validation = `valid (${result.facts.components.length} components, ${result.facts.dataFlows.length} flows)`;
      agentArm = {
        arm: `pi + ${modelId} (${thinking})`,
        repoKey,
        ...scoreArm(itemsFromFacts(result.facts), gold),
        cost: {
          usd: costUsd,
          inputTokens: summary.inputTokens,
          cachedInputTokens: summary.cachedInputTokens,
          outputTokens: summary.outputTokens,
          wallSeconds: run.wallSeconds,
          requests: summary.requests,
          toolCalls: summary.toolCalls,
          note: `thinking=${thinking}, ${summary.requests} requests, ${summary.toolCalls} tool calls`,
        },
      };
      fs.copyFileSync(factsPath, path.join(agentsSrcDir, "results", `${date}-${tag}-${repoKey}-${modelId}-facts.json`));
    } else {
      validation = `invalid: ${result.errors.slice(0, 5).join("; ")}`;
    }
  }
  notes.push(`${modelId}: facts.json ${validation}; ${summary.requests} requests, ${summary.toolCalls} tool calls${run.aborted ? "; ABORTED " + run.aborted : ""}`);
    if (agentArm) agentArms.push(agentArm);
  }


  // ---- scanner arm (AI inference off => zero LLM tokens)
  const t0 = Date.now();
  const { scanResult } = await scan(materialized, createDefaultScanConfiguration({ enableAiInference: false }));
  const scannerWall = (Date.now() - t0) / 1000;
  const scannerArm: ArmResult = {
    arm: "scanner (AI off)",
    repoKey,
    ...scoreArm(itemsFromScanner(scanResult), gold),
    cost: { usd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, wallSeconds: scannerWall, note: "no LLM calls" },
  };

  // ---- existing identity-key scorer on the scanner, for reference
  const existing = await runBenchmarkRepo(repoKey, {
    scanRepo: (key, root2) => scanRepoByManifestLayers(key, root2, ["components", "data_flows"]),
  });
  const f = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);
  const exLine = (layer: "components" | "data-flows") => {
    const s = existing.layerScores[layer]?.scores;
    return `${repoKey} ${layer}: precision ${f(s?.precision)}, recall ${f(s?.recall)}`;
  };

  return {
    repoKey,
    arms: [...agentArms, scannerArm],
    gold: { components: gold.components.length, flows: gold.flows.length },
    existing: [exLine("components"), exLine("data-flows")],
    notes: notes.map((n) => `${repoKey}: ${n}`),
  };
}

async function main(): Promise<void> {
  const repoKeys = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (repoKeys.length === 0) throw new Error("usage: run-pilot <repoKey>... [--model m] [--thinking t] [--max-cost usd-per-run]");
  const models = argValue("--models", argValue("--model", "openai/gpt-6-luna")).split(",");
  const tag = argValue("--tag", "pilot");
  const thinking = argValue("--thinking", "low");
  const maxCostUsd = Number(argValue("--max-cost", "1"));
  const date = new Date().toISOString().slice(0, 10);

  const runs: RepoRun[] = [];
  for (const repoKey of repoKeys) runs.push(await runRepo(repoKey, { models, thinking, maxCostUsd, date, tag }));
  const arms = runs.flatMap((r) => r.arms);

  const md = [
    `# Agent vs scanner pilot (${date})`,
    "",
    `Models via Pi: ${models.map((m) => `\`${m}\``).join(", ")}, thinking=${thinking}. Gold (accepted positives): ${runs.map((r) => `${r.repoKey} ${r.gold.components} components / ${r.gold.flows} flows`).join("; ")}.`,
    ...models.map((m) => {
      const price = loadPrice(path.join(agentsSrcDir, "prices.json"), m.split("/").pop()!);
      return price
        ? `Price ${m}: ${price.tier} tier, USD per 1M tokens input ${price.usdPerMillion.short.input} / cached ${price.usdPerMillion.short.cachedInput} / output ${price.usdPerMillion.short.output}; source ${price.sourceUrl}, retrieved ${price.retrievedOn}.`
        : `**PRICE UNKNOWN for ${m}: dollar cost not computed.**`;
    }),
    "",
    "## Accuracy and cost side by side",
    "",
    renderComparisonTable(arms),
    "Match rule: same kind (component type:subType; for flows, the target's type:subType), same file, line ranges within 10 lines (overlap = 0), one-to-one, names only break ties. Precision is over items with evidence inside the reviewed scope files. The strict columns use the same rule with overlap required (0 lines). Cost per correct = total cost divided by in-scope items matched to a gold label.",
    "",
    renderCounts(arms),
    "## Existing identity-key scorer, scanner only (reference)",
    "",
    ...runs.flatMap((r) => r.existing.map((l) => `- ${l}`)),
    "",
    "## Run notes",
    "",
    ...runs.flatMap((r) => r.notes.map((n) => `- ${n}`)),
    "",
    ...arms.flatMap((a) => [
      `## ${a.repoKey} / ${a.arm}: misses and false positives`,
      "",
      `Missed gold components (${a.components.missedGold.length}): ${a.components.missedGold.slice(0, 15).join(" | ") || "none"}`,
      "",
      `False-positive components (${a.components.falsePositives.length}): ${a.components.falsePositives.slice(0, 15).join(" | ") || "none"}`,
      "",
      `Missed gold flows (${a.flows.missedGold.length}): ${a.flows.missedGold.slice(0, 15).join(" | ") || "none"}`,
      "",
      `False-positive flows (${a.flows.falsePositives.length}): ${a.flows.falsePositives.slice(0, 15).join(" | ") || "none"}`,
      "",
    ]),
  ].join("\n");

  const outDir = path.join(agentsSrcDir, "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}-${tag}.md`), md);
  fs.writeFileSync(
    path.join(outDir, `${date}-${tag}.json`),
    `${JSON.stringify({ date, models, thinking, runs }, null, 2)}\n`,
  );
  console.log(md.split("## Existing identity-key")[0]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
