import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo, RawFinding } from "../core/types";
import { deriveFromTopology } from "./derive-from-topology";
import { mergeAssignmentsOntoComponents } from "./merge-assignments";

export {
  DATA_ACTIONS,
  DATA_ACTION_ALIASES,
  DATA_ACTION_FRAMEWORK_ANCHORS,
  DATA_ACTION_SET,
  isDataAction,
  normalizeDataAction,
  normalizeDataActionToken,
} from "./taxonomy";
export type { DataAction, DataActionFrameworkAnchor } from "./taxonomy";

export {
  deriveFromTopology,
  STORAGE_SUBTYPES,
} from "./derive-from-topology";
export {
  mergeAssignmentsOntoComponents,
  mergeOneAssignment,
  readDataActions,
  hasVerb,
} from "./merge-assignments";

/**
 * Deterministic data-action phase: topology heuristics → merge onto components.
 * `files` / `findings` are reserved for pattern rulepack (task 1.2).
 */
export function runDataActionPhase(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
  _files?: FileInfo[],
  _findings?: RawFinding[],
): void {
  const proposed = deriveFromTopology(components, dataFlows);
  mergeAssignmentsOntoComponents(components, proposed);
}
