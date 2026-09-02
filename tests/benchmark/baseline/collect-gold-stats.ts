import path from "path";
import { execSync } from "child_process";

import { loadAnnotations, loadBenchmarkManifest } from "../manifest";
import { listBenchmarkRepoKeys } from "../run-benchmark";
import { normalizeBenchmarkLayer, type AnnotationStatus, type ReviewState } from "../schema";
import { loadCanonicalGoldFromAnnotation } from "../../eval/canonical";
import { isAcceptedEvaluablePositive } from "../../../src/eval/canonical/types";
import type { ConversionKind } from "../../eval/canonical/compat/types";
import { HEADLINE_LAYERS, type HeadlineLayer } from "../../eval/score";
import { computeCapabilityCoverage } from "../../../src/eval/canonical/metrics";
import type {
  AnnotationStatusCountBlock,
  CapabilityCoverageDiagnostic,
  GoldPopulationStats,
  LayerGoldPopulation,
  MigrationIncompleteAccounting,
  ReviewStateCountBlock,
} from "./types";
import { CAPABILITY_COVERAGE_DISCLAIMER } from "./contract";

function emptyReviewStateRecord(): Record<ReviewState, number> {
  return {
    accepted: 0,
    proposed: 0,
    rejected: 0,
    needs_adjudication: 0,
  };
}

function emptyStatusRecord(): Record<AnnotationStatus, number> {
  return {
    positive: 0,
    negative: 0,
    ambiguous: 0,
  };
}

export function toHeadlineLayer(layer: string): HeadlineLayer | null {
  const canonical = normalizeBenchmarkLayer(layer as Parameters<typeof normalizeBenchmarkLayer>[0]);
  if (canonical === "raw_hits") {
    return null;
  }
  if (canonical === "pii_signals") {
    return "mentions";
  }
  if (canonical === "data_items") {
    return "data-items";
  }
  if (canonical === "data_flows") {
    return "data-flows";
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

export function collectReviewStateCounts(benchmarkRoot: string): ReviewStateCountBlock {
  const byLayer: ReviewStateCountBlock["byLayer"] = {};
  const total = emptyReviewStateRecord();

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);

    for (const layer of manifest.coverage.layers) {
      const headlineLayer = toHeadlineLayer(layer);
      if (!headlineLayer) {
        continue;
      }

      const annotations = loadAnnotations(repoDir, layer);
      if (!byLayer[headlineLayer]) {
        byLayer[headlineLayer] = emptyReviewStateRecord();
      }

      for (const annotation of annotations) {
        const state = annotation.provenance.review_state;
        byLayer[headlineLayer]![state] += 1;
        total[state] += 1;
      }
    }
  }

  return {
    provenance: "corpus-annotations",
    byLayer,
    total,
  };
}

export function collectAnnotationStatusCounts(benchmarkRoot: string): AnnotationStatusCountBlock {
  const byLayer: AnnotationStatusCountBlock["byLayer"] = {};
  const total: Partial<Record<AnnotationStatus, number>> = {};

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);

    for (const layer of manifest.coverage.layers) {
      const headlineLayer = toHeadlineLayer(layer);
      if (!headlineLayer) {
        continue;
      }

      const annotations = loadAnnotations(repoDir, layer);
      if (!byLayer[headlineLayer]) {
        byLayer[headlineLayer] = emptyStatusRecord();
      }

      for (const annotation of annotations) {
        const status = annotation.expected.status;
        byLayer[headlineLayer]![status] = (byLayer[headlineLayer]![status] ?? 0) + 1;
        total[status] = (total[status] ?? 0) + 1;
      }
    }
  }

  return {
    provenance: "corpus-annotations",
    byLayer,
    total,
  };
}

export function collectGoldPopulation(benchmarkRoot: string): GoldPopulationStats {
  const byLayer = {} as Record<HeadlineLayer, LayerGoldPopulation>;

  for (const layer of HEADLINE_LAYERS) {
    byLayer[layer] = {
      acceptedCanonicalCount: 0,
      evaluablePositiveCount: 0,
      packetDiversity: { distinctPackets: 0, packetKeys: [] },
      distinctConceptLeaves: 0,
    };
  }

  const packetKeysByLayer = new Map<HeadlineLayer, Set<string>>();
  const conceptLeavesByLayer = new Map<HeadlineLayer, Set<string>>();

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
        const { record } = loadCanonicalGoldFromAnnotation(annotation, {
          repoKey,
          warn: () => undefined,
        });

        if (record.disposition === "accepted") {
          byLayer[headlineLayer].acceptedCanonicalCount += 1;
          if (!packetKeysByLayer.has(headlineLayer)) {
            packetKeysByLayer.set(headlineLayer, new Set());
          }
          packetKeysByLayer.get(headlineLayer)!.add(repoKey);

          if (!conceptLeavesByLayer.has(headlineLayer)) {
            conceptLeavesByLayer.set(headlineLayer, new Set());
          }
          if (record.classification.conceptLeaf.trim()) {
            conceptLeavesByLayer.get(headlineLayer)!.add(record.classification.conceptLeaf);
          }
        }

        if (isAcceptedEvaluablePositive(record)) {
          byLayer[headlineLayer].evaluablePositiveCount += 1;
        }
      }
    }
  }

  for (const layer of HEADLINE_LAYERS) {
    const packetKeys = [...(packetKeysByLayer.get(layer) ?? new Set<string>())].sort();
    byLayer[layer].packetDiversity = {
      distinctPackets: packetKeys.length,
      packetKeys,
    };
    byLayer[layer].distinctConceptLeaves = conceptLeavesByLayer.get(layer)?.size ?? 0;
  }

  return { byLayer };
}

export function collectMigrationIncompleteAccounting(
  benchmarkRoot: string,
): MigrationIncompleteAccounting {
  const byReason: Record<string, number> = {};
  const byLayer: Partial<Record<HeadlineLayer, number>> = {};
  let total = 0;

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
        const { record, diagnostics } = loadCanonicalGoldFromAnnotation(annotation, {
          repoKey,
          warn: () => undefined,
        });

        if (
          record.disposition !== "migration_incomplete" &&
          record.disposition !== "needs_adjudication"
        ) {
          continue;
        }

        const conversions = diagnostics.map((entry) => entry.conversion);
        const reason = migrationReasonFromDiagnostics(
          record.disposition,
          headlineLayer,
          conversions,
        );

        total += 1;
        byReason[reason] = (byReason[reason] ?? 0) + 1;
        byLayer[headlineLayer] = (byLayer[headlineLayer] ?? 0) + 1;
      }
    }
  }

  return { total, byReason, byLayer };
}

function resolveCorpusLayerForHeadline(
  manifestLayers: string[],
  headlineLayer: HeadlineLayer,
): string | null {
  if (headlineLayer === "mentions" && manifestLayers.includes("pii_signals")) {
    return "pii_signals";
  }
  const underscored = headlineLayer.replace(/-/g, "_");
  if (manifestLayers.includes(underscored)) {
    return underscored;
  }
  if (manifestLayers.includes(headlineLayer)) {
    return headlineLayer;
  }
  return null;
}

export function collectCapabilityCoverageDiagnostic(
  benchmarkRoot: string,
): CapabilityCoverageDiagnostic {
  const byLayer: CapabilityCoverageDiagnostic["byLayer"] = {};

  for (const layer of HEADLINE_LAYERS) {
    const expectations: Array<
      { id: string } & import("../../../src/eval/canonical/types").CanonicalGoldExpectation
    > = [];

    for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const manifest = loadBenchmarkManifest(repoDir);
      const corpusLayer = resolveCorpusLayerForHeadline(manifest.coverage.layers, layer);
      if (!corpusLayer) {
        continue;
      }

      const annotations = loadAnnotations(
        repoDir,
        corpusLayer as Parameters<typeof loadAnnotations>[1],
      );
      for (const annotation of annotations) {
        const { record } = loadCanonicalGoldFromAnnotation(annotation, {
          repoKey,
          warn: () => undefined,
        });
        expectations.push({ ...record, id: annotation.id });
      }
    }

    const coverage = computeCapabilityCoverage(expectations, []);
    const positives = expectations.filter((record) => record.disposition === "accepted");
    const supportedCount = positives.filter(
      (record) => record.declaredCapabilitySupported?.supported === true,
    ).length;

    byLayer[layer] = {
      caseWeighted: coverage.capabilityCoverage.caseWeighted,
      distinctLeaf: coverage.capabilityCoverage.distinctLeaf,
      supportedCount,
      totalAcceptedPositives: positives.length,
    };
  }

  return {
    disclaimer: CAPABILITY_COVERAGE_DISCLAIMER,
    byLayer,
  };
}

export function resolveScannerGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
