import { strictCorrectness } from "./match";
import type {
  AcceptedCanonicalGoldExpectation,
  CanonicalGoldExpectation,
  CanonicalScannerFinding,
  DeclaredCapabilityCoverage,
  DeclaredCapabilitySupported,
} from "./types";
import { isAcceptedEvaluablePositive as isAccepted } from "./types";

export interface StrictRecallResult {
  denominator: number;
  matched: number;
  falseNegatives: number;
  falseNegativeIds: string[];
}

export interface VendorResolutionMetrics {
  denominator: number;
  matched: number;
}

export interface CapabilityCoverageResult {
  recall: StrictRecallResult;
  capabilityCoverage: DeclaredCapabilityCoverage;
}

export interface BaselineMetricsResult {
  strictRecall: StrictRecallResult;
  migrationIncompleteCount: number;
  baselineFalseNegativeCount: number;
}

function assertsVendor(record: CanonicalGoldExpectation): boolean {
  return record.optionalAssertion?.vendor !== undefined;
}

export function acceptedEvaluablePositives(
  records: CanonicalGoldExpectation[],
): AcceptedCanonicalGoldExpectation[] {
  return records.filter(isAccepted);
}

export function computeStrictRecall(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): StrictRecallResult {
  const positives = expectations.filter(isAccepted);
  const denominator = positives.length;
  const falseNegativeIds: string[] = [];
  let matched = 0;

  for (const expectation of positives) {
    const hasMatch = findings.some((finding) => strictCorrectness(expectation, finding));
    if (hasMatch) {
      matched += 1;
    } else {
      falseNegativeIds.push(expectation.id);
    }
  }

  return {
    denominator,
    matched,
    falseNegatives: falseNegativeIds.length,
    falseNegativeIds,
  };
}

export function computeVendorResolution(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): VendorResolutionMetrics {
  const vendorAsserting = expectations.filter(
    (record) => isAccepted(record) && assertsVendor(record),
  );
  const denominator = vendorAsserting.length;
  let matched = 0;

  for (const expectation of vendorAsserting) {
    if (findings.some((finding) => strictCorrectness(expectation, finding))) {
      matched += 1;
    }
  }

  return { denominator, matched };
}

export function computeCapabilityCoverage(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): CapabilityCoverageResult {
  const recall = computeStrictRecall(expectations, findings);
  const positives = expectations.filter(isAccepted);
  const supported = positives.filter(
    (record) => record.declaredCapabilitySupported?.supported === true,
  );
  const distinctLeaves = new Set(
    positives.map((record) => record.classification.conceptLeaf),
  );
  const supportedLeaves = new Set(
    supported.map((record) => record.classification.conceptLeaf),
  );

  return {
    recall,
    capabilityCoverage: {
      caseWeighted: positives.length === 0 ? 0 : supported.length / positives.length,
      distinctLeaf:
        distinctLeaves.size === 0 ? 0 : supportedLeaves.size / distinctLeaves.size,
    },
  };
}

export function computeBaselineMetrics(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): BaselineMetricsResult {
  const strictRecall = computeStrictRecall(expectations, findings);
  const migrationIncompleteCount = expectations.filter(
    (record) => record.disposition === "migration_incomplete",
  ).length;

  return {
    strictRecall,
    migrationIncompleteCount,
    baselineFalseNegativeCount: strictRecall.falseNegatives,
  };
}

export function declaredCapabilityUnsupported(
  record: CanonicalGoldExpectation,
): DeclaredCapabilitySupported {
  return (
    record.declaredCapabilitySupported ?? {
      supported: false,
      reason: "no declared detector support",
    }
  );
}

export interface EvidenceCoverageResult {
  entityRecallDenominator: number;
  entityRecallMatched: number;
  evidenceLocationCount: number;
  evidenceLocationsCovered: number;
}

export function computeEvidenceCoverage(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): EvidenceCoverageResult {
  const consolidated = expectations.filter(isAccepted);
  const entityRecallDenominator = consolidated.length;
  let entityRecallMatched = 0;
  let evidenceLocationCount = 0;
  let evidenceLocationsCovered = 0;

  for (const expectation of consolidated) {
    evidenceLocationCount += expectation.evidenceLocations.length;
    const matchedFinding = findings.find((finding) =>
      strictCorrectness(expectation, finding),
    );
    if (matchedFinding) {
      entityRecallMatched += 1;
      evidenceLocationsCovered += expectation.evidenceLocations.length;
    }
  }

  return {
    entityRecallDenominator,
    entityRecallMatched,
    evidenceLocationCount,
    evidenceLocationsCovered,
  };
}
