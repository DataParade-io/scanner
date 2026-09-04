import path from "path";

import { CANONICAL_CONTRACT_VERSION } from "../../../src/eval/canonical/contract";
import { resolveScannerAdapterMapVersion } from "../../../src/eval/canonical/scanner/manifest";
import { SCORECARD_VECTOR_CONTRACT_VERSION } from "../scorecard-vector";
import { findPackageRoot } from "../paths";
import { digestCorpusGold, digestFile, digestStableJson } from "./digests";
import {
  buildDeterministicScanConfig,
  digestDeterministicScanConfig,
} from "./deterministic-config";
import { buildEligibilityProfileFingerprint } from "./eligibility-profile";
import {
  collectAnnotationStatusCounts,
  collectReviewStateCounts,
  resolveScannerGitSha,
} from "./collect-gold-stats";
import { collectMaterializedSources } from "./collect-materializations";
import type { BaselineFingerprint } from "./types";

export interface BuildFingerprintInput {
  benchmarkRoot: string;
  scannerGitSha?: string;
}

export function buildBaselineFingerprint(input: BuildFingerprintInput): BaselineFingerprint {
  const packageRoot = findPackageRoot(__dirname);
  const benchmarkRoot = input.benchmarkRoot;
  const deterministicConfiguration = buildDeterministicScanConfig();
  const eligibilityProfile = buildEligibilityProfileFingerprint();

  const fingerprintBody = {
    scannerGitSha: input.scannerGitSha ?? resolveScannerGitSha(),
    corpusGoldDigest: digestCorpusGold(benchmarkRoot),
    evaluationContractVersion: CANONICAL_CONTRACT_VERSION,
    scorecardVectorContractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
    taxonomyDigest: digestFile(path.join(packageRoot, "patterns", "component-taxonomy.yaml")),
    conceptMapDigest: digestFile(
      path.join(packageRoot, "patterns", "personal-data-concept-map.yaml"),
    ),
    adapterMapDigest: resolveScannerAdapterMapVersion(),
    dependencyLockDigest: digestFile(path.join(packageRoot, "pnpm-lock.yaml")),
    materializedSources: collectMaterializedSources(benchmarkRoot),
    reviewStateCounts: collectReviewStateCounts(benchmarkRoot),
    annotationStatusCounts: collectAnnotationStatusCounts(benchmarkRoot),
    deterministicConfiguration,
    deterministicConfigurationDigest: digestDeterministicScanConfig(deterministicConfiguration),
    eligibilityProfile,
  };

  const fingerprintDigest = digestStableJson(fingerprintBody);

  return {
    fingerprintDigest,
    ...fingerprintBody,
  };
}
