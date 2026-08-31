import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import { collectPersonalDataFindings } from "../../src/eval-layers/collect-personal-data-findings";
import type { DetectedComponent } from "../../src/core/types/component";
import type { DetectedDataFlow } from "../../src/core/types/data-flow";
import type { SourceLocation } from "../../src/core/types/file";
import type { BenchmarkLayer } from "./schema";
import type { EvalLayer, FixtureScanResult, LayerFinding } from "../eval/types";
import { componentIdentity } from "../eval/layers/components/adapter";
import { dataFlowIdentity } from "../eval/layers/data-flows/adapter";
import { personalDataFindingToLayerFinding } from "../eval/layers/personal-data-adapter";
import { normalizeEvalPath } from "../eval/identity";

export function normalizeRepoRelativePath(filePath: string): string {
  return normalizeEvalPath(filePath);
}

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

function unionSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Scan a materialized corpus packet for the requested layers.
 * Orchestrator `scan()` runs at most once; personal-data matching at most once.
 */
export async function scanRepoByManifestLayers(
  repoKey: string,
  repoRoot: string,
  layers: BenchmarkLayer[],
): Promise<FixtureScanResult> {
  const wanted = new Set(layers.map((layer) => (layer === "pii_signals" ? "mentions" : layer)));
  const findings: LayerFinding[] = [];
  const scannedFiles: string[] = [];

  const needsOrchestrator = wanted.has("components") || wanted.has("data_flows");
  const needsPersonalData =
    wanted.has("mentions") || wanted.has("raw_hits") || wanted.has("data_items");

  if (needsOrchestrator) {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, files } = await scan(repoRoot, config);
    scannedFiles.push(...files.map((file) => normalizeRepoRelativePath(file.path)));

    if (wanted.has("components")) {
      findings.push(...scanResult.components.map(toComponentFinding));
    }

    if (wanted.has("data_flows")) {
      const componentsById = new Map(
        scanResult.components.map((component) => [component.id, component]),
      );
      findings.push(
        ...scanResult.dataFlows.map((flow) => toDataFlowFinding(flow, componentsById)),
      );
    }
  }

  if (needsPersonalData) {
    const payloadMentions = wanted.has("mentions")
      ? await collectPersonalDataFindings(repoRoot, "mentions")
      : undefined;
    const payloadRaw = wanted.has("raw_hits")
      ? await collectPersonalDataFindings(repoRoot, "raw-hits")
      : undefined;
    const payloadItems = wanted.has("data_items")
      ? await collectPersonalDataFindings(repoRoot, "data-items")
      : undefined;

    const first = payloadMentions ?? payloadRaw ?? payloadItems;
    if (first) {
      scannedFiles.push(...first.filesScanned.map(normalizeRepoRelativePath));
    }

    if (payloadMentions) {
      findings.push(
        ...payloadMentions.findings.map((finding) =>
          tagPersonalDataFinding(personalDataFindingToLayerFinding(finding), "mentions"),
        ),
      );
    }
    if (payloadRaw) {
      findings.push(
        ...payloadRaw.findings.map((finding) =>
          tagPersonalDataFinding(personalDataFindingToLayerFinding(finding), "raw-hits"),
        ),
      );
    }
    if (payloadItems) {
      findings.push(
        ...payloadItems.findings.map((finding) =>
          tagPersonalDataFinding(personalDataFindingToLayerFinding(finding), "data-items"),
        ),
      );
    }
  }

  return {
    fixture: repoKey,
    findings,
    scannedFiles: unionSorted(scannedFiles),
  };
}
