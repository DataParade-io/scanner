import { z } from "zod";

import type { ScorecardVector } from "../scorecard-vector";
import type { HeadlineLayer } from "../../eval/score";
import type { ReviewState, AnnotationStatus } from "../schema";
import {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  CAPABILITY_COVERAGE_DISCLAIMER,
} from "./contract";

export type MaterializationValidationStatus = "valid" | "missing" | "invalid";

export interface MaterializedSourceFingerprint {
  repoKey: string;
  manifestCommit: string;
  validatedHeadSha: string | null;
  validationStatus: MaterializationValidationStatus;
  reason?: string;
}

export interface ReviewStateCountBlock {
  provenance: "corpus-annotations";
  byLayer: Partial<Record<HeadlineLayer, Record<ReviewState, number>>>;
  total: Record<ReviewState, number>;
}

export interface AnnotationStatusCountBlock {
  provenance: "corpus-annotations";
  byLayer: Partial<Record<HeadlineLayer, Partial<Record<AnnotationStatus, number>>>>;
  total: Partial<Record<AnnotationStatus, number>>;
}

export interface LayerEligibilityProfileSummary {
  layer: HeadlineLayer;
  orchestratorLanguages: string[];
  personalDataLanguages: string[];
  profileDigest: string;
}

export interface EligibilityProfileFingerprint {
  fileLanguages: string[];
  registeredAnalyzers: string[];
  excludedDirectories: string[];
  excludedFileGlobs: string[];
  ingestLimits: {
    maxFileSizeBytes: number;
    maxFileCount: number;
    maxTotalBytes: number;
  };
  perLayer: LayerEligibilityProfileSummary[];
  profileDigest: string;
}

export interface DeterministicScanConfig {
  enableAiInference: false;
  enableAPIDetection: boolean;
  enableDatabaseDetection: boolean;
  enableDataFlowDetection: boolean;
  minimumConfidence: number;
  deepAnalysis: boolean;
  languages: string[] | null;
  excludePaths: string[];
}

export interface BaselineFingerprint {
  fingerprintDigest: string;
  scannerGitSha: string;
  corpusGoldDigest: string;
  evaluationContractVersion: string;
  scorecardVectorContractVersion: string;
  taxonomyDigest: string;
  conceptMapDigest: string;
  adapterMapDigest: string;
  dependencyLockDigest: string;
  materializedSources: MaterializedSourceFingerprint[];
  reviewStateCounts: ReviewStateCountBlock;
  annotationStatusCounts: AnnotationStatusCountBlock;
  deterministicConfiguration: DeterministicScanConfig;
  deterministicConfigurationDigest: string;
  eligibilityProfile: EligibilityProfileFingerprint;
}

export interface BaselineSeries {
  evaluationContractVersion: string;
  seriesLabel: string;
}

export interface InvariantVersions {
  canonicalContractVersion: string;
  scorecardVectorContractVersion: string;
  baselineArtifactSchemaVersion: typeof BASELINE_ARTIFACT_SCHEMA_VERSION;
  eligibilityReasonSetVersion: string;
  groundTruthSchemaVersion: string;
}

export interface BaselineReadinessEmbed {
  status: "not_evaluated" | "pass" | "fail";
  evaluatedAt: string | null;
  blockers: Array<{
    code: string;
    message: string;
    layer?: string;
    repoKey?: string;
  }>;
  invariantVersions: InvariantVersions;
}

export interface LayerGoldPopulation {
  acceptedCanonicalCount: number;
  evaluablePositiveCount: number;
  packetDiversity: {
    distinctPackets: number;
    packetKeys: string[];
  };
  distinctConceptLeaves: number;
}

export interface GoldPopulationStats {
  byLayer: Record<HeadlineLayer, LayerGoldPopulation>;
}

export interface MigrationIncompleteAccounting {
  total: number;
  byReason: Record<string, number>;
  byLayer: Partial<Record<HeadlineLayer, number>>;
}

export interface CapabilityCoverageDiagnostic {
  disclaimer: typeof CAPABILITY_COVERAGE_DISCLAIMER;
  byLayer: Partial<
    Record<
      HeadlineLayer,
      {
        caseWeighted: number;
        distinctLeaf: number;
        supportedCount: number;
        totalAcceptedPositives: number;
      }
    >
  >;
}

export interface BaselineArtifact {
  schemaVersion: typeof BASELINE_ARTIFACT_SCHEMA_VERSION;
  series: BaselineSeries;
  predecessor: string | null;
  generatedAt: string;
  fingerprint: BaselineFingerprint;
  invariants: InvariantVersions;
  readiness: BaselineReadinessEmbed;
  goldPopulation: GoldPopulationStats;
  migrationIncomplete: MigrationIncompleteAccounting;
  scorecard: ScorecardVector;
  capabilityCoverage: CapabilityCoverageDiagnostic;
}

const reviewStateSchema = z.enum([
  "proposed",
  "accepted",
  "rejected",
  "needs_adjudication",
]);

const headlineLayerSchema = z.enum([
  "mentions",
  "data-items",
  "components",
  "data-flows",
]);

const deterministicConfigSchema = z.object({
  enableAiInference: z.literal(false),
  enableAPIDetection: z.boolean(),
  enableDatabaseDetection: z.boolean(),
  enableDataFlowDetection: z.boolean(),
  minimumConfidence: z.number(),
  deepAnalysis: z.boolean(),
  languages: z.array(z.string()).nullable(),
  excludePaths: z.array(z.string()),
});

const materializedSourceSchema = z.object({
  repoKey: z.string(),
  manifestCommit: z.string(),
  validatedHeadSha: z.string().nullable(),
  validationStatus: z.enum(["valid", "missing", "invalid"]),
  reason: z.string().optional(),
});

const fingerprintSchema = z.object({
  fingerprintDigest: z.string(),
  scannerGitSha: z.string(),
  corpusGoldDigest: z.string(),
  evaluationContractVersion: z.string(),
  scorecardVectorContractVersion: z.string(),
  taxonomyDigest: z.string(),
  conceptMapDigest: z.string(),
  adapterMapDigest: z.string(),
  dependencyLockDigest: z.string(),
  materializedSources: z.array(materializedSourceSchema),
  reviewStateCounts: z.object({
    provenance: z.literal("corpus-annotations"),
    byLayer: z.record(z.string(), z.record(reviewStateSchema, z.number())),
    total: z.record(reviewStateSchema, z.number()),
  }),
  annotationStatusCounts: z.object({
    provenance: z.literal("corpus-annotations"),
    byLayer: z.record(z.string(), z.record(z.string(), z.number())),
    total: z.record(z.string(), z.number()),
  }),
  deterministicConfiguration: deterministicConfigSchema,
  deterministicConfigurationDigest: z.string(),
  eligibilityProfile: z.object({
    fileLanguages: z.array(z.string()),
    registeredAnalyzers: z.array(z.string()),
    excludedDirectories: z.array(z.string()),
    excludedFileGlobs: z.array(z.string()),
    ingestLimits: z.object({
      maxFileSizeBytes: z.number(),
      maxFileCount: z.number(),
      maxTotalBytes: z.number(),
    }),
    perLayer: z.array(
      z.object({
        layer: headlineLayerSchema,
        orchestratorLanguages: z.array(z.string()),
        personalDataLanguages: z.array(z.string()),
        profileDigest: z.string(),
      }),
    ),
    profileDigest: z.string(),
  }),
});

const invariantsSchema = z.object({
  canonicalContractVersion: z.string(),
  scorecardVectorContractVersion: z.string(),
  baselineArtifactSchemaVersion: z.literal(BASELINE_ARTIFACT_SCHEMA_VERSION),
  eligibilityReasonSetVersion: z.string(),
  groundTruthSchemaVersion: z.string(),
});

const layerGoldPopulationSchema = z.object({
  acceptedCanonicalCount: z.number(),
  evaluablePositiveCount: z.number(),
  packetDiversity: z.object({
    distinctPackets: z.number(),
    packetKeys: z.array(z.string()),
  }),
  distinctConceptLeaves: z.number(),
});

export const baselineArtifactSchema = z.object({
  schemaVersion: z.literal(BASELINE_ARTIFACT_SCHEMA_VERSION),
  series: z.object({
    evaluationContractVersion: z.string(),
    seriesLabel: z.string(),
  }),
  predecessor: z.string().nullable(),
  generatedAt: z.string(),
  fingerprint: fingerprintSchema,
  invariants: invariantsSchema,
  readiness: z.object({
    status: z.enum(["not_evaluated", "pass", "fail"]),
    evaluatedAt: z.string().nullable(),
    blockers: z.array(
      z.object({
        code: z.string(),
        message: z.string(),
        layer: z.string().optional(),
        repoKey: z.string().optional(),
      }),
    ),
    invariantVersions: invariantsSchema,
  }),
  goldPopulation: z.object({
    byLayer: z.record(z.string(), layerGoldPopulationSchema),
  }),
  migrationIncomplete: z.object({
    total: z.number(),
    byReason: z.record(z.string(), z.number()),
    byLayer: z.record(z.string(), z.number()),
  }),
  scorecard: z.custom<ScorecardVector>(),
  capabilityCoverage: z.object({
    disclaimer: z.literal(CAPABILITY_COVERAGE_DISCLAIMER),
    byLayer: z.record(
      z.string(),
      z.object({
        caseWeighted: z.number(),
        distinctLeaf: z.number(),
        supportedCount: z.number(),
        totalAcceptedPositives: z.number(),
      }),
    ),
  }),
});

export function parseBaselineArtifact(value: unknown): BaselineArtifact {
  const parsed = baselineArtifactSchema.parse(value);
  return parsed as BaselineArtifact;
}
