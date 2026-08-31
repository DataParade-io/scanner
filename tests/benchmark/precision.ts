import type { AnnotationRecord, BenchmarkLayer, LayerScopeRecord } from "./schema";
import { normalizeBenchmarkLayer } from "./schema";
import type { EvalLayer, LayerFinding } from "../eval/types";
import { findingsForCaseLayer } from "../eval/identity";

export interface CorpusPrecisionReport {
  precision: number | null;
  exhaustiveScopedFindings: number;
  exhaustiveScopedMatches: number;
}

function lineRangesOverlap(
  a: { start_line: number; end_line: number },
  b: { start_line: number; end_line: number },
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

function evidenceOverlaps(
  evidence: { file_path: string; start_line: number; end_line: number },
  sourceLine: { file_path: string; start_line: number; end_line: number },
): boolean {
  return (
    evidence.file_path === sourceLine.file_path &&
    lineRangesOverlap(evidence, sourceLine)
  );
}

const IDENTITY_ONLY_LAYERS: ReadonlySet<BenchmarkLayer> = new Set(["data_items"]);

function findingMatchesAnnotation(
  finding: LayerFinding,
  annotation: AnnotationRecord,
): boolean {
  if (finding.key !== annotation.subject.key) {
    return false;
  }
  if (IDENTITY_ONLY_LAYERS.has(normalizeBenchmarkLayer(annotation.layer))) {
    return true;
  }
  return finding.sourceLines.some((line) =>
    evidenceOverlaps(annotation.evidence, line),
  );
}

function findingInScope(finding: LayerFinding, scopeFiles: string[]): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  return finding.sourceFilePaths.some((filePath) => scopeFiles.includes(filePath));
}

function benchmarkLayerToEvalLayer(layer: BenchmarkLayer): EvalLayer {
  const canonical = normalizeBenchmarkLayer(layer);
  switch (canonical) {
    case "components":
      return "components";
    case "data_flows":
      return "data-flows";
    case "raw_hits":
      return "raw-hits";
    case "mentions":
    case "pii_signals":
      return "mentions";
    case "data_items":
      return "data-items";
    default: {
      const _exhaustive: never = canonical;
      throw new Error(`Unsupported benchmark layer '${layer}'`);
    }
  }
}

export function collectExhaustiveScopesByLayer(
  layerScopes: Map<BenchmarkLayer, LayerScopeRecord>,
): Map<BenchmarkLayer, string[]> {
  const scopes = new Map<BenchmarkLayer, string[]>();
  for (const [layer, record] of layerScopes) {
    if (record.provenance.review_state !== "accepted") {
      continue;
    }
    if (record.exhaustive_scope_files.length === 0) {
      continue;
    }
    scopes.set(normalizeBenchmarkLayer(layer), [...record.exhaustive_scope_files]);
  }
  return scopes;
}

function positivesByLayer(positives: AnnotationRecord[]): Map<BenchmarkLayer, AnnotationRecord[]> {
  const byLayer = new Map<BenchmarkLayer, AnnotationRecord[]>();
  for (const annotation of positives) {
    const layer = normalizeBenchmarkLayer(annotation.layer);
    const layerPositives = byLayer.get(layer) ?? [];
    layerPositives.push(annotation);
    byLayer.set(layer, layerPositives);
  }
  return byLayer;
}

/**
 * Compute precision for one repo from corpus annotations and scanner findings.
 *
 * Reviewed layer scopes in `layer-scopes.yaml` declare a closed world per layer.
 * Scanner findings in those files that do not match a positive annotation are
 * false positives. A repo that does not use a vendor needs no negative case;
 * extra hits lower precision automatically.
 *
 * Returns precision null when no accepted exhaustive scope is declared.
 */
export function scoreCorpusPrecision(
  annotations: AnnotationRecord[],
  findings: LayerFinding[],
  layerScopes: Map<BenchmarkLayer, LayerScopeRecord>,
): CorpusPrecisionReport {
  const positives = annotations.filter(
    (annotation) => annotation.expected.status === "positive",
  );

  const scopesByLayer = collectExhaustiveScopesByLayer(layerScopes);
  if (scopesByLayer.size === 0) {
    return { precision: null, exhaustiveScopedFindings: 0, exhaustiveScopedMatches: 0 };
  }

  const positivesByLayerMap = positivesByLayer(positives);
  let scopedFindings = 0;
  let scopedMatches = 0;

  for (const [layer, scopeFiles] of scopesByLayer) {
    const evalLayer = benchmarkLayerToEvalLayer(layer);
    const layerPositives = positivesByLayerMap.get(layer) ?? [];
    for (const finding of findingsForCaseLayer(findings, evalLayer)) {
      if (!findingInScope(finding, scopeFiles)) {
        continue;
      }
      scopedFindings += 1;
      if (layerPositives.some((annotation) => findingMatchesAnnotation(finding, annotation))) {
        scopedMatches += 1;
      }
    }
  }

  const precision =
    scopedFindings === 0 ? null : scopedMatches / scopedFindings;

  return { precision, exhaustiveScopedFindings: scopedFindings, exhaustiveScopedMatches: scopedMatches };
}
