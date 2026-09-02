import { CANONICAL_CONTRACT_VERSION } from "../../../src/eval/canonical/contract";
import { SCORECARD_VECTOR_CONTRACT_VERSION } from "../scorecard-vector";
import type { ScorecardVector } from "../scorecard-vector";
import {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  ELIGIBILITY_REASON_SET_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
} from "./contract";
import {
  collectCapabilityCoverageDiagnostic,
  collectGoldPopulation,
  collectMigrationIncompleteAccounting,
} from "./collect-gold-stats";
import { evaluateBaselineReadiness } from "./evaluate-readiness";
import { buildBaselineFingerprint } from "./fingerprint";
import type { BaselineArtifact, InvariantVersions } from "./types";

export interface BuildBaselineArtifactInput {
  seriesLabel: string;
  predecessor: string | null;
  generatedAt: string;
  scorecard: ScorecardVector;
  benchmarkRoot: string;
  scannerGitSha?: string;
}

function buildInvariants(): InvariantVersions {
  return {
    canonicalContractVersion: CANONICAL_CONTRACT_VERSION,
    scorecardVectorContractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
    baselineArtifactSchemaVersion: BASELINE_ARTIFACT_SCHEMA_VERSION,
    eligibilityReasonSetVersion: ELIGIBILITY_REASON_SET_VERSION,
    groundTruthSchemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
  };
}

export function buildBaselineArtifact(input: BuildBaselineArtifactInput): BaselineArtifact {
  const invariants = buildInvariants();
  const fingerprint = buildBaselineFingerprint({
    benchmarkRoot: input.benchmarkRoot,
    scannerGitSha: input.scannerGitSha ?? input.scorecard.scannerGitSha,
  });
  const goldPopulation = collectGoldPopulation(input.benchmarkRoot);
  const migrationIncomplete = collectMigrationIncompleteAccounting(input.benchmarkRoot);

  return {
    schemaVersion: BASELINE_ARTIFACT_SCHEMA_VERSION,
    series: {
      evaluationContractVersion: CANONICAL_CONTRACT_VERSION,
      seriesLabel: input.seriesLabel,
    },
    predecessor: input.predecessor,
    generatedAt: input.generatedAt,
    fingerprint,
    invariants,
    readiness: evaluateBaselineReadiness({
      benchmarkRoot: input.benchmarkRoot,
      goldPopulation,
      migrationIncomplete,
      fingerprint,
      scorecard: input.scorecard,
      requireMaterializations: true,
      requireRuntimeChecks: true,
      evaluatedAt: input.generatedAt,
    }),
    goldPopulation,
    migrationIncomplete,
    scorecard: input.scorecard,
    capabilityCoverage: collectCapabilityCoverageDiagnostic(input.benchmarkRoot),
  };
}
