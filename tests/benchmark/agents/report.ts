/**
 * Arm results and the side-by-side accuracy + cost table. One ArmResult per (arm, model, repo);
 * adding another agent or model is adding another row, nothing else changes.
 */
import type { LayerScore } from "./score-facts";

export interface ArmCost {
  /** null = price unknown; tokens are still recorded. */
  usd: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  wallSeconds: number;
  note?: string;
}

export interface ArmResult {
  arm: string; // e.g. "pi + gpt-6-luna", "scanner (no AI)"
  repoKey: string;
  components: LayerScore;
  flows: LayerScore;
  cost: ArmCost;
}

const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
const usd = (v: number | null, digits = 4): string => (v === null ? "UNKNOWN" : `$${v.toFixed(digits)}`);
const per = (cost: number | null, n: number): string =>
  cost === null ? "n/a" : n === 0 ? "n/a (0 correct)" : usd(cost / n, 5);

export function renderComparisonTable(results: ArmResult[]): string {
  const header =
    "| Arm | Comp P | Comp R | Flow P | Flow R | Input tok | Cached tok | Output tok | Total cost | Cost / correct comp | Cost / correct flow | Wall time |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  const rows = results.map((r) => {
    const c = r.cost;
    return (
      `| ${r.arm} | ${pct(r.components.precision)} | ${pct(r.components.recall)} | ${pct(r.flows.precision)} | ${pct(r.flows.recall)} ` +
      `| ${c.inputTokens} | ${c.cachedInputTokens} | ${c.outputTokens} | ${usd(c.usd)} ` +
      `| ${per(c.usd, r.components.truePositives)} | ${per(c.usd, r.flows.truePositives)} | ${c.wallSeconds.toFixed(1)}s |`
    );
  });
  return header + rows.join("\n") + "\n";
}

export function renderCounts(results: ArmResult[]): string {
  const header =
    "| Arm | Layer | Gold | Items | In scope | Correct (TP) | Gold found | Relaxed P (same file) | Relaxed R (same file) |\n|---|---|---|---|---|---|---|---|---|\n";
  const rows = results.flatMap((r) =>
    (["components", "flows"] as const).map((layer) => {
      const s = r[layer];
      return `| ${r.arm} | ${layer} | ${s.goldCount} | ${s.itemCount} | ${s.inScopeCount} | ${s.truePositives} | ${s.goldFound} | ${pct(s.relaxedPrecision)} | ${pct(s.relaxedRecall)} |`;
    }),
  );
  return header + rows.join("\n") + "\n";
}
