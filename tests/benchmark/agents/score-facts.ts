/**
 * Evidence-based scoring of components and data flows, applied identically to every arm
 * (agent facts.json, scanner output) against the accepted benchmark gold.
 *
 * Match rule: same kind, same file, and line ranges within MATCH_TOLERANCE_LINES of each other
 * (overlap = distance 0). Matching is one-to-one: each gold label is matched at most once and each
 * arm item is used at most once. Candidate pairs are taken closest first; names only break ties
 * between equally close candidates.
 *  - component kind = `type:subType`
 *  - data-flow kind = the TARGET's `type:subType` (what the data lands in). Gold flows carry
 *    flow_canonical endpoints whose source and target kinds are identical, so the source side
 *    carries no information; agent flows may name the data or model as their source.
 * Precision counts only arm items with evidence inside the layer's reviewed exhaustive scope files
 * (layer-scopes.yaml), the closed-world rule the existing scorer uses; out-of-scope items are
 * reported, not penalised. The same algorithm with tolerance 0 gives the strict-overlap numbers,
 * reported as a secondary column. The existing identity-key scorer (tests/eval) is run separately
 * for the scanner as a reference.
 */
import path from "path";

import { normalizeEvalPath } from "../../../src/eval/path";
import { loadAnnotations, loadLayerScopes } from "../manifest";
import type { Facts } from "./facts-schema";

export interface Span {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ScoredItem {
  name: string;
  kind: string;
  flowType?: string;
  evidence: Span[];
}

export interface LayerItems {
  components: ScoredItem[];
  flows: ScoredItem[];
}

export interface MatchPair {
  item: string;
  gold: string;
  distance: number;
  nameMatch: boolean;
}

export interface LayerScore {
  goldCount: number;
  itemCount: number;
  inScopeCount: number;
  outOfScopeCount: number;
  /** In-scope items matched to a gold label (tolerance MATCH_TOLERANCE_LINES). */
  truePositives: number;
  goldFound: number;
  precision: number | null;
  recall: number | null;
  /** Same algorithm, but evidence must overlap (tolerance 0). */
  strictTruePositives: number;
  strictPrecision: number | null;
  strictRecall: number | null;
  falsePositives: string[];
  missedGold: string[];
  pairs: MatchPair[];
}

export const MATCH_TOLERANCE_LINES = 10;

const norm = (p: string): string => normalizeEvalPath(p);

function spanDistance(a: Span, b: Span): number {
  if (norm(a.filePath) !== norm(b.filePath)) return Infinity;
  return Math.max(a.startLine - b.endLine, b.startLine - a.endLine, 0);
}

function itemDistance(a: ScoredItem, b: ScoredItem): number {
  let best = Infinity;
  for (const x of a.evidence) for (const y of b.evidence) best = Math.min(best, spanDistance(x, y));
  return best;
}

function sameName(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean(a) === clean(b) && clean(a).length > 0;
}

function rate(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

const describe = (item: ScoredItem): string =>
  `${item.kind} "${item.name}" @ ${item.evidence.map((e) => `${e.filePath}:${e.startLine}-${e.endLine}`).join(", ")}`;

/** One-to-one matching, closest first, names break ties. Returns item index -> gold index. */
export function matchOneToOne(items: ScoredItem[], gold: ScoredItem[], tolerance: number): Map<number, number> {
  const candidates: Array<{ i: number; j: number; distance: number; name: boolean }> = [];
  items.forEach((item, i) =>
    gold.forEach((g, j) => {
      if (item.kind !== g.kind) return;
      const distance = itemDistance(item, g);
      if (distance <= tolerance) candidates.push({ i, j, distance, name: sameName(item.name, g.name) });
    }),
  );
  candidates.sort((a, b) => a.distance - b.distance || Number(b.name) - Number(a.name) || a.i - b.i || a.j - b.j);
  const result = new Map<number, number>();
  const usedGold = new Set<number>();
  for (const c of candidates) {
    if (result.has(c.i) || usedGold.has(c.j)) continue;
    result.set(c.i, c.j);
    usedGold.add(c.j);
  }
  return result;
}

export function scoreLayer(items: ScoredItem[], gold: ScoredItem[], scopeFiles: string[]): LayerScore {
  const scope = new Set(scopeFiles.map(norm));
  const inScope = items.map((item) => item.evidence.some((e) => scope.has(norm(e.filePath))));
  const inScopeCount = inScope.filter(Boolean).length;

  const loose = matchOneToOne(items, gold, MATCH_TOLERANCE_LINES);
  const strict = matchOneToOne(items, gold, 0);
  const tpOf = (m: Map<number, number>) => [...m.keys()].filter((i) => inScope[i]).length;
  const tp = tpOf(loose);
  const strictTp = tpOf(strict);
  const foundGold = new Set(loose.values());

  const pairs: MatchPair[] = [...loose.entries()].map(([i, j]) => ({
    item: describe(items[i]),
    gold: describe(gold[j]),
    distance: itemDistance(items[i], gold[j]),
    nameMatch: sameName(items[i].name, gold[j].name),
  }));

  return {
    goldCount: gold.length,
    itemCount: items.length,
    inScopeCount,
    outOfScopeCount: items.length - inScopeCount,
    truePositives: tp,
    goldFound: foundGold.size,
    precision: rate(tp, inScopeCount),
    recall: rate(foundGold.size, gold.length),
    strictTruePositives: strictTp,
    strictPrecision: rate(strictTp, inScopeCount),
    strictRecall: rate(new Set(strict.values()).size, gold.length),
    falsePositives: items.filter((_, i) => inScope[i] && !loose.has(i)).map(describe),
    missedGold: gold.filter((_, j) => !foundGold.has(j)).map(describe),
    pairs,
  };
}

// ---- gold -----------------------------------------------------------------------------------

export interface GoldSet extends LayerItems {
  componentScopeFiles: string[];
  flowScopeFiles: string[];
  skippedFlows: number;
}

const kindOf = (type: string, sub?: string): string => `${type}:${sub ?? ""}`;

export function loadGold(repoDir: string): GoldSet {
  const accepted = (layer: string) =>
    loadAnnotations(repoDir, layer).filter(
      (a) => a.provenance.review_state === "accepted" && a.expected.status === "positive",
    );
  const evidenceOf = (a: { evidence: { file_path: string; start_line: number; end_line: number } }): Span[] => [
    { filePath: a.evidence.file_path, startLine: a.evidence.start_line, endLine: a.evidence.end_line },
  ];
  const components = accepted("components").map((a) => ({
    name: a.subject.name ?? a.subject.key,
    kind: kindOf(a.canonical?.component_type ?? a.subject.key.split(":")[0], a.canonical?.component_subtype ?? a.subject.key.split(":")[1]),
    evidence: evidenceOf(a),
  }));
  let skippedFlows = 0;
  const flows: ScoredItem[] = [];
  for (const a of accepted("data_flows")) {
    const fc = a.flow_canonical;
    if (!fc) {
      skippedFlows += 1;
      continue;
    }
    const { target } = fc.endpoints;
    flows.push({
      name: a.subject.name ?? a.subject.key,
      kind: kindOf(target.component_type, target.component_subtype),
      flowType: fc.flow_type,
      evidence: evidenceOf(a),
    });
  }
  const scopes = loadLayerScopes(repoDir);
  return {
    components,
    flows,
    componentScopeFiles: scopes.get("components")?.exhaustive_scope_files ?? [],
    flowScopeFiles: scopes.get("data_flows")?.exhaustive_scope_files ?? [],
    skippedFlows,
  };
}

// ---- arms -----------------------------------------------------------------------------------

export function itemsFromFacts(facts: Facts): LayerItems {
  const byName = new Map(facts.components.map((c) => [c.name, c]));
  return {
    components: facts.components.map((c) => ({ name: c.name, kind: kindOf(c.type, c.subType), evidence: c.evidence })),
    flows: facts.dataFlows.map((f) => {
      const t = byName.get(f.target);
      return {
        name: `${f.source} -> ${f.target}`,
        kind: kindOf(t?.type ?? "?", t?.subType),
        flowType: f.type,
        evidence: f.evidence,
      };
    }),
  };
}

interface ScannerLike {
  components: Array<{ id: string; name: string; type: string; subType?: string; sourceLocations: Array<{ filePath: string; startLine: number; endLine: number }> }>;
  dataFlows: Array<{
    sourceComponentId: string;
    targetComponentId: string;
    type: string;
    description?: string;
    sourceLocation?: { filePath: string; startLine: number; endLine: number };
    sourceLocations?: Array<{ filePath: string; startLine: number; endLine: number }>;
  }>;
}

export function itemsFromScanner(scan: ScannerLike): LayerItems {
  const byId = new Map(scan.components.map((c) => [c.id, c]));
  return {
    components: scan.components.map((c) => ({
      name: c.name,
      kind: kindOf(c.type, c.subType),
      evidence: c.sourceLocations.map((l) => ({ filePath: l.filePath, startLine: l.startLine, endLine: l.endLine })),
    })),
    flows: scan.dataFlows.map((f) => {
      const s = byId.get(f.sourceComponentId);
      const t = byId.get(f.targetComponentId);
      const locations = f.sourceLocations?.length ? f.sourceLocations : f.sourceLocation ? [f.sourceLocation] : [];
      return {
        name: `${s?.name ?? "?"} -> ${t?.name ?? "?"}`,
        kind: kindOf(t?.type ?? "?", t?.subType),
        flowType: f.type,
        evidence: locations.map((l) => ({ filePath: l.filePath, startLine: l.startLine, endLine: l.endLine })),
      };
    }),
  };
}

export function scoreArm(items: LayerItems, gold: GoldSet): { components: LayerScore; flows: LayerScore } {
  return {
    components: scoreLayer(items.components, gold.components, gold.componentScopeFiles),
    flows: scoreLayer(items.flows, gold.flows, gold.flowScopeFiles),
  };
}

export const repoDirFor = (benchmarkRoot: string, repoKey: string): string => path.join(benchmarkRoot, "repos", repoKey);
