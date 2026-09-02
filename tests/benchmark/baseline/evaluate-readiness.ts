import path from "path";

import { CANONICAL_CONTRACT_VERSION } from "../../../src/eval/canonical/contract";
import {
  FORBIDDEN_CATEGORY_LEAVES,
  normalizeConceptToken,
} from "../../../src/eval/canonical/concept-map.validate";
import {
  hasFlowEndpoints,
  isAcceptedEvaluablePositive,
} from "../../../src/eval/canonical/types";
import { isEvalPathContractValid } from "../../../src/eval/path";
import { resolveScannerAdapterMapVersion } from "../../../src/eval/canonical/scanner/manifest";
import { HEADLINE_LAYERS, type HeadlineLayer } from "../../eval/score";
import { loadAnnotations, loadBenchmarkManifest, loadLayerScopes } from "../manifest";
import { findPackageRoot } from "../paths";
import { listBenchmarkRepoKeys } from "../run-benchmark";
import type { ConversionKind } from "../../eval/canonical/compat/types";
import { loadCanonicalGoldFromAnnotation } from "../../eval/canonical";
import {
  normalizeBenchmarkLayer,
  type AnnotationRecord,
  type BenchmarkLayer,
} from "../schema";
import type { ScorecardVector } from "../scorecard-vector";
import {
  buildMaterializationValidationReport,
  isMaterializationValidationPassing,
} from "../materialization-validation";
import {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  ELIGIBILITY_REASON_SET_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
} from "./contract";
import { digestCorpusGold, digestFile } from "./digests";
import { toHeadlineLayer } from "./collect-gold-stats";
import {
  BASELINE_READINESS_POLICY,
  type BaselineReadinessPolicy,
} from "./readiness-policy";
import type {
  BaselineFingerprint,
  BaselineReadinessEmbed,
  GoldPopulationStats,
  InvariantVersions,
  MigrationIncompleteAccounting,
} from "./types";
import { SCORECARD_VECTOR_CONTRACT_VERSION } from "../scorecard-vector";

export interface ReadinessBlocker {
  code: string;
  message: string;
  layer?: string;
  repoKey?: string;
}

export interface EvaluateBaselineReadinessInput {
  benchmarkRoot: string;
  packageRoot?: string;
  goldPopulation: GoldPopulationStats;
  migrationIncomplete: MigrationIncompleteAccounting;
  fingerprint?: BaselineFingerprint;
  scorecard?: ScorecardVector;
  policy?: BaselineReadinessPolicy;
  requireMaterializations?: boolean;
  requireRuntimeChecks?: boolean;
  evaluatedAt?: string;
}

const LEGACY_MIGRATION_LAYERS: BenchmarkLayer[] = ["data_items", "data_flows"];

const LEGACY_IDENTITY_CONVERSIONS: ConversionKind[] = [
  "legacy_subject_name",
  "pii_signal_prefix_rewrite",
  "rule_id_to_concept_leaf",
];

function buildInvariants(): InvariantVersions {
  return {
    canonicalContractVersion: CANONICAL_CONTRACT_VERSION,
    scorecardVectorContractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
    baselineArtifactSchemaVersion: BASELINE_ARTIFACT_SCHEMA_VERSION,
    eligibilityReasonSetVersion: ELIGIBILITY_REASON_SET_VERSION,
    groundTruthSchemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
  };
}

function isForbiddenConceptLeaf(conceptLeaf: string): boolean {
  const normalized = normalizeConceptToken(conceptLeaf);
  return FORBIDDEN_CATEGORY_LEAVES.some(
    (leaf) => normalizeConceptToken(leaf) === normalized,
  );
}

export function checkLegacyOutcomesResolved(benchmarkRoot: string): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);

    for (const layer of LEGACY_MIGRATION_LAYERS) {
      if (!manifest.coverage.layers.includes(layer)) {
        continue;
      }

      const annotations = loadAnnotations(repoDir, layer);
      const proposed = annotations.filter(
        (annotation) => annotation.provenance.review_state === "proposed",
      );
      if (proposed.length > 0) {
        blockers.push({
          code: "UNRESOLVED_LEGACY_ROWS",
          message: `${proposed.length} ${layer} row(s) still have review_state=proposed`,
          layer: toHeadlineLayer(layer) ?? layer,
          repoKey,
        });
      }
    }
  }

  return blockers;
}

export function checkAcceptedCanonicalContract(benchmarkRoot: string): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);

    for (const layer of manifest.coverage.layers) {
      const headlineLayer = toHeadlineLayer(layer);
      if (!headlineLayer) {
        continue;
      }

      const annotations = loadAnnotations(repoDir, layer);
      for (const annotation of annotations) {
        blockers.push(
          ...contractBlockersForAnnotation(annotation, repoKey, headlineLayer),
        );
      }
    }
  }

  return blockers;
}

function contractBlockersForAnnotation(
  annotation: AnnotationRecord,
  repoKey: string,
  headlineLayer: HeadlineLayer,
): ReadinessBlocker[] {
  const { record } = loadCanonicalGoldFromAnnotation(annotation, {
    repoKey,
    warn: () => undefined,
  });

  if (record.disposition !== "accepted") {
    return [];
  }

  const blockers: ReadinessBlocker[] = [];

  if (record.contractVersion !== CANONICAL_CONTRACT_VERSION) {
    blockers.push({
      code: "CONTRACT_VERSION_MISMATCH",
      message: `${annotation.id}: contractVersion ${record.contractVersion} !== ${CANONICAL_CONTRACT_VERSION}`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (!record.classification.conceptLeaf.trim()) {
    blockers.push({
      code: "CONTRACT_VERSION_MISMATCH",
      message: `${annotation.id}: accepted record missing conceptLeaf`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (isForbiddenConceptLeaf(record.classification.conceptLeaf)) {
    blockers.push({
      code: "FORBIDDEN_CONCEPT_LEAF",
      message: `${annotation.id}: forbidden category leaf '${record.classification.conceptLeaf}'`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (record.evidenceLocations.length === 0) {
    blockers.push({
      code: "CONTRACT_VERSION_MISMATCH",
      message: `${annotation.id}: accepted record missing evidenceLocations`,
      layer: headlineLayer,
      repoKey,
    });
  }

  for (const location of record.evidenceLocations) {
    if (!isEvalPathContractValid(location.file_path)) {
      blockers.push({
        code: "CONTRACT_VERSION_MISMATCH",
        message: `${annotation.id}: evidence path '${location.file_path}' violates path contract`,
        layer: headlineLayer,
        repoKey,
      });
    }
  }

  if (headlineLayer === "data-flows" && !hasFlowEndpoints(record)) {
    blockers.push({
      code: "FLOW_NO_ENDPOINTS",
      message: `${annotation.id}: accepted flow lacks typed flowEndpoints`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (!isAcceptedEvaluablePositive(record)) {
    blockers.push({
      code: "CONTRACT_VERSION_MISMATCH",
      message: `${annotation.id}: accepted record is not evaluable-positive`,
      layer: headlineLayer,
      repoKey,
    });
  }

  return blockers;
}

export function checkNoLegacyIdentityOnAccepted(benchmarkRoot: string): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);

    for (const layer of manifest.coverage.layers) {
      const headlineLayer = toHeadlineLayer(layer);
      if (!headlineLayer) {
        continue;
      }

      const annotations = loadAnnotations(repoDir, layer);
      for (const annotation of annotations) {
        blockers.push(
          ...legacyIdentityBlockersForAnnotation(annotation, repoKey, headlineLayer, layer),
        );
      }
    }
  }

  return blockers;
}

function legacyIdentityBlockersForAnnotation(
  annotation: AnnotationRecord,
  repoKey: string,
  headlineLayer: HeadlineLayer,
  corpusLayer: BenchmarkLayer,
): ReadinessBlocker[] {
  const { record, diagnostics } = loadCanonicalGoldFromAnnotation(annotation, {
    repoKey,
    warn: () => undefined,
  });
  const yamlAccepted = annotation.provenance.review_state === "accepted";
  const blockers: ReadinessBlocker[] = [];

  if (yamlAccepted && record.disposition !== "accepted") {
    blockers.push({
      code: "LOADER_EXEMPTION",
      message: `${annotation.id}: YAML review_state=accepted but canonical disposition=${record.disposition}`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (record.disposition !== "accepted") {
    return blockers;
  }

  if (headlineLayer === "mentions" && annotation.subject.key.startsWith("pii:")) {
    blockers.push({
      code: "LEGACY_KEY_ON_ACCEPTED",
      message: `${annotation.id}: accepted mention uses legacy pii: key prefix`,
      layer: headlineLayer,
      repoKey,
    });
  }

  if (headlineLayer === "components") {
    if (annotation.subject.key === "actor:user") {
      blockers.push({
        code: "LEGACY_KEY_ON_ACCEPTED",
        message: `${annotation.id}: accepted component uses legacy actor:user key`,
        layer: headlineLayer,
        repoKey,
      });
    }
    if (!annotation.canonical?.entity_id && !record.entityId) {
      blockers.push({
        code: "LEGACY_KEY_ON_ACCEPTED",
        message: `${annotation.id}: accepted component lacks structured canonical identity`,
        layer: headlineLayer,
        repoKey,
      });
    }
  }

  if (headlineLayer === "data-items") {
    const identityFromKey = record.identity.identityKey.startsWith("data_item:");
    const hasAdjudicatedCandidate =
      annotation.candidate?.kind === "data_item" &&
      annotation.candidate.proposed_concept_leaf.trim().length > 0;
    if (!identityFromKey && !hasAdjudicatedCandidate) {
      blockers.push({
        code: "SOURCE_TOKEN_ONLY",
        message: `${annotation.id}: accepted data-item lacks canonical identity from key or candidate`,
        layer: headlineLayer,
        repoKey,
      });
    }
  }

  if (headlineLayer === "data-flows") {
    if (!hasFlowEndpoints(record)) {
      blockers.push({
        code: "FLOW_NO_ENDPOINTS",
        message: `${annotation.id}: accepted flow lacks typed flowEndpoints`,
        layer: headlineLayer,
        repoKey,
      });
    }
  }

  const legacyConversions = diagnostics
    .map((entry) => entry.conversion)
    .filter((conversion) => LEGACY_IDENTITY_CONVERSIONS.includes(conversion));

  if (
    legacyConversions.includes("rule_id_to_concept_leaf") &&
    corpusLayer === "raw_hits"
  ) {
    blockers.push({
      code: "LEGACY_KEY_ON_ACCEPTED",
      message: `${annotation.id}: accepted raw-hit still depends on rule_id_to_concept_leaf conversion`,
      layer: headlineLayer,
      repoKey,
    });
  }

  return blockers;
}

export function checkLayerPopulationFloors(
  goldPopulation: GoldPopulationStats,
  policy: BaselineReadinessPolicy = BASELINE_READINESS_POLICY,
): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const layer of ["components", "mentions", "data-items"] as const) {
    const stats = goldPopulation.byLayer[layer];
    const floor = policy.layerFloors[layer];

    if (stats.acceptedCanonicalCount < floor.minAcceptedCanonicalCount) {
      blockers.push({
        code: "LAYER_BELOW_ACCEPTED_FLOOR",
        message: `${layer}: acceptedCanonicalCount ${stats.acceptedCanonicalCount} < floor ${floor.minAcceptedCanonicalCount}`,
        layer,
      });
    }

    if (stats.packetDiversity.distinctPackets < floor.minDistinctPackets) {
      blockers.push({
        code: "LAYER_BELOW_PACKET_DIVERSITY",
        message: `${layer}: distinctPackets ${stats.packetDiversity.distinctPackets} < floor ${floor.minDistinctPackets}`,
        layer,
      });
    }
  }

  const flowStats = goldPopulation.byLayer["data-flows"];
  const flowPolicy = policy.flowSubset;

  if (flowStats.acceptedCanonicalCount < flowPolicy.minAcceptedCanonicalCount) {
    blockers.push({
      code: "FLOW_NO_CANONICAL_ACCEPTS",
      message: `data-flows: acceptedCanonicalCount ${flowStats.acceptedCanonicalCount} < graph-edge floor ${flowPolicy.minAcceptedCanonicalCount}`,
      layer: "data-flows",
    });
  }

  if (flowStats.packetDiversity.distinctPackets < flowPolicy.minDistinctPackets) {
    blockers.push({
      code: "FLOW_NO_CANONICAL_ACCEPTS",
      message: `data-flows: distinctPackets ${flowStats.packetDiversity.distinctPackets} < graph-edge floor ${flowPolicy.minDistinctPackets}`,
      layer: "data-flows",
    });
  }

  if (flowStats.distinctConceptLeaves < flowPolicy.minDistinctFlowTypes) {
    blockers.push({
      code: "FLOW_NO_CANONICAL_ACCEPTS",
      message: `data-flows: distinctConceptLeaves ${flowStats.distinctConceptLeaves} < graph-edge floor ${flowPolicy.minDistinctFlowTypes}`,
      layer: "data-flows",
    });
  }

  return blockers;
}

export function checkLayerScopeProvenance(benchmarkRoot: string): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);
    const scopes = loadLayerScopes(repoDir);

    for (const layer of manifest.coverage.layers) {
      const headlineLayer = toHeadlineLayer(layer);
      if (!headlineLayer) {
        continue;
      }

      const scopeKey = normalizeBenchmarkLayer(layer);
      const scopeRecord = scopes.get(scopeKey);
      if (!scopeRecord) {
        blockers.push({
          code: "SCOPE_MISSING_OR_UNREVIEWED",
          message: `${repoKey}: missing layer-scopes entry for ${scopeKey}`,
          layer: headlineLayer,
          repoKey,
        });
        continue;
      }

      if (scopeRecord.provenance.review_state !== "accepted") {
        blockers.push({
          code: "SCOPE_MISSING_OR_UNREVIEWED",
          message: `${repoKey}: layer-scopes.${scopeKey} review_state=${scopeRecord.provenance.review_state}`,
          layer: headlineLayer,
          repoKey,
        });
      }

      if (scopeRecord.exhaustive_scope_files.length === 0) {
        blockers.push({
          code: "SCOPE_MISSING_OR_UNREVIEWED",
          message: `${repoKey}: layer-scopes.${scopeKey} has empty exhaustive_scope_files`,
          layer: headlineLayer,
          repoKey,
        });
      }
    }
  }

  return blockers;
}

export function checkMaterializations(
  benchmarkRoot: string,
  requireMaterializations = true,
): ReadinessBlocker[] {
  const report = buildMaterializationValidationReport(benchmarkRoot);
  if (!requireMaterializations && report.validCount === 0) {
    return [
      {
        code: "MATERIALIZATION_INVALID",
        message: "Materializations not present (0 valid packets); run benchmark:materialize -- --all",
      },
    ];
  }

  if (isMaterializationValidationPassing(report)) {
    return [];
  }

  return report.failures.map((failure) => ({
    code: "MATERIALIZATION_INVALID",
    message: `${failure.repoKey}: ${failure.validationStatus}${failure.reason ? ` (${failure.reason})` : ""}`,
    repoKey: failure.repoKey,
  }));
}

export function checkFingerprintDigests(
  benchmarkRoot: string,
  packageRoot: string,
  fingerprint?: BaselineFingerprint,
): ReadinessBlocker[] {
  if (!fingerprint) {
    return [];
  }

  const expected = {
    corpusGoldDigest: digestCorpusGold(benchmarkRoot),
    taxonomyDigest: digestFile(path.join(packageRoot, "patterns", "component-taxonomy.yaml")),
    conceptMapDigest: digestFile(
      path.join(packageRoot, "patterns", "personal-data-concept-map.yaml"),
    ),
    adapterMapDigest: resolveScannerAdapterMapVersion(),
  };

  const blockers: ReadinessBlocker[] = [];
  for (const [field, computed] of Object.entries(expected)) {
    const embedded = fingerprint[field as keyof typeof expected];
    if (embedded !== computed) {
      blockers.push({
        code: "DIGEST_MISMATCH",
        message: `${field}: fingerprint=${embedded} current=${computed}`,
      });
    }
  }

  return blockers;
}

export function checkPathContractLimits(
  scorecard: ScorecardVector,
  policy: BaselineReadinessPolicy = BASELINE_READINESS_POLICY,
): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const layer of HEADLINE_LAYERS) {
    const entry = scorecard.layers[layer];
    const reasons = entry.accounting.eligibility.ineligibleByReason;
    const pathMismatches = reasons.missing_or_path_contract_mismatch;
    const processedFiles = entry.computability.scope.processedScopeFileCount;
    const denominator = processedFiles + pathMismatches;
    if (denominator === 0) {
      continue;
    }

    const rate = pathMismatches / denominator;
    if (rate > policy.runtimeLimits.maxPathContractMismatchRate) {
      blockers.push({
        code: "PATH_CONTRACT_RATE_EXCEEDED",
        message: `${layer}: path-contract mismatch rate ${rate.toFixed(4)} > limit ${policy.runtimeLimits.maxPathContractMismatchRate}`,
        layer,
      });
    }
  }

  return blockers;
}

export function checkUnscorableRates(
  scorecard: ScorecardVector,
  policy: BaselineReadinessPolicy = BASELINE_READINESS_POLICY,
): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];

  for (const layer of HEADLINE_LAYERS) {
    const entry = scorecard.layers[layer];
    const metrics = Object.values(entry.computability.metrics);
    if (metrics.length === 0) {
      continue;
    }

    const unscorableCount = metrics.filter((metric) => metric.state === "unscorable_provenance").length;
    const rate = unscorableCount / metrics.length;
    if (rate > policy.runtimeLimits.maxUnscorableMetricRate) {
      blockers.push({
        code: "UNSCORABLE_RATE_EXCEEDED",
        message: `${layer}: unscorable metric rate ${rate.toFixed(4)} > limit ${policy.runtimeLimits.maxUnscorableMetricRate}`,
        layer,
      });
    }
  }

  return blockers;
}

export function evaluateBaselineReadiness(
  input: EvaluateBaselineReadinessInput,
): BaselineReadinessEmbed {
  const policy = input.policy ?? BASELINE_READINESS_POLICY;
  const packageRoot = input.packageRoot ?? findPackageRoot(__dirname);
  const invariants = buildInvariants();
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const requireMaterializations = input.requireMaterializations ?? true;
  const requireRuntimeChecks = input.requireRuntimeChecks ?? Boolean(input.scorecard);

  const blockers: ReadinessBlocker[] = [
    ...checkLegacyOutcomesResolved(input.benchmarkRoot),
    ...checkAcceptedCanonicalContract(input.benchmarkRoot),
    ...checkNoLegacyIdentityOnAccepted(input.benchmarkRoot),
    ...checkLayerPopulationFloors(input.goldPopulation, policy),
    ...checkLayerScopeProvenance(input.benchmarkRoot),
    ...checkMaterializations(input.benchmarkRoot, requireMaterializations),
    ...checkFingerprintDigests(input.benchmarkRoot, packageRoot, input.fingerprint),
  ];

  if (requireRuntimeChecks && input.scorecard) {
    blockers.push(
      ...checkPathContractLimits(input.scorecard, policy),
      ...checkUnscorableRates(input.scorecard, policy),
    );
  }

  const deduped = dedupeBlockers(blockers);

  return {
    status: deduped.length === 0 ? "pass" : "fail",
    evaluatedAt,
    blockers: deduped,
    invariantVersions: invariants,
  };
}

function dedupeBlockers(blockers: ReadinessBlocker[]): ReadinessBlocker[] {
  const seen = new Set<string>();
  const deduped: ReadinessBlocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}|${blocker.layer ?? ""}|${blocker.repoKey ?? ""}|${blocker.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(blocker);
  }
  return deduped;
}

export function formatReadinessReport(readiness: BaselineReadinessEmbed): string {
  const lines = [
    `readiness.status: ${readiness.status}`,
    `readiness.evaluatedAt: ${readiness.evaluatedAt ?? "n/a"}`,
    `readiness.policy: ${BASELINE_READINESS_POLICY.version}`,
    `readiness.blockers: ${readiness.blockers.length}`,
  ];

  for (const blocker of readiness.blockers) {
    const scope = [blocker.layer, blocker.repoKey].filter(Boolean).join(" / ");
    lines.push(`  - ${blocker.code}${scope ? ` (${scope})` : ""}: ${blocker.message}`);
  }

  return lines.join("\n");
}
