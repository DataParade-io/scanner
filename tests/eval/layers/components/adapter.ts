import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../../src/core/pipeline/orchestrator";
import { buildOrchestratorEvalLedgers } from "../../../../src/eval-layers/fixture-scan-ledger";
import type { DetectedComponent } from "../../../../src/core/types/component";
import {
  adaptDetectedComponent,
  componentScannerIdentityKey,
} from "../../../../src/eval/canonical/scanner/components";
import {
  fixtureScanResultWithLedger,
  layerLedgerFromOutcomes,
} from "../../eligibility/build-fixture-result";
import type { CanonicalFixtureScanResult } from "../personal-data-adapter";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

/** Hybrid identity: asset/actor by subtype, third_party by name. */
export function componentIdentity(component: DetectedComponent): string {
  return componentScannerIdentityKey(component);
}

function toLayerFinding(component: DetectedComponent): LayerFinding {
  const labels: string[] = [component.type];
  if (component.subType) {
    labels.push(component.subType);
  }

  return {
    key: componentIdentity(component),
    labels,
    sourceFilePaths: component.sourceLocations.map((location) => location.filePath),
    sourceLines: component.sourceLocations.map((location) => ({
      file_path: location.filePath,
      start_line: location.startLine,
      end_line: location.endLine,
    })),
  };
}

export async function scanFixtureComponents(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, ledgerContext } = await scan(root, config);
  if (!ledgerContext) {
    throw new Error("Orchestrator scan missing ledger context");
  }
  const ledgers = buildOrchestratorEvalLedgers(ledgerContext);
  const layerLedger = layerLedgerFromOutcomes("components", ledgers.components ?? []);

  return fixtureScanResultWithLedger(
    fixture,
    scanResult.components.map(toLayerFinding),
    layerLedger,
  );
}

export async function scanCanonicalComponents(fixture: string): Promise<CanonicalFixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, ledgerContext } = await scan(root, config);
  if (!ledgerContext) {
    throw new Error("Orchestrator scan missing ledger context");
  }
  const ledgers = buildOrchestratorEvalLedgers(ledgerContext);
  const layerLedger = layerLedgerFromOutcomes("components", ledgers.components ?? []);

  return {
    fixture,
    findings: scanResult.components.map((component) => adaptDetectedComponent(component)),
    scannedFiles: layerLedger.outcomes
      .filter((outcome) => outcome.reason === "successfully_processed")
      .map((outcome) => outcome.path),
    eligibilityLedgers: { components: layerLedger },
  };
}
