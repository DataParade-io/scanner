/**
 * Evidence-based scoring of components and data flows, applied identically to every arm
 * (agent facts.json, scanner output) against the accepted benchmark gold.
 *
 * Match rule: same kind AND overlapping file/line evidence.
 *  - component kind = `type:subType`
 *  - data-flow kind = `<source type:subType>-><target type:subType>` (names are resolved through
 *    the same arm's components; gold uses flow_canonical endpoints)
 * Names are only used to pick the primary pairing shown in the match detail; they never create
 * or block a match. Matching is many-to-many: a gold item is found if any item of the arm matches
 * it, and an arm item is correct if it matches any gold item. Precision counts only arm items
 * with evidence inside the layer's reviewed exhaustive scope files (layer-scopes.yaml), the same
 * closed-world rule the existing scorer uses; out-of-scope items are reported, not penalised.
 *
 * This differs from the existing identity-key scorer (tests/eval), which matches on
 * canonical identity keys; both are reported for the scanner so the difference is visible.
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
  nameMatch: boolean;
}

export interface LayerScore {
  goldCount: number;
  itemCount: number;
  inScopeCount: number;
  outOfScopeCount: number;
  truePositives: number;
  goldFound: number;
  precision: number | null;
  recall: number | null;
  /** Same, but evidence only has to be in the same file (diagnostic for evidence strictness). */
  relaxedPrecision: number | null;
  relaxedRecall: number | null;
  falsePositives: string[];
  missedGold: string[];
  pairs: MatchPair[];
}

const norm = (p: string): string => normalizeEvalPath(p);

function spansOverlap(a: Span, b: Span): boolean {
  return norm(a.filePath) === norm(b.filePath) && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function sameFile(a: Span, b: Span): boolean {
  return norm(a.filePath) === norm(b.filePath);
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

export function scoreLayer(items: ScoredItem[], gold: ScoredItem[], scopeFiles: string[]): LayerScore {
  const scope = new Set(scopeFiles.map(norm));
  const inScope = items.filter((item) => item.evidence.some((e) => scope.has(norm(e.filePath))));
  const matches = (item: ScoredItem, g: ScoredItem, strict: boolean): boolean =>
    item.kind === g.kind &&
    item.evidence.some((a) => g.evidence.some((b) => (strict ? spansOverlap(a, b) : sameFile(a, b))));

  const pairs: MatchPair[] = [];
  const goldFoundSet = new Set<ScoredItem>();
  const goldFoundRelaxed = new Set<ScoredItem>();
  let tp = 0;
  let tpRelaxed = 0;
  const falsePositives: string[] = [];
  for (const item of inScope) {
    const hits = gold.filter((g) => matches(item, g, true));
    hits.forEach((g) => goldFoundSet.add(g));
    if (hits.length > 0) {
      tp += 1;
      const best = hits.find((g) => sameName(item.name, g.name)) ?? hits[0];
      pairs.push({ item: describe(item), gold: describe(best), nameMatch: sameName(item.name, best.name) });
    } else {
      falsePositives.push(describe(item));
    }
    const relaxedHits = gold.filter((g) => matches(item, g, false));
    relaxedHits.forEach((g) => goldFoundRelaxed.add(g));
    if (relaxedHits.length > 0) tpRelaxed += 1;
  }
  // Gold found by out-of-scope items still counts for recall.
  for (const item of items) {
    if (inScope.includes(item)) continue;
    gold.filter((g) => matches(item, g, true)).forEach((g) => goldFoundSet.add(g));
    gold.filter((g) => matches(item, g, false)).forEach((g) => goldFoundRelaxed.add(g));
  }

  return {
    goldCount: gold.length,
    itemCount: items.length,
    inScopeCount: inScope.length,
    outOfScopeCount: items.length - inScope.length,
    truePositives: tp,
    goldFound: goldFoundSet.size,
    precision: rate(tp, inScope.length),
    recall: rate(goldFoundSet.size, gold.length),
    relaxedPrecision: rate(tpRelaxed, inScope.length),
    relaxedRecall: rate(goldFoundRelaxed.size, gold.length),
    falsePositives,
    missedGold: gold.filter((g) => !goldFoundSet.has(g)).map(describe),
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
    const { source, target } = fc.endpoints;
    flows.push({
      name: a.subject.name ?? a.subject.key,
      kind: `${kindOf(source.component_type, source.component_subtype)}->${kindOf(target.component_type, target.component_subtype)}`,
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
      const s = byName.get(f.source);
      const t = byName.get(f.target);
      return {
        name: `${f.source} -> ${f.target}`,
        kind: `${kindOf(s?.type ?? "?", s?.subType)}->${kindOf(t?.type ?? "?", t?.subType)}`,
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
        kind: `${kindOf(s?.type ?? "?", s?.subType)}->${kindOf(t?.type ?? "?", t?.subType)}`,
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
