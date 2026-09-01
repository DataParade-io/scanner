import path from "path";

import type { EligibilityReason } from "../../src/ingest/eligibility";
import { computeCapabilityCoverage } from "../../src/eval/canonical/metrics";
import type { CanonicalGoldExpectation } from "../../src/eval/canonical/types";
import { isAcceptedEvaluablePositive } from "../../src/eval/canonical/types";
import type { ConversionKind } from "../eval/canonical/compat/types";
import { isEvalPathContractValid, normalizeEvalPath } from "../../src/eval/path";
import {
  getLayerLedger,
  isPathSuccessfullyProcessed,
} from "../eval/eligibility/ledger-access";
import { rollupEntityCoverage } from "../eval/eligibility/rollup";
import {
  countReasons,
  emptyReasonCounts,
  type EligibilityReasonCounts,
} from "../eval/eligibility/types";
import type { EvalCase, EvalLayer, EvalScoreReport, FixtureScanResult } from "../eval/types";
import type { HeadlineLayer } from "../eval/score";
import { HEADLINE_LAYERS } from "../eval/score";
import { loadAnnotations, loadBenchmarkManifest } from "./manifest";
import { loadCanonicalGoldFromAnnotation } from "../eval/canonical/gold/loader";
import { normalizeBenchmarkLayer } from "./schema";
import { getReposMetadataRoot } from "./run-benchmark";
import { CAPABILITY_COVERAGE_DISCLAIMER } from "./baseline/contract";

export interface LayerGateInput {
  status: string;
  reason?: string;
}

export interface LayerComputabilityInput {
  metrics: Record<string, { state: string }>;
  locationlessFindingCount: number;
}

export interface LayerPopulation {
  acceptedCanonicalPositives: number;
  evaluablePositives: number;
  matchedPositives: number;
  negativeCases: number;
  unreadCount: number;
  unreadRate: number | null;
}

export interface CoverageRate {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface LayerCoverage {
  entityWeighted: CoverageRate;
  distinctEvidenceFiles: CoverageRate;
  entityPartialCoverage: {
    full: number;
    partial: number;
    none: number;
  };
}

export interface LayerEligibilityAccounting {
  ineligibleByReason: EligibilityReasonCounts;
  unscorableFindings: {
    locationless: number;
    total: number;
  };
}

export interface MigrationBlocker {
  code: string;
  message: string;
  count: number;
}

export interface LayerMigrationAccounting {
  total: number;
  byReason: Record<string, number>;
  blockers: MigrationBlocker[];
}

export interface GateException {
  code: string;
  reason: string;
}

export interface CapabilitySlice {
  disclaimer: typeof CAPABILITY_COVERAGE_DISCLAIMER;
  supportedCount: number;
  totalAcceptedPositives: number;
  caseWeighted: number;
  distinctLeaf: number;
}

export interface LanguageSliceEntry {
  language: string;
  population: LayerPopulation;
}

export interface LayerDiagnosticSlices {
  capability: CapabilitySlice;
  byLanguage: LanguageSliceEntry[];
}

export interface LayerReportAccounting {
  population: LayerPopulation;
  coverage: LayerCoverage;
  eligibility: LayerEligibilityAccounting;
  migrationIncomplete: LayerMigrationAccounting;
  gateExceptions: GateException[];
  slices: LayerDiagnosticSlices;
}

export interface PacketCanonicalRecord {
  id: string;
  headlineLayer: HeadlineLayer;
  record: CanonicalGoldExpectation;
}

function rateOrNull(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function toHeadlineLayer(layer: string): HeadlineLayer | null {
  const canonical = normalizeBenchmarkLayer(layer as Parameters<typeof normalizeBenchmarkLayer>[0]);
  if (canonical === "raw_hits" || canonical === "pii_signals") {
    return canonical === "pii_signals" ? "mentions" : null;
  }
  if (HEADLINE_LAYERS.includes(canonical as HeadlineLayer)) {
    return canonical as HeadlineLayer;
  }
  return null;
}

function migrationReasonFromDiagnostics(
  disposition: string,
  layer: HeadlineLayer,
  conversions: ConversionKind[],
): string {
  if (disposition === "migration_incomplete") {
    if (conversions.includes("rule_id_to_concept_leaf")) {
      return "missing_concept_leaf";
    }
    if (conversions.includes("legacy_subject_name")) {
      return "source_token_only";
    }
    return "migration_incomplete";
  }

  if (disposition === "needs_adjudication" && layer === "data-flows") {
    return "awaiting_flow_adjudication";
  }

  if (conversions.includes("legacy_subject_name")) {
    return "legacy_subject_name";
  }

  return "needs_adjudication";
}

const BLOCKER_MESSAGES: Record<string, string> = {
  source_token_only: "Legacy source-token identity without adjudicated canonical concept",
  missing_concept_leaf: "Accepted annotation missing concept leaf",
  awaiting_flow_adjudication: "Flow row awaiting canonical endpoint adjudication",
  unresolved_endpoint: "Flow or component row with unresolved endpoint",
  legacy_subject_name: "Legacy subject.name identity",
  migration_incomplete: "Record migration incomplete",
  needs_adjudication: "Record needs adjudication",
};

export function loadPacketCanonicalRecords(
  repoKey: string,
  benchmarkRoot?: string,
): PacketCanonicalRecord[] {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const records: PacketCanonicalRecord[] = [];

  for (const layer of manifest.coverage.layers) {
    const headlineLayer = toHeadlineLayer(layer);
    if (!headlineLayer) {
      continue;
    }

    const annotations = loadAnnotations(repoDir, layer);
    for (const annotation of annotations) {
      const { record } = loadCanonicalGoldFromAnnotation(annotation, {
        repoKey,
        warn: () => undefined,
      });
      records.push({ id: annotation.id, headlineLayer, record });
    }
  }

  return records;
}

function inferLanguageFromPath(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) {
    return "typescript";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
    return "javascript";
  }
  if (normalized.endsWith(".go")) {
    return "go";
  }
  if (normalized.endsWith(".py")) {
    return "python";
  }
  if (normalized.endsWith(".java")) {
    return "java";
  }
  if (normalized.endsWith(".kt")) {
    return "kotlin";
  }
  if (normalized.endsWith(".rs")) {
    return "rust";
  }
  if (normalized.endsWith(".php")) {
    return "php";
  }
  if (normalized.endsWith(".cs")) {
    return "csharp";
  }
  if (normalized.endsWith(".cpp") || normalized.endsWith(".cc") || normalized.endsWith(".h")) {
    return "cpp";
  }
  if (normalized.endsWith(".tf")) {
    return "terraform";
  }
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) {
    return "yaml";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".env")) {
    return "env";
  }
  if (normalized.includes("dockerfile")) {
    return "dockerfile";
  }
  return "unknown";
}

function layerEvalCases(cases: EvalCase[], layer: HeadlineLayer): EvalCase[] {
  return cases.filter((caseRecord) => caseRecord.layer === layer);
}

function countAcceptedCanonical(
  canonicalRecords: PacketCanonicalRecord[],
  layer: HeadlineLayer,
): number {
  return canonicalRecords.filter(
    (entry) => entry.headlineLayer === layer && entry.record.disposition === "accepted",
  ).length;
}

function countNegativeCases(cases: EvalCase[]): number {
  return cases.filter((caseRecord) => caseRecord.expected.status === "negative").length;
}

function buildPopulation(
  report: EvalScoreReport,
  cases: EvalCase[],
  canonicalRecords: PacketCanonicalRecord[],
  layer: HeadlineLayer,
): LayerPopulation {
  const layerCases = layerEvalCases(cases, layer);
  const acceptedCanonicalPositives = countAcceptedCanonical(canonicalRecords, layer);
  const negativeCases = countNegativeCases(layerCases);
  const unreadDenominator = acceptedCanonicalPositives + negativeCases;

  return {
    acceptedCanonicalPositives,
    evaluablePositives: report.scores.denominators.evaluablePositives,
    matchedPositives: report.scores.denominators.matchedPositives,
    negativeCases,
    unreadCount: report.scores.unreadCount,
    unreadRate: rateOrNull(report.scores.unreadCount, unreadDenominator),
  };
}

function buildCoverage(
  cases: EvalCase[],
  canonicalRecords: PacketCanonicalRecord[],
  scanResult: FixtureScanResult | undefined,
  layer: HeadlineLayer,
): LayerCoverage {
  const layerCases = layerEvalCases(cases, layer);
  const ledger = getLayerLedger(scanResult, layer);
  const acceptedRecords = canonicalRecords.filter(
    (entry) => entry.headlineLayer === layer && entry.record.disposition === "accepted",
  );

  let entityDenominator = 0;
  let entityNumerator = 0;
  let partialFull = 0;
  let partialPartial = 0;
  let partialNone = 0;

  for (const entry of acceptedRecords) {
    entityDenominator += 1;
    const evidencePaths = entry.record.evidenceLocations.map((location) => location.file_path);
    const rollup = rollupEntityCoverage(
      entry.record.identity.identityKey,
      layer,
      evidencePaths,
      ledger,
    );
    if (rollup.coverage === "full") {
      partialFull += 1;
      entityNumerator += 1;
    } else if (rollup.coverage === "partial") {
      partialPartial += 1;
      entityNumerator += 1;
    } else {
      partialNone += 1;
    }
  }

  const distinctFiles = new Set<string>();
  const coveredFiles = new Set<string>();
  for (const caseRecord of layerCases) {
    if (caseRecord.expected.status !== "positive") {
      continue;
    }
    const evidencePath = normalizeEvalPath(caseRecord.evidence.file_path);
    if (!isEvalPathContractValid(evidencePath)) {
      continue;
    }
    distinctFiles.add(evidencePath);
    if (isPathSuccessfullyProcessed(ledger, evidencePath)) {
      coveredFiles.add(evidencePath);
    }
  }

  return {
    entityWeighted: {
      numerator: entityNumerator,
      denominator: entityDenominator,
      rate: rateOrNull(entityNumerator, entityDenominator),
    },
    distinctEvidenceFiles: {
      numerator: coveredFiles.size,
      denominator: distinctFiles.size,
      rate: rateOrNull(coveredFiles.size, distinctFiles.size),
    },
    entityPartialCoverage: {
      full: partialFull,
      partial: partialPartial,
      none: partialNone,
    },
  };
}

function buildEligibilityAccounting(
  scanResult: FixtureScanResult | undefined,
  layer: HeadlineLayer,
  locationlessFindingCount: number,
): LayerEligibilityAccounting {
  const ledger = getLayerLedger(scanResult, layer);
  const ineligibleByReason = ledger
    ? countReasons(
        ledger.outcomes.filter((outcome) => outcome.reason !== "successfully_processed"),
      )
    : emptyReasonCounts();

  return {
    ineligibleByReason,
    unscorableFindings: {
      locationless: locationlessFindingCount,
      total: locationlessFindingCount,
    },
  };
}

function buildMigrationAccountingFromRecords(
  canonicalRecords: PacketCanonicalRecord[],
  layer: HeadlineLayer,
  conversionById: Map<string, ConversionKind[]>,
): LayerMigrationAccounting {
  const byReason: Record<string, number> = {};
  let total = 0;

  for (const entry of canonicalRecords) {
    if (entry.headlineLayer !== layer) {
      continue;
    }
    if (
      entry.record.disposition !== "migration_incomplete" &&
      entry.record.disposition !== "needs_adjudication"
    ) {
      continue;
    }

    const conversions = conversionById.get(entry.id) ?? [];
    const reason = migrationReasonFromDiagnostics(
      entry.record.disposition,
      layer,
      conversions,
    );
    total += 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  const blockers = Object.entries(byReason)
    .map(([code, count]) => ({
      code,
      message: BLOCKER_MESSAGES[code] ?? code,
      count,
    }))
    .sort((left, right) => left.code.localeCompare(right.code));

  return { total, byReason, blockers };
}

export interface PacketCanonicalRecordWithDiagnostics extends PacketCanonicalRecord {
  conversions: ConversionKind[];
}

export function loadPacketCanonicalRecordsWithDiagnostics(
  repoKey: string,
  benchmarkRoot?: string,
): PacketCanonicalRecordWithDiagnostics[] {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const records: PacketCanonicalRecordWithDiagnostics[] = [];

  for (const layer of manifest.coverage.layers) {
    const headlineLayer = toHeadlineLayer(layer);
    if (!headlineLayer) {
      continue;
    }

    const annotations = loadAnnotations(repoDir, layer);
    for (const annotation of annotations) {
      const { record, diagnostics } = loadCanonicalGoldFromAnnotation(annotation, {
        repoKey,
        warn: () => undefined,
      });
      records.push({
        id: annotation.id,
        headlineLayer,
        record,
        conversions: diagnostics.map((entry) => entry.conversion),
      });
    }
  }

  return records;
}

function buildCapabilitySlice(
  canonicalRecords: PacketCanonicalRecord[],
  layer: HeadlineLayer,
): CapabilitySlice {
  const expectations = canonicalRecords
    .filter((entry) => entry.headlineLayer === layer)
    .map((entry) => ({ ...entry.record, id: entry.id }));
  const coverage = computeCapabilityCoverage(expectations, []);
  const positives = expectations.filter((record) => record.disposition === "accepted");
  const supportedCount = positives.filter(
    (record) => record.declaredCapabilitySupported?.supported === true,
  ).length;

  return {
    disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
    supportedCount,
    totalAcceptedPositives: positives.length,
    caseWeighted: coverage.capabilityCoverage.caseWeighted,
    distinctLeaf: coverage.capabilityCoverage.distinctLeaf,
  };
}

function buildLanguageSlices(
  report: EvalScoreReport,
  cases: EvalCase[],
  canonicalRecords: PacketCanonicalRecord[],
  layer: HeadlineLayer,
): LanguageSliceEntry[] {
  const layerCases = layerEvalCases(cases, layer);
  const byLanguage = new Map<string, EvalCase[]>();

  for (const caseRecord of layerCases) {
    const language = inferLanguageFromPath(caseRecord.evidence.file_path);
    const bucket = byLanguage.get(language) ?? [];
    bucket.push(caseRecord);
    byLanguage.set(language, bucket);
  }

  return [...byLanguage.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, languageCases]) => ({
      language,
      population: buildPopulation(
        {
          ...report,
          caseResults: report.caseResults.filter((result) =>
            languageCases.some((caseRecord) => caseRecord.id === result.caseId),
          ),
        },
        languageCases,
        canonicalRecords,
        layer,
      ),
    }));
}

export function resolveGateExceptions(
  gate: LayerGateInput,
  computability: LayerComputabilityInput,
): GateException[] {
  const exceptions: GateException[] = [];

  if (gate.status === "provisional") {
    exceptions.push({
      code: "provisional_gate",
      reason: gate.reason ?? "non_accepted_review_states",
    });
  }

  if (gate.status === "pending") {
    exceptions.push({
      code: "pending_gate",
      reason: gate.reason ?? "layer_pending",
    });
    if (computability.metrics.precision.state === "computable") {
      exceptions.push({
        code: "precision_computable_while_pending",
        reason: "precision is computable while layer gate is pending",
      });
    }
    if (computability.metrics.recall.state === "computable") {
      exceptions.push({
        code: "recall_computable_while_pending",
        reason: "recall is computable while layer gate is pending",
      });
    }
  }

  if (gate.status === "skip" && gate.reason === "no_eval_cases") {
    const anyComputable = Object.values(computability.metrics).some(
      (metric) => metric.state === "computable",
    );
    if (anyComputable) {
      exceptions.push({
        code: "computable_metrics_with_skip_gate",
        reason: "metrics computable despite skip gate (no eval cases in filter)",
      });
    }
  }

  return exceptions;
}

export function buildLayerReportAccounting(input: {
  layer: HeadlineLayer;
  report: EvalScoreReport;
  cases: EvalCase[];
  scanResult?: FixtureScanResult;
  canonicalRecords: PacketCanonicalRecordWithDiagnostics[];
  gate: LayerGateInput;
  computability: LayerComputabilityInput;
}): LayerReportAccounting {
  const layerRecords = input.canonicalRecords.filter(
    (entry) => entry.headlineLayer === input.layer,
  );
  const conversionById = new Map(
    layerRecords.map((entry) => [entry.id, entry.conversions]),
  );

  return {
    population: buildPopulation(
      input.report,
      input.cases,
      layerRecords,
      input.layer,
    ),
    coverage: buildCoverage(
      input.cases,
      layerRecords,
      input.scanResult,
      input.layer,
    ),
    eligibility: buildEligibilityAccounting(
      input.scanResult,
      input.layer,
      input.computability.locationlessFindingCount,
    ),
    migrationIncomplete: buildMigrationAccountingFromRecords(
      layerRecords,
      input.layer,
      conversionById,
    ),
    gateExceptions: resolveGateExceptions(input.gate, input.computability),
    slices: {
      capability: buildCapabilitySlice(layerRecords, input.layer),
      byLanguage: buildLanguageSlices(
        input.report,
        input.cases,
        layerRecords,
        input.layer,
      ),
    },
  };
}

function sumReasonCounts(counts: EligibilityReasonCounts[]): EligibilityReasonCounts {
  const total = emptyReasonCounts();
  for (const entry of counts) {
    for (const reason of Object.keys(total) as EligibilityReason[]) {
      total[reason] += entry[reason];
    }
  }
  return total;
}

function mergeByReason(records: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const entry of records) {
    for (const [reason, count] of Object.entries(entry)) {
      merged[reason] = (merged[reason] ?? 0) + count;
    }
  }
  return merged;
}

function mergeBlockers(blockers: MigrationBlocker[][]): MigrationBlocker[] {
  const byCode = new Map<string, MigrationBlocker>();
  for (const group of blockers) {
    for (const blocker of group) {
      const existing = byCode.get(blocker.code);
      if (existing) {
        existing.count += blocker.count;
      } else {
        byCode.set(blocker.code, { ...blocker });
      }
    }
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function mergeGateExceptions(exceptions: GateException[][]): GateException[] {
  const seen = new Set<string>();
  const merged: GateException[] = [];
  for (const group of exceptions) {
    for (const exception of group) {
      const key = `${exception.code}::${exception.reason}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(exception);
    }
  }
  return merged.sort((left, right) => left.code.localeCompare(right.code));
}

function aggregateCapabilitySlices(slices: CapabilitySlice[]): CapabilitySlice {
  if (slices.length === 0) {
    return {
      disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
      supportedCount: 0,
      totalAcceptedPositives: 0,
      caseWeighted: 0,
      distinctLeaf: 0,
    };
  }

  const totalAcceptedPositives = slices.reduce(
    (sum, slice) => sum + slice.totalAcceptedPositives,
    0,
  );
  const supportedCount = slices.reduce((sum, slice) => sum + slice.supportedCount, 0);

  return {
    disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
    supportedCount,
    totalAcceptedPositives,
    caseWeighted:
      totalAcceptedPositives === 0 ? 0 : supportedCount / totalAcceptedPositives,
    distinctLeaf:
      slices.reduce((sum, slice) => sum + slice.distinctLeaf, 0) / slices.length,
  };
}

function aggregateLanguageSlices(slices: LanguageSliceEntry[][]): LanguageSliceEntry[] {
  const byLanguage = new Map<
    string,
    {
      acceptedCanonicalPositives: number;
      evaluablePositives: number;
      matchedPositives: number;
      unreadCount: number;
      negativeCases: number;
    }
  >();

  for (const group of slices) {
    for (const entry of group) {
      const existing = byLanguage.get(entry.language) ?? {
        acceptedCanonicalPositives: 0,
        evaluablePositives: 0,
        matchedPositives: 0,
        unreadCount: 0,
        negativeCases: 0,
      };
      existing.acceptedCanonicalPositives += entry.population.acceptedCanonicalPositives;
      existing.evaluablePositives += entry.population.evaluablePositives;
      existing.matchedPositives += entry.population.matchedPositives;
      existing.unreadCount += entry.population.unreadCount;
      existing.negativeCases += entry.population.negativeCases;
      byLanguage.set(entry.language, existing);
    }
  }

  return [...byLanguage.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([language, totals]) => ({
      language,
      population: {
        acceptedCanonicalPositives: totals.acceptedCanonicalPositives,
        evaluablePositives: totals.evaluablePositives,
        matchedPositives: totals.matchedPositives,
        negativeCases: totals.negativeCases,
        unreadCount: totals.unreadCount,
        unreadRate: rateOrNull(
          totals.unreadCount,
          totals.acceptedCanonicalPositives + totals.negativeCases,
        ),
      },
    }));
}

export function aggregateLayerReportAccounting(
  accountings: LayerReportAccounting[],
): LayerReportAccounting {
  if (accountings.length === 0) {
    return {
      population: {
        acceptedCanonicalPositives: 0,
        evaluablePositives: 0,
        matchedPositives: 0,
        negativeCases: 0,
        unreadCount: 0,
        unreadRate: null,
      },
      coverage: {
        entityWeighted: { numerator: 0, denominator: 0, rate: null },
        distinctEvidenceFiles: { numerator: 0, denominator: 0, rate: null },
        entityPartialCoverage: { full: 0, partial: 0, none: 0 },
      },
      eligibility: {
        ineligibleByReason: emptyReasonCounts(),
        unscorableFindings: { locationless: 0, total: 0 },
      },
      migrationIncomplete: { total: 0, byReason: {}, blockers: [] },
      gateExceptions: [],
      slices: {
        capability: {
          disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
          supportedCount: 0,
          totalAcceptedPositives: 0,
          caseWeighted: 0,
          distinctLeaf: 0,
        },
        byLanguage: [],
      },
    };
  }

  const entityNumerator = accountings.reduce(
    (sum, entry) => sum + entry.coverage.entityWeighted.numerator,
    0,
  );
  const entityDenominator = accountings.reduce(
    (sum, entry) => sum + entry.coverage.entityWeighted.denominator,
    0,
  );
  const fileNumerator = accountings.reduce(
    (sum, entry) => sum + entry.coverage.distinctEvidenceFiles.numerator,
    0,
  );
  const fileDenominator = accountings.reduce(
    (sum, entry) => sum + entry.coverage.distinctEvidenceFiles.denominator,
    0,
  );

  const acceptedCanonicalPositives = accountings.reduce(
    (sum, entry) => sum + entry.population.acceptedCanonicalPositives,
    0,
  );
  const evaluablePositives = accountings.reduce(
    (sum, entry) => sum + entry.population.evaluablePositives,
    0,
  );
  const matchedPositives = accountings.reduce(
    (sum, entry) => sum + entry.population.matchedPositives,
    0,
  );
  const unreadCount = accountings.reduce(
    (sum, entry) => sum + entry.population.unreadCount,
    0,
  );
  const negativeCases = accountings.reduce(
    (sum, entry) => sum + entry.population.negativeCases,
    0,
  );

  const migrationTotal = accountings.reduce(
    (sum, entry) => sum + entry.migrationIncomplete.total,
    0,
  );

  return {
    population: {
      acceptedCanonicalPositives,
      evaluablePositives,
      matchedPositives,
      negativeCases,
      unreadCount,
      unreadRate: rateOrNull(unreadCount, acceptedCanonicalPositives + negativeCases),
    },
    coverage: {
      entityWeighted: {
        numerator: entityNumerator,
        denominator: entityDenominator,
        rate: rateOrNull(entityNumerator, entityDenominator),
      },
      distinctEvidenceFiles: {
        numerator: fileNumerator,
        denominator: fileDenominator,
        rate: rateOrNull(fileNumerator, fileDenominator),
      },
      entityPartialCoverage: {
        full: accountings.reduce(
          (sum, entry) => sum + entry.coverage.entityPartialCoverage.full,
          0,
        ),
        partial: accountings.reduce(
          (sum, entry) => sum + entry.coverage.entityPartialCoverage.partial,
          0,
        ),
        none: accountings.reduce(
          (sum, entry) => sum + entry.coverage.entityPartialCoverage.none,
          0,
        ),
      },
    },
    eligibility: {
      ineligibleByReason: sumReasonCounts(
        accountings.map((entry) => entry.eligibility.ineligibleByReason),
      ),
      unscorableFindings: {
        locationless: accountings.reduce(
          (sum, entry) => sum + entry.eligibility.unscorableFindings.locationless,
          0,
        ),
        total: accountings.reduce(
          (sum, entry) => sum + entry.eligibility.unscorableFindings.total,
          0,
        ),
      },
    },
    migrationIncomplete: {
      total: migrationTotal,
      byReason: mergeByReason(accountings.map((entry) => entry.migrationIncomplete.byReason)),
      blockers: mergeBlockers(accountings.map((entry) => entry.migrationIncomplete.blockers)),
    },
    gateExceptions: mergeGateExceptions(accountings.map((entry) => entry.gateExceptions)),
    slices: {
      capability: aggregateCapabilitySlices(accountings.map((entry) => entry.slices.capability)),
      byLanguage: aggregateLanguageSlices(accountings.map((entry) => entry.slices.byLanguage)),
    },
  };
}
