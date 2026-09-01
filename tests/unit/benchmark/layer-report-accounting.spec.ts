import type { EvalCase, EvalScoreReport, FixtureScanResult } from "../../eval/types";
import { computeMetricComputability } from "../../eval/canonical/computability";
import { createLayerLedger } from "../../eval/eligibility/types";
import { layerOutcome } from "../../../src/ingest/eligibility";
import type { CanonicalGoldExpectation } from "../../eval/canonical/types";
import type { HeadlineLayer } from "../../eval/score";
import {
  aggregateLayerReportAccounting,
  buildLayerReportAccounting,
  resolveGateExceptions,
  type PacketCanonicalRecordWithDiagnostics,
} from "../../benchmark/layer-report-accounting";

const FIXTURE = "packet-a";

function acceptedRecord(
  layer: HeadlineLayer,
  id: string,
): PacketCanonicalRecordWithDiagnostics {
  const canonicalLayer: CanonicalGoldExpectation["identity"]["layer"] =
    layer === "data-items" ? "data-items" : layer;
  return {
    id,
    headlineLayer: layer,
    conversions: [],
    record: {
      contractVersion: "1.0.0",
      adapterMapVersion: "fixture-adapter-map",
      identity: { layer: canonicalLayer, identityKey: `${layer}:${id}` },
      classification: {
        conceptLeaf: "email_address",
        conceptAncestry: ["contact", "email_address"],
      },
      evidenceLocations: [{ file_path: "src/app.ts", start_line: 1, end_line: 1 }],
      disposition: "accepted",
      declaredCapabilitySupported: { supported: true },
    },
  };
}

function migrationRecord(id: string): PacketCanonicalRecordWithDiagnostics {
  return {
    id,
    headlineLayer: "mentions",
    conversions: ["legacy_subject_name"],
    record: {
      contractVersion: "1.0.0",
      adapterMapVersion: "fixture-adapter-map",
      identity: { layer: "mentions", identityKey: `mention:${id}` },
      classification: { conceptLeaf: "", conceptAncestry: [] },
      evidenceLocations: [{ file_path: "src/legacy.ts", start_line: 1, end_line: 1 }],
      disposition: "migration_incomplete",
    },
  };
}

function evalCase(id: string, status: EvalCase["expected"]["status"] = "positive"): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer: "mentions",
    subject: { key: `mention:${id}` },
    evidence: { file_path: "src/app.ts", start_line: 1, end_line: 1 },
    expected: { status, labels: ["mention"] },
    rationale: "test",
  };
}

function report(partial: {
  evaluablePositives: number;
  matchedPositives: number;
  unreadCount?: number;
  negativeCases?: number;
}): EvalScoreReport {
  const denominators = {
    evaluablePositives: partial.evaluablePositives,
    matchedPositives: partial.matchedPositives,
    matchedWithCorrectLabels: partial.matchedPositives,
    matchedAncestorCategory: 0,
    negativeCases: partial.negativeCases ?? 0,
    negativeCasesPassed: 0,
    exhaustiveScopedFindings: 1,
    exhaustiveScopedMatches: 1,
  };
  return {
    scores: {
      recall:
        partial.evaluablePositives === 0
          ? null
          : partial.matchedPositives / partial.evaluablePositives,
      ancestorCategoryRecall: null,
      labelAccuracy: 1,
      correctLabelRecall:
        partial.evaluablePositives === 0
          ? null
          : partial.matchedPositives / partial.evaluablePositives,
      precision: 1,
      negativeCasePassRate: null,
      unreadCount: partial.unreadCount ?? 0,
      denominators,
      metricComputability: computeMetricComputability({
        layer: "mentions",
        denominators,
        scope: { reviewedScopeFileCount: 1, processedScopeFileCount: 1 },
        recall: 1,
        precision: 1,
        negativeCasePassRate: null,
        positiveCaseCount: partial.evaluablePositives,
        unreadPositiveCount: 0,
        negativeCaseCount: partial.negativeCases ?? 0,
        unreadNegativeCount: 0,
        locationlessFindingCount: 0,
      }),
    },
    caseResults: [],
  };
}

function scanResult(): FixtureScanResult {
  return {
    fixture: FIXTURE,
    findings: [
      {
        key: "mention:hit",
        labels: ["mention"],
        layer: "mentions",
        sourceFilePaths: ["src/app.ts"],
        sourceLines: [{ file_path: "src/app.ts", start_line: 1, end_line: 1 }],
      },
    ],
    scannedFiles: ["src/app.ts"],
    eligibilityLedgers: {
      mentions: createLayerLedger("mentions", [
        layerOutcome("src/app.ts", "successfully_processed"),
        layerOutcome("src/blocked.ts", "unsupported_file_type_or_language"),
      ]),
    },
  };
}

describe("layer-report-accounting", () => {
  it("counts accepted canonical positives separately from migration-incomplete rows", () => {
    const accounting = buildLayerReportAccounting({
      layer: "mentions",
      report: report({ evaluablePositives: 2, matchedPositives: 1 }),
      cases: [evalCase("a1"), evalCase("a2")],
      scanResult: scanResult(),
      canonicalRecords: [acceptedRecord("mentions", "a1"), migrationRecord("legacy-1")],
      gate: { status: "scorable" },
      computability: {
        metrics: { recall: { state: "computable" } },
        locationlessFindingCount: 0,
      },
    });

    expect(accounting.population.acceptedCanonicalPositives).toBe(1);
    expect(accounting.population.evaluablePositives).toBe(2);
    expect(accounting.migrationIncomplete.total).toBe(1);
    expect(accounting.migrationIncomplete.byReason.source_token_only).toBe(1);
  });

  it("computes unread rate over accepted canonical positives plus negative cases", () => {
    const accounting = buildLayerReportAccounting({
      layer: "mentions",
      report: report({
        evaluablePositives: 1,
        matchedPositives: 1,
        unreadCount: 1,
        negativeCases: 1,
      }),
      cases: [evalCase("a1"), evalCase("n1", "negative")],
      scanResult: scanResult(),
      canonicalRecords: [acceptedRecord("mentions", "a1")],
      gate: { status: "scorable" },
      computability: {
        metrics: { recall: { state: "computable" } },
        locationlessFindingCount: 0,
      },
    });

    expect(accounting.population.unreadRate).toBe(0.5);
  });

  it("pools denominators across packets when aggregating accounting", () => {
    const first = buildLayerReportAccounting({
      layer: "mentions",
      report: report({ evaluablePositives: 2, matchedPositives: 1 }),
      cases: [evalCase("a1"), evalCase("a2")],
      scanResult: scanResult(),
      canonicalRecords: [acceptedRecord("mentions", "a1"), acceptedRecord("mentions", "a2")],
      gate: { status: "scorable" },
      computability: {
        metrics: { recall: { state: "computable" } },
        locationlessFindingCount: 0,
      },
    });
    const second = buildLayerReportAccounting({
      layer: "mentions",
      report: report({ evaluablePositives: 2, matchedPositives: 1 }),
      cases: [evalCase("b1"), evalCase("b2")],
      scanResult: scanResult(),
      canonicalRecords: [acceptedRecord("mentions", "b1"), acceptedRecord("mentions", "b2")],
      gate: { status: "scorable" },
      computability: {
        metrics: { recall: { state: "computable" } },
        locationlessFindingCount: 0,
      },
    });

    const aggregated = aggregateLayerReportAccounting([first, second]);
    expect(aggregated.population.evaluablePositives).toBe(4);
    expect(aggregated.population.matchedPositives).toBe(2);
    expect(aggregated.population.acceptedCanonicalPositives).toBe(4);
  });

  it("keeps capability slice diagnostic without changing recall denominator", () => {
    const accounting = buildLayerReportAccounting({
      layer: "mentions",
      report: report({ evaluablePositives: 2, matchedPositives: 1 }),
      cases: [evalCase("a1"), evalCase("a2")],
      scanResult: scanResult(),
      canonicalRecords: [
        acceptedRecord("mentions", "a1"),
        {
          ...acceptedRecord("mentions", "a2"),
          record: {
            ...acceptedRecord("mentions", "a2").record,
            declaredCapabilitySupported: { supported: false, reason: "unsupported" },
          },
        },
      ],
      gate: { status: "scorable" },
      computability: {
        metrics: { recall: { state: "computable" } },
        locationlessFindingCount: 0,
      },
    });

    expect(accounting.slices.capability.disclaimer).toBe("diagnostic_only_not_recall_denominator");
    expect(accounting.slices.capability.supportedCount).toBe(1);
    expect(accounting.population.evaluablePositives).toBe(2);
  });

  it("records gate exceptions when pending gate has computable precision", () => {
    const exceptions = resolveGateExceptions(
      { status: "pending", reason: "awaiting_canonical_flow_adjudication" },
      {
        metrics: {
          recall: { state: "migration_incomplete_or_not_ready" },
          precision: { state: "computable" },
        },
        locationlessFindingCount: 0,
      },
    );

    expect(exceptions.some((entry) => entry.code === "precision_computable_while_pending")).toBe(
      true,
    );
  });
});
