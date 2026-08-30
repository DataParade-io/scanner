import type { AnnotationRecord, BenchmarkLayer } from "./schema";
import type { LayerFinding } from "../eval/types";

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
  if (IDENTITY_ONLY_LAYERS.has(annotation.layer)) {
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

/**
 * Compute precision for one repo from corpus annotations and scanner findings.
 *
 * Annotations with `expected.exhaustive_scope_files` declare a closed world.
 * Scanner findings in those files that do not match an accepted positive
 * annotation are false positives. A repo that does not use a vendor needs no
 * negative case; extra hits lower precision automatically.
 *
 * Returns precision null when no exhaustive scope is declared.
 */
export function scoreCorpusPrecision(
  annotations: AnnotationRecord[],
  findings: LayerFinding[],
): CorpusPrecisionReport {
  const positives = annotations.filter(
    (annotation) => annotation.expected.status === "positive",
  );

  const scopeFiles = [
    ...new Set(
      positives.flatMap(
        (annotation) => annotation.expected.exhaustive_scope_files ?? [],
      ),
    ),
  ];

  if (scopeFiles.length === 0) {
    return { precision: null, exhaustiveScopedFindings: 0, exhaustiveScopedMatches: 0 };
  }

  let scopedFindings = 0;
  let scopedMatches = 0;

  for (const finding of findings) {
    // Locationless findings are synthetic graph scaffolding (e.g. injected
    // actor:user), not file-level detections. Exclude them from the
    // precision denominator.
    if (!findingInScope(finding, scopeFiles)) {
      continue;
    }
    scopedFindings += 1;
    if (positives.some((annotation) => findingMatchesAnnotation(finding, annotation))) {
      scopedMatches += 1;
    }
  }

  const precision =
    scopedFindings === 0 ? null : scopedMatches / scopedFindings;

  return { precision, exhaustiveScopedFindings: scopedFindings, exhaustiveScopedMatches: scopedMatches };
}
