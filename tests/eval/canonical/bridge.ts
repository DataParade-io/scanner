import type { PersonalDataEvalLayer } from "../../../src/eval-layers/collect-personal-data-findings";
import { normalizeEvalPath } from "../identity";
import type { EvalCase, EvalLayer, LayerFinding } from "../types";
import { buildScannerFinding } from "./builders";
import { loadCanonicalGoldFromEvalCase } from "./gold/loader";
import { adaptPersonalDataFinding } from "./scanner/personal-data";
import { resolveScannerAdapterMapVersion } from "./scanner/manifest";
import type { CanonicalGoldExpectation, CanonicalScannerFinding, EvidenceLocation } from "./types";

const PERSONAL_DATA_LAYER: Record<"raw-hits" | "mentions" | "data-items", PersonalDataEvalLayer> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

function toEvidenceLocation(line: {
  file_path: string;
  start_line: number;
  end_line: number;
}): EvidenceLocation {
  return {
    file_path: normalizeEvalPath(line.file_path),
    start_line: line.start_line,
    end_line: line.end_line,
  };
}

function parseComponentKey(key: string): { componentType: string; name: string } {
  const separator = key.indexOf(":");
  if (separator === -1) {
    return { componentType: "", name: key.trim().toLowerCase() };
  }
  return {
    componentType: key.slice(0, separator).trim().toLowerCase(),
    name: key.slice(separator + 1).trim().toLowerCase(),
  };
}

function resolveComponentSubtype(
  componentType: string,
  labels: readonly string[],
): string | undefined {
  const typeLabel = labels[0]?.trim().toLowerCase();
  const subtypeLabel = labels[1]?.trim().toLowerCase();
  if (subtypeLabel && subtypeLabel !== componentType) {
    return subtypeLabel;
  }
  if (typeLabel && typeLabel !== componentType) {
    return typeLabel;
  }
  return subtypeLabel ?? typeLabel;
}

function layerFindingToComponent(
  finding: LayerFinding,
  adapterMapVersion: string,
): CanonicalScannerFinding {
  const { componentType, name } = parseComponentKey(finding.key);
  const evidenceLocations = finding.sourceLines.map(toEvidenceLocation);
  const subtype = resolveComponentSubtype(componentType, finding.labels);
  const optionalAssertion =
    componentType === "third_party" && name
      ? { vendor: name }
      : undefined;

  const base = {
    layer: "components" as const,
    identityKey: finding.key.trim().toLowerCase(),
    componentType,
    evidenceLocations,
    optionalAssertion,
    adapterMapVersion,
  };

  if (!subtype) {
    return buildScannerFinding({
      ...base,
      conceptLeaf: "",
      conceptAncestry: [],
      declaredCapabilitySupported: {
        supported: false,
        reason: "missing_component_subtype",
      },
    });
  }

  return buildScannerFinding({
    ...base,
    conceptLeaf: subtype,
    conceptAncestry: [subtype],
    componentSubtype: subtype,
  });
}

function layerFindingToPersonalData(
  finding: LayerFinding,
  layer: PersonalDataEvalLayer,
  adapterMapVersion: string,
): CanonicalScannerFinding {
  if (finding.sourceLines.length === 0) {
    throw new Error(`Personal-data finding '${finding.key}' is missing source lines`);
  }

  return adaptPersonalDataFinding(
    {
      subjectKey: finding.key,
      labels: [...finding.labels],
      evidenceLocations: finding.sourceLines.map((line) => ({
        filePath: normalizeEvalPath(line.file_path),
        startLine: line.start_line,
        endLine: line.end_line,
      })),
    },
    layer,
    adapterMapVersion,
  );
}

export function canonicalGoldFromEvalCase(
  caseRecord: EvalCase,
): CanonicalGoldExpectation & { id: string } {
  const { record } = loadCanonicalGoldFromEvalCase(caseRecord, {
    repoKey: caseRecord.fixture,
    warn: () => undefined,
  });
  return record;
}

export function canonicalFindingFromLayerFinding(
  finding: LayerFinding,
  layer: EvalLayer,
  findingId: string,
): CanonicalScannerFinding & { id: string } {
  const adapterMapVersion = resolveScannerAdapterMapVersion();
  let canonical: CanonicalScannerFinding;

  if (layer === "components") {
    canonical = layerFindingToComponent(finding, adapterMapVersion);
  } else if (layer === "raw-hits" || layer === "mentions" || layer === "data-items") {
    canonical = layerFindingToPersonalData(finding, PERSONAL_DATA_LAYER[layer], adapterMapVersion);
  } else {
    const evidenceLocations = finding.sourceLines.map(toEvidenceLocation);
    canonical = buildScannerFinding({
      layer: "data-flows",
      identityKey: finding.key.trim().toLowerCase(),
      conceptLeaf: finding.labels[0]?.trim().toLowerCase() ?? "",
      conceptAncestry: finding.labels.length > 0 ? [finding.labels[0]] : [],
      evidenceLocations,
      adapterMapVersion,
    });
  }

  return { ...canonical, id: findingId };
}

export function findingsForEvalLayer(
  findings: LayerFinding[],
  layer: EvalLayer,
  idPrefix: string,
): Array<CanonicalScannerFinding & { id: string }> {
  return findings
    .filter((finding) => finding.layer === undefined || finding.layer === layer)
    .map((finding, index) =>
      canonicalFindingFromLayerFinding(finding, layer, `${idPrefix}::finding-${index}`),
    );
}
