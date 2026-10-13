import type { DetectedComponent, DetectedDataFlow, FileInfo, RawFinding } from "../types";
import type { ServiceSection } from "../sectioning/discover-service-sections";
import { detectDataFlows } from "../../data-flow";

export interface DataFlowPhaseOptions {
  enableDataFlowDetection: boolean;
  minimumConfidence: number;
  organizationDomains?: readonly string[];
}

export function runDataFlowPhase(
  files: FileInfo[],
  components: DetectedComponent[],
  findings: RawFinding[],
  sections: ServiceSection[],
  options: DataFlowPhaseOptions,
): DetectedDataFlow[] {
  if (!options.enableDataFlowDetection) return [];

  const flows = detectDataFlows(files, components, findings, sections, {
    organizationDomains: options.organizationDomains,
  });
  return flows.filter((flow) => flow.confidence >= options.minimumConfidence);
}

