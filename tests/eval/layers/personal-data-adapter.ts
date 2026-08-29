import path from "path";

import {
  collectPersonalDataFindings,
  type PersonalDataEvalLayer,
  type PersonalDataFinding,
} from "../../../src/eval-layers/collect-personal-data-findings";
import type { FixtureScanResult, LayerFinding } from "../types";

const FIXTURES_ROOT = path.join(__dirname, "../../fixtures");

export function personalDataFindingToLayerFinding(
  finding: PersonalDataFinding,
): LayerFinding {
  return {
    key: finding.subjectKey,
    labels: [...finding.labels],
    sourceFilePaths: [finding.filePath],
    sourceLines: [
      {
        file_path: finding.filePath,
        start_line: finding.startLine,
        end_line: finding.endLine,
      },
    ],
  };
}

export async function scanFixturePersonalDataLayer(
  fixture: string,
  layer: PersonalDataEvalLayer,
): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const payload = await collectPersonalDataFindings(root, layer);

  return {
    fixture,
    findings: payload.findings.map(personalDataFindingToLayerFinding),
    scannedFiles: payload.filesScanned,
  };
}
