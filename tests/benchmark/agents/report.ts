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
  requests?: number;
  toolCalls?: number;
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
    "| Repo | Arm | Comp P | Comp R | Flow P | Flow R | Strict comp P / R | Strict flow P / R | Input tok | Cached tok | Output tok | Total cost | Cost / correct comp | Cost / correct flow | Wall time | Requests | Tool calls |\n" +
    "|" + "---|".repeat(17) + "\n";
  const rows = results.map((r) => {
    const c = r.cost;
    return (
      `| ${r.repoKey} | ${r.arm} | ${pct(r.components.precision)} | ${pct(r.components.recall)} | ${pct(r.flows.precision)} | ${pct(r.flows.recall)} ` +
      `| ${pct(r.components.strictPrecision)} / ${pct(r.components.strictRecall)} | ${pct(r.flows.strictPrecision)} / ${pct(r.flows.strictRecall)} ` +
      `| ${c.inputTokens} | ${c.cachedInputTokens} | ${c.outputTokens} | ${usd(c.usd)} ` +
      `| ${per(c.usd, r.components.truePositives)} | ${per(c.usd, r.flows.truePositives)} | ${c.wallSeconds.toFixed(1)}s | ${c.requests ?? "-"} | ${c.toolCalls ?? "-"} |`
    );
  });
  return header + rows.join("\n") + "\n";
}

export function renderCounts(results: ArmResult[]): string {
  const header =
    "| Repo | Arm | Layer | Gold | Items | In scope | Correct (TP, within 10 lines) | Gold found | Strict TP (overlap) |\n|" + "---|".repeat(9) + "\n";
  const rows = results.flatMap((r) =>
    (["components", "flows"] as const).map((layer) => {
      const s = r[layer];
      return `| ${r.repoKey} | ${r.arm} | ${layer} | ${s.goldCount} | ${s.itemCount} | ${s.inScopeCount} | ${s.truePositives} | ${s.goldFound} | ${s.strictTruePositives} |`;
    }),
  );
  return header + rows.join("\n") + "\n";
}
