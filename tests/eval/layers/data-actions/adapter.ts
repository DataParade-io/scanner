import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../../src/core/pipeline/orchestrator";
import { buildOrchestratorEvalLedgers } from "../../../../src/eval-layers/fixture-scan-ledger";
import type { DetectedComponent } from "../../../../src/core/types/component";
import type {
  DataActionAssignment,
  TopologyEvidence,
} from "../../../../src/core/types/data-action";
import { componentIdentity } from "../components/adapter";
import {
  fixtureScanResultWithLedger,
  layerLedgerFromOutcomes,
} from "../../eligibility/build-fixture-result";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

function isTopologyEvidence(evidence: DataActionAssignment["evidence"]): evidence is TopologyEvidence {
  return !Array.isArray(evidence) && typeof evidence === "object" && evidence !== null && "kind" in evidence;
}

function isAsserted(assignment: DataActionAssignment): boolean {
  return (assignment.status ?? "asserted") === "asserted";
}

function readAssignments(component: DetectedComponent): DataActionAssignment[] {
  const raw = component.properties.dataActions;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as DataActionAssignment[];
}

/**
 * One LayerFinding per asserted verb. Candidates are omitted (never gold-positive).
 * Multi-verb nodes therefore emit multiple findings sharing the same identity key.
 */
function toLayerFindings(component: DetectedComponent): LayerFinding[] {
  const key = componentIdentity(component);
  const findings: LayerFinding[] = [];

  for (const assignment of readAssignments(component)) {
    if (!isAsserted(assignment)) {
      continue;
    }

    const sourceLines = Array.isArray(assignment.evidence)
      ? assignment.evidence.map((location) => ({
          file_path: location.filePath,
          start_line: location.startLine,
          end_line: location.endLine,
        }))
      : component.sourceLocations.map((location) => ({
          file_path: location.filePath,
          start_line: location.startLine,
          end_line: location.endLine,
        }));

    findings.push({
      key,
      labels: [assignment.action],
      sourceFilePaths: [...new Set(sourceLines.map((line) => line.file_path))],
      sourceLines,
      layer: "data-actions",
    });
  }

  return findings;
}

/** Collect asserted assignments across a fixture scan for relay-audit. */
export function collectAssertedAssignments(
  components: DetectedComponent[],
): Array<{ componentKey: string; assignment: DataActionAssignment }> {
  const rows: Array<{ componentKey: string; assignment: DataActionAssignment }> = [];
  for (const component of components) {
    const key = componentIdentity(component);
    for (const assignment of readAssignments(component)) {
      if (isAsserted(assignment)) {
        rows.push({ componentKey: key, assignment });
      }
    }
  }
  return rows;
}

/**
 * Conservative-absence rule: asserted `relay` requires TopologyEvidence.corroboration.
 * Returns violation messages (empty = audit pass).
 */
export function auditAssertedRelayCorroboration(
  rows: Array<{ componentKey: string; assignment: DataActionAssignment }>,
): string[] {
  const violations: string[] = [];
  for (const { componentKey, assignment } of rows) {
    if (assignment.action !== "relay") {
      continue;
    }
    if (!isTopologyEvidence(assignment.evidence) || !assignment.evidence.corroboration?.trim()) {
      violations.push(
        `${componentKey}: asserted relay without TopologyEvidence.corroboration`,
      );
    }
  }
  return violations;
}

export async function scanFixtureDataActions(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, ledgerContext } = await scan(root, config);
  if (!ledgerContext) {
    throw new Error("Orchestrator scan missing ledger context");
  }
  const ledgers = buildOrchestratorEvalLedgers(ledgerContext);
  const layerLedger = layerLedgerFromOutcomes("data-actions", ledgers["data-actions"] ?? []);

  return fixtureScanResultWithLedger(
    fixture,
    scanResult.components.flatMap(toLayerFindings),
    layerLedger,
  );
}

/** Scan + return asserted assignment rows for relay-audit in eval.test. */
export async function scanFixtureDataActionAssignments(fixture: string): Promise<{
  scanResult: FixtureScanResult;
  asserted: Array<{ componentKey: string; assignment: DataActionAssignment }>;
}> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult, ledgerContext } = await scan(root, config);
  if (!ledgerContext) {
    throw new Error("Orchestrator scan missing ledger context");
  }
  const ledgers = buildOrchestratorEvalLedgers(ledgerContext);
  const layerLedger = layerLedgerFromOutcomes("data-actions", ledgers["data-actions"] ?? []);

  return {
    scanResult: fixtureScanResultWithLedger(
      fixture,
      scanResult.components.flatMap(toLayerFindings),
      layerLedger,
    ),
    asserted: collectAssertedAssignments(scanResult.components),
  };
}
