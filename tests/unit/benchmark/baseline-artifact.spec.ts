import fs from "fs";
import path from "path";

import { computeMetricComputability } from "../../eval/canonical/computability";
import { CANONICAL_CONTRACT_VERSION } from "../../eval/canonical/contract";
import {
  assertNoCrossLayerScalar,
  buildScorecardVector,
  SCORECARD_VECTOR_CONTRACT_VERSION,
} from "../../benchmark/scorecard-vector";
import type { EvalLayer, EvalScoreReport, EvalScores } from "../../eval/types";
import {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  CAPABILITY_COVERAGE_DISCLAIMER,
  ELIGIBILITY_REASON_SET_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
} from "../../benchmark/baseline/contract";
import {
  parseBaselineArtifact,
  renderBaselineMarkdown,
  type BaselineArtifact,
} from "../../benchmark/baseline";

const FIXTURE_DIR = path.join(__dirname, "../../fixtures/baseline");

function emptyScoresForLayer(layer: EvalLayer): EvalScores {
  const denominators = {
    evaluablePositives: 0,
    matchedPositives: 0,
    matchedWithCorrectLabels: 0,
    matchedAncestorCategory: 0,
    negativeCases: 0,
    negativeCasesPassed: 0,
    exhaustiveScopedFindings: 0,
    exhaustiveScopedMatches: 0,
  };
  return {
    recall: null,
    ancestorCategoryRecall: null,
    labelAccuracy: null,
    correctLabelRecall: null,
    precision: null,
    negativeCasePassRate: null,
    unreadCount: 0,
    denominators,
    metricComputability: computeMetricComputability({
      layer,
      denominators,
      scope: { reviewedScopeFileCount: 0, processedScopeFileCount: 0 },
      recall: null,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 0,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    }),
  };
}

function scorableMentionsReport(): EvalScoreReport {
  const denominators = {
    evaluablePositives: 2,
    matchedPositives: 1,
    matchedWithCorrectLabels: 1,
    matchedAncestorCategory: 0,
    negativeCases: 0,
    negativeCasesPassed: 0,
    exhaustiveScopedFindings: 1,
    exhaustiveScopedMatches: 1,
  };
  return {
    scores: {
      recall: 0.5,
      ancestorCategoryRecall: null,
      labelAccuracy: 1,
      correctLabelRecall: 0.5,
      precision: 1,
      negativeCasePassRate: null,
      unreadCount: 0,
      denominators,
      metricComputability: computeMetricComputability({
        layer: "mentions",
        denominators,
        scope: { reviewedScopeFileCount: 1, processedScopeFileCount: 1 },
        recall: 0.5,
        precision: 1,
        negativeCasePassRate: null,
        positiveCaseCount: 2,
        unreadPositiveCount: 0,
        negativeCaseCount: 0,
        unreadNegativeCount: 0,
        locationlessFindingCount: 0,
      }),
    },
    caseResults: [],
  };
}

function buildMinimalScorecard() {
  const emptyLayerReport = (layer: EvalLayer): EvalScoreReport => ({
    scores: emptyScoresForLayer(layer),
    caseResults: [],
  });

  return buildScorecardVector({
    scannerGitSha: "fixture-sha-001",
    generatedAt: "2026-08-31T12:00:00.000Z",
    reviewStates: ["accepted"],
    packets: [
      {
        repoKey: "fixture-packet",
        evalCases: [],
        layerScores: {
          mentions: scorableMentionsReport(),
          "raw-hits": emptyLayerReport("mentions"),
        },
      },
    ],
  });
}

function buildMinimalBaselineArtifact(): BaselineArtifact {
  const invariants = {
    canonicalContractVersion: CANONICAL_CONTRACT_VERSION,
    scorecardVectorContractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
    baselineArtifactSchemaVersion: BASELINE_ARTIFACT_SCHEMA_VERSION,
    eligibilityReasonSetVersion: ELIGIBILITY_REASON_SET_VERSION,
    groundTruthSchemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
  };

  const scorecard = buildMinimalScorecard();

  return {
    schemaVersion: BASELINE_ARTIFACT_SCHEMA_VERSION,
    series: {
      evaluationContractVersion: CANONICAL_CONTRACT_VERSION,
      seriesLabel: "series-1",
    },
    predecessor: null,
    generatedAt: "2026-08-31T12:00:00.000Z",
    fingerprint: {
      fingerprintDigest: "sha256:fixture-fingerprint-digest",
      scannerGitSha: "fixture-sha-001",
      corpusGoldDigest: "sha256:fixture-corpus-digest",
      evaluationContractVersion: CANONICAL_CONTRACT_VERSION,
      scorecardVectorContractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
      taxonomyDigest: "sha256:fixture-taxonomy",
      conceptMapDigest: "sha256:fixture-concept-map",
      adapterMapDigest: "sha256:fixture-adapter-map",
      dependencyLockDigest: "sha256:fixture-lock",
      materializedSources: [
        {
          repoKey: "fixture-packet",
          manifestCommit: "a".repeat(40),
          validatedHeadSha: null,
          validationStatus: "missing",
          reason: "path does not exist",
        },
      ],
      reviewStateCounts: {
        provenance: "corpus-annotations",
        byLayer: {
          mentions: {
            accepted: 2,
            proposed: 0,
            rejected: 0,
            needs_adjudication: 0,
          },
        },
        total: {
          accepted: 2,
          proposed: 0,
          rejected: 0,
          needs_adjudication: 0,
        },
      },
      annotationStatusCounts: {
        provenance: "corpus-annotations",
        byLayer: {
          mentions: { positive: 2, negative: 0, ambiguous: 0 },
        },
        total: { positive: 2, negative: 0, ambiguous: 0 },
      },
      deterministicConfiguration: {
        enableAiInference: false,
        enableAPIDetection: true,
        enableDatabaseDetection: true,
        enableDataFlowDetection: true,
        minimumConfidence: 0.5,
        deepAnalysis: false,
        languages: null,
        excludePaths: ["**/*.spec.ts"],
      },
      deterministicConfigurationDigest: "sha256:fixture-config",
      eligibilityProfile: {
        fileLanguages: ["go", "typescript"],
        registeredAnalyzers: ["go", "typescript"],
        excludedDirectories: ["node_modules"],
        excludedFileGlobs: ["**/*.spec.ts"],
        ingestLimits: {
          maxFileSizeBytes: 2097152,
          maxFileCount: 20000,
          maxTotalBytes: 209715200,
        },
        perLayer: [
          {
            layer: "mentions",
            orchestratorLanguages: [],
            personalDataLanguages: ["typescript"],
            profileDigest: "sha256:fixture-layer-mentions",
          },
          {
            layer: "data-items",
            orchestratorLanguages: [],
            personalDataLanguages: ["typescript"],
            profileDigest: "sha256:fixture-layer-data-items",
          },
          {
            layer: "components",
            orchestratorLanguages: ["typescript"],
            personalDataLanguages: [],
            profileDigest: "sha256:fixture-layer-components",
          },
          {
            layer: "data-flows",
            orchestratorLanguages: ["typescript"],
            personalDataLanguages: [],
            profileDigest: "sha256:fixture-layer-data-flows",
          },
        ],
        profileDigest: "sha256:fixture-eligibility-profile",
      },
    },
    invariants,
    readiness: {
      status: "not_evaluated",
      evaluatedAt: null,
      blockers: [],
      invariantVersions: invariants,
    },
    goldPopulation: {
      byLayer: {
        mentions: {
          acceptedCanonicalCount: 2,
          evaluablePositiveCount: 2,
          packetDiversity: { distinctPackets: 1, packetKeys: ["fixture-packet"] },
          distinctConceptLeaves: 1,
        },
        "data-items": {
          acceptedCanonicalCount: 0,
          evaluablePositiveCount: 0,
          packetDiversity: { distinctPackets: 0, packetKeys: [] },
          distinctConceptLeaves: 0,
        },
        components: {
          acceptedCanonicalCount: 0,
          evaluablePositiveCount: 0,
          packetDiversity: { distinctPackets: 0, packetKeys: [] },
          distinctConceptLeaves: 0,
        },
        "data-flows": {
          acceptedCanonicalCount: 0,
          evaluablePositiveCount: 0,
          packetDiversity: { distinctPackets: 0, packetKeys: [] },
          distinctConceptLeaves: 0,
        },
      },
    },
    migrationIncomplete: {
      total: 1,
      byReason: { awaiting_flow_adjudication: 1 },
      byLayer: { "data-flows": 1 },
    },
    scorecard,
    capabilityCoverage: {
      disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
      byLayer: {
        mentions: {
          caseWeighted: 0,
          distinctLeaf: 0,
          supportedCount: 0,
          totalAcceptedPositives: 2,
        },
      },
    },
  };
}

describe("baseline artifact", () => {
  const minimalArtifact = buildMinimalBaselineArtifact();

  beforeAll(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    const jsonPath = path.join(FIXTURE_DIR, "minimal-baseline-artifact.json");
    if (!fs.existsSync(jsonPath)) {
      fs.writeFileSync(jsonPath, `${JSON.stringify(minimalArtifact, null, 2)}\n`, "utf8");
    }
    const mdPath = path.join(FIXTURE_DIR, "minimal-baseline-artifact.md");
    if (!fs.existsSync(mdPath)) {
      fs.writeFileSync(mdPath, renderBaselineMarkdown(minimalArtifact), "utf8");
    }
  });

  it("validates the committed fixture JSON", () => {
    const fixturePath = path.join(FIXTURE_DIR, "minimal-baseline-artifact.json");
    const parsed = parseBaselineArtifact(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
    expect(parsed.schemaVersion).toBe(BASELINE_ARTIFACT_SCHEMA_VERSION);
    expect(parsed.predecessor).toBeNull();
  });

  it("round-trips fixture JSON to deterministic Markdown", () => {
    const fixturePath = path.join(FIXTURE_DIR, "minimal-baseline-artifact.json");
    const goldenMdPath = path.join(FIXTURE_DIR, "minimal-baseline-artifact.md");
    const artifact = parseBaselineArtifact(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
    const rendered = renderBaselineMarkdown(artifact);
    const golden = fs.readFileSync(goldenMdPath, "utf8");
    expect(rendered).toBe(golden);
  });

  it("renders Markdown deterministically across repeated calls", () => {
    const first = renderBaselineMarkdown(minimalArtifact);
    for (let index = 0; index < 100; index += 1) {
      expect(renderBaselineMarkdown(minimalArtifact)).toBe(first);
    }
  });

  it("requires enableAiInference false in fingerprint config", () => {
    expect(minimalArtifact.fingerprint.deterministicConfiguration.enableAiInference).toBe(false);
  });

  it("renders predecessor null as none in Markdown", () => {
    const markdown = renderBaselineMarkdown(minimalArtifact);
    expect(markdown).toContain("- Predecessor: none");
  });

  it("embeds scorecard-vector/2 without cross-layer scalar", () => {
    expect(minimalArtifact.scorecard.contractVersion).toBe(SCORECARD_VECTOR_CONTRACT_VERSION);
    assertNoCrossLayerScalar(minimalArtifact.scorecard);
    expect(minimalArtifact).not.toHaveProperty("overall");
    expect(minimalArtifact).not.toHaveProperty("adjustedRecall");
  });

  it("marks capability coverage as diagnostic only", () => {
    expect(minimalArtifact.capabilityCoverage.disclaimer).toBe(
      CAPABILITY_COVERAGE_DISCLAIMER,
    );
    const serialized = JSON.stringify(minimalArtifact);
    expect(serialized).not.toContain("adjustedRecall");
    expect(serialized).not.toContain("capabilityFilteredDenominator");
  });

  it("reserves readiness as not_evaluated stub", () => {
    expect(minimalArtifact.readiness.status).toBe("not_evaluated");
    expect(minimalArtifact.readiness.evaluatedAt).toBeNull();
  });

  it("records missing materialization status without requiring clones", () => {
    const missing = minimalArtifact.fingerprint.materializedSources.find(
      (source) => source.validationStatus === "missing",
    );
    expect(missing).toBeDefined();
    expect(missing?.validatedHeadSha).toBeNull();
  });
});
