import { graphStrictCorrectness } from "./match";
import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "../types";
import type {
  ComputabilityReason,
  GraphLayerScope,
  GraphPrecisionItem,
  GraphPrecisionReport,
} from "./types";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function findingHasLocations(
  finding: CanonicalScannerFinding,
): boolean {
  return finding.evidenceLocations.length > 0;
}

function findingSourcePaths(finding: CanonicalScannerFinding): string[] {
  return finding.evidenceLocations.map((location) => normalizePath(location.file_path));
}

function findingInScope(finding: CanonicalScannerFinding, scopeFiles: readonly string[]): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  const normalizedScope = new Set(scopeFiles.map(normalizePath));
  return findingSourcePaths(finding).some((filePath) => normalizedScope.has(filePath));
}

function findingMatchesPositive(
  finding: CanonicalScannerFinding & { id: string },
  positives: Array<CanonicalGoldExpectation & { id: string }>,
): boolean {
  return positives.some((positive) => graphStrictCorrectness(positive, finding));
}

/**
 * Closed-world graph precision using reviewed layer scopes.
 * Locationless findings remain visible with computability reasons but are excluded
 * from the precision denominator.
 */
export function computeGraphPrecision(
  findings: Array<CanonicalScannerFinding & { id: string }>,
  positives: Array<CanonicalGoldExpectation & { id: string }>,
  layerScopes: Map<string, GraphLayerScope>,
): GraphPrecisionReport {
  const acceptedScopes = [...layerScopes.entries()].filter(
    ([, scope]) =>
      scope.reviewState === "accepted" && scope.exhaustiveScopeFiles.length > 0,
  );

  if (acceptedScopes.length === 0) {
    return {
      items: [],
      denominator: 0,
      matches: 0,
      precision: null,
      locationlessVisible: [],
      computabilityReason: "no_exhaustive_scope",
    };
  }

  const scopeFiles = new Set<string>();
  for (const [, scope] of acceptedScopes) {
    for (const file of scope.exhaustiveScopeFiles) {
      scopeFiles.add(normalizePath(file));
    }
  }

  const items: GraphPrecisionItem[] = [];
  const locationlessVisible: Array<{ findingId: string; reason: ComputabilityReason }> = [];
  let denominator = 0;
  let matches = 0;

  for (const finding of findings) {
    if (!findingHasLocations(finding)) {
      const reason: ComputabilityReason = "locationless_finding";
      items.push({
        findingId: finding.id,
        inDenominator: false,
        matched: false,
        computabilityReason: reason,
      });
      locationlessVisible.push({ findingId: finding.id, reason });
      continue;
    }

    if (!findingInScope(finding, [...scopeFiles])) {
      items.push({
        findingId: finding.id,
        inDenominator: false,
        matched: false,
        computabilityReason: "finding_outside_scope",
      });
      continue;
    }

    denominator += 1;
    const matched = findingMatchesPositive(finding, positives);
    if (matched) {
      matches += 1;
    }
    items.push({
      findingId: finding.id,
      inDenominator: true,
      matched,
    });
  }

  return {
    items,
    denominator,
    matches,
    precision: denominator === 0 ? null : matches / denominator,
    locationlessVisible,
  };
}
