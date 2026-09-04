import path from "path";

import {
  collectPersonalDataFindings,
  type PersonalDataEvalLayer,
  type PersonalDataFinding,
} from "../../../src/eval-layers/collect-personal-data-findings";
import { adaptPersonalDataFinding } from "../../../src/eval/canonical/scanner/personal-data";
import type { CanonicalScannerFinding } from "../../../src/eval/canonical/types";
import type { EvalLayer, FixtureScanResult, LayerFinding } from "../types";
import {
  fixtureScanResultWithLedger,
  layerLedgerFromOutcomes,
} from "../eligibility/build-fixture-result";

const FIXTURES_ROOT = path.join(__dirname, "../../fixtures");

export interface CanonicalFixtureScanResult {
  fixture: string;
  findings: CanonicalScannerFinding[];
  scannedFiles: string[];
  eligibilityLedgers?: Partial<Record<EvalLayer, import("../eligibility/types").LayerEligibilityLedger>>;
}

const PERSONAL_DATA_EVAL_LAYER: Record<PersonalDataEvalLayer, EvalLayer> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

function personalDataFixtureResult(
  fixture: string,
  layer: PersonalDataEvalLayer,
  payload: Awaited<ReturnType<typeof collectPersonalDataFindings>>,
  findings: LayerFinding[],
): FixtureScanResult {
  const evalLayer = PERSONAL_DATA_EVAL_LAYER[layer];
  const layerLedger = layerLedgerFromOutcomes(evalLayer, payload.layerOutcomes);
  return fixtureScanResultWithLedger(fixture, findings, layerLedger);
}

export function personalDataFindingToLayerFinding(
  finding: PersonalDataFinding,
): LayerFinding {
  const sourceLines = finding.evidenceLocations.map((location) => ({
    file_path: location.filePath,
    start_line: location.startLine,
    end_line: location.endLine,
  }));

  return {
    key: finding.subjectKey,
    labels: [...finding.labels],
    sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))].sort(),
    sourceLines,
  };
}

export async function scanFixturePersonalDataLayer(
  fixture: string,
  layer: PersonalDataEvalLayer,
): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const payload = await collectPersonalDataFindings(root, layer);

  return personalDataFixtureResult(
    fixture,
    layer,
    payload,
    payload.findings.map(personalDataFindingToLayerFinding),
  );
}

export async function scanCanonicalPersonalDataLayer(
  fixture: string,
  layer: PersonalDataEvalLayer,
): Promise<CanonicalFixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const payload = await collectPersonalDataFindings(root, layer);
  const evalLayer = PERSONAL_DATA_EVAL_LAYER[layer];
  const layerLedger = layerLedgerFromOutcomes(evalLayer, payload.layerOutcomes);

  return {
    fixture,
    findings: payload.findings.map((finding) => adaptPersonalDataFinding(finding, layer)),
    scannedFiles: layerLedger.outcomes
      .filter((outcome) => outcome.reason === "successfully_processed")
      .map((outcome) => outcome.path),
    eligibilityLedgers: { [evalLayer]: layerLedger },
  };
}
