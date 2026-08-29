import path from "path";

import { collectPersonalDataFindings } from "../../../../src/eval-layers/collect-personal-data-findings";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

function personalFindingToLayerFinding(finding: {
  subjectKey: string;
  labels: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}): LayerFinding {
  return {
    key: finding.subjectKey,
    labels: finding.labels,
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

export async function scanFixtureDataItems(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const payload = await collectPersonalDataFindings(root, "data-items");

  return {
    fixture,
    findings: payload.findings.map(personalFindingToLayerFinding),
    scannedFiles: payload.filesScanned,
  };
}
