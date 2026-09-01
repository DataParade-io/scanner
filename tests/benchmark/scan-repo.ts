import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import { collectPersonalDataFindings } from "../../src/eval-layers/collect-personal-data-findings";
import { buildOrchestratorEvalLedgers } from "../../src/eval-layers/fixture-scan-ledger";
import type { DetectedComponent } from "../../src/core/types/component";
import type { DetectedDataFlow } from "../../src/core/types/data-flow";
import type { SourceLocation } from "../../src/core/types/file";
import type { BenchmarkLayer } from "./schema";
import type { EvalLayer, FixtureScanResult, LayerFinding } from "../eval/types";
import { componentIdentity } from "../eval/layers/components/adapter";
import { dataFlowIdentity } from "../eval/layers/data-flows/adapter";
import { personalDataFindingToLayerFinding } from "../eval/layers/personal-data-adapter";
import { normalizeEvalPath } from "../eval/identity";
import {
  layerLedgerFromOutcomes,
  mergeFixtureLedgers,
} from "../eval/eligibility/build-fixture-result";
import { eligibleProcessedPaths } from "../eval/eligibility/ledger-access";

export function normalizeRepoRelativePath(filePath: string): string {
  return normalizeEvalPath(filePath);
}

const BENCHMARK_TO_EVAL_LAYER: Record<string, EvalLayer> = {
  components: "components",
  data_flows: "data-flows",
  raw_hits: "raw-hits",
  mentions: "mentions",
  data_items: "data-items",
  pii_signals: "mentions",
};

const PERSONAL_DATA_BENCHMARK_LAYERS = new Set([
  "mentions",
  "raw_hits",
  "data_items",
  "pii_signals",
]);

function collectFlowSourceLocations(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) {
    return flow.sourceLocations;
  }
  if (flow.sourceLocation) {
    return [flow.sourceLocation];
  }
  return [];
}

function toComponentFinding(component: DetectedComponent): LayerFinding {
  const labels: string[] = [component.type];
  if (component.subType) {
    labels.push(component.subType);
  }

  const sourceLines = component.sourceLocations.map((location) => ({
    file_path: normalizeRepoRelativePath(location.filePath),
    start_line: location.startLine,
    end_line: location.endLine,
  }));

  return {
    key: componentIdentity(component),
    labels,
    layer: "components",
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

function toDataFlowFinding(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): LayerFinding {
  const locations = collectFlowSourceLocations(flow);
  const sourceLines = locations.map((location) => ({
    file_path: normalizeRepoRelativePath(location.filePath),
    start_line: location.startLine,
    end_line: location.endLine,
  }));

  return {
    key: dataFlowIdentity(flow, componentsById),
    labels: [flow.type],
    layer: "data-flows",
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
    sourceLines,
  };
}

function tagPersonalDataFinding(
  finding: ReturnType<typeof personalDataFindingToLayerFinding>,
  layer: EvalLayer,
): LayerFinding {
  return {
    ...finding,
    layer,
    sourceFilePaths: finding.sourceFilePaths.map(normalizeRepoRelativePath),
    sourceLines: finding.sourceLines.map((line) => ({
      ...line,
      file_path: normalizeRepoRelativePath(line.file_path),
    })),
  };
}

function benchmarkLayerToPersonalDataLayer(
  layer: BenchmarkLayer,
): "mentions" | "raw-hits" | "data-items" {
  switch (layer) {
    case "mentions":
    case "pii_signals":
      return "mentions";
    case "raw_hits":
      return "raw-hits";
    case "data_items":
      return "data-items";
    default:
      throw new Error(`Not a personal-data benchmark layer: ${layer}`);
  }
}

/**
 * Scan a materialized corpus packet for the requested layers.
 * Orchestrator `scan()` runs at most once; each personal-data layer ingests independently.
 */
export async function scanRepoByManifestLayers(
  repoKey: string,
  repoRoot: string,
  layers: BenchmarkLayer[],
): Promise<FixtureScanResult> {
  const wanted = new Set(
    layers.map((layer) => (layer === "pii_signals" ? "mentions" : layer)),
  );
  const findings: LayerFinding[] = [];
  const eligibilityLedgers: Partial<
    Record<EvalLayer, ReturnType<typeof layerLedgerFromOutcomes>>
  > = {};

  const needsOrchestrator = wanted.has("components") || wanted.has("data_flows");
  const needsPersonalData = layers.some((layer) =>
    PERSONAL_DATA_BENCHMARK_LAYERS.has(layer),
  );

  if (needsOrchestrator) {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, ledgerContext } = await scan(repoRoot, config);
    if (!ledgerContext) {
      throw new Error("Orchestrator scan missing ledger context");
    }
    const orchestratorLedgers = buildOrchestratorEvalLedgers(ledgerContext);

    if (wanted.has("components")) {
      eligibilityLedgers.components = layerLedgerFromOutcomes(
        "components",
        orchestratorLedgers.components ?? [],
      );
      findings.push(...scanResult.components.map(toComponentFinding));
    }

    if (wanted.has("data_flows")) {
      eligibilityLedgers["data-flows"] = layerLedgerFromOutcomes(
        "data-flows",
        orchestratorLedgers["data-flows"] ?? [],
      );
      const componentsById = new Map(
        scanResult.components.map((component) => [component.id, component]),
      );
      findings.push(
        ...scanResult.dataFlows.map((flow) => toDataFlowFinding(flow, componentsById)),
      );
    }
  }

  if (needsPersonalData) {
    for (const benchmarkLayer of layers) {
      if (!PERSONAL_DATA_BENCHMARK_LAYERS.has(benchmarkLayer)) {
        continue;
      }
      const personalLayer = benchmarkLayerToPersonalDataLayer(benchmarkLayer);
      const evalLayer = BENCHMARK_TO_EVAL_LAYER[benchmarkLayer]!;
      const payload = await collectPersonalDataFindings(repoRoot, personalLayer);
      eligibilityLedgers[evalLayer] = layerLedgerFromOutcomes(
        evalLayer,
        payload.layerOutcomes,
      );

      findings.push(
        ...payload.findings.map((finding) =>
          tagPersonalDataFinding(personalDataFindingToLayerFinding(finding), evalLayer),
        ),
      );
    }
  }

  const merged = mergeFixtureLedgers(repoKey, findings, eligibilityLedgers);
  return {
    ...merged,
    scannedFiles: [...new Set(
      Object.values(eligibilityLedgers).flatMap((ledger) =>
        ledger ? eligibleProcessedPaths(ledger) : [],
      ),
    )].sort(),
  };
}
