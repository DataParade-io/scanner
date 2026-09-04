import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo, RawFinding } from "../core/types";
import type { DataActionAssignment } from "../core/types/data-action";
import { deriveFromTopology } from "./derive-from-topology";
import { deriveFromPatterns } from "./derive-from-patterns";
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
  deriveFromPatterns,
  pathsReferToSameFile,
} from "./derive-from-patterns";
export type { DeriveFromPatternsOptions } from "./derive-from-patterns";
export {
  loadDataActionRuleCatalog,
  loadDataActionRules,
  clearDataActionRulesCacheForTest,
  ruleAppliesToLanguage,
  DATA_ACTION_RULE_LANGUAGES,
} from "./rule-loader";
export type {
  DataActionPatternRule,
  DataActionRuleCatalog,
  DataActionRuleLanguage,
} from "./rule-loader";
export {
  mergeAssignmentsOntoComponents,
  mergeOneAssignment,
  readDataActions,
  hasVerb,
} from "./merge-assignments";

export interface RunDataActionPhaseOptions {
  /** Kill-switch for pattern rulepack (YAML `enabled` still applies when omitted). */
  enableDataActionPatterns?: boolean;
}

function mergeProposedMaps(
  ...maps: Array<Map<string, DataActionAssignment[]>>
): Map<string, DataActionAssignment[]> {
  const out = new Map<string, DataActionAssignment[]>();
  for (const map of maps) {
    for (const [id, list] of map) {
      const existing = out.get(id) ?? [];
      out.set(id, existing.concat(list));
    }
  }
  return out;
}

/**
 * Deterministic data-action phase: topology → pattern rules → merge onto components.
 * `findings` reserved for future subtype/classifier defaults (task 1.3).
 */
export function runDataActionPhase(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
  files?: FileInfo[],
  _findings?: RawFinding[],
  options: RunDataActionPhaseOptions = {},
): void {
  const topology = deriveFromTopology(components, dataFlows);
  const patterns =
    files && files.length > 0
      ? deriveFromPatterns(components, files, {
          enabled: options.enableDataActionPatterns,
        })
      : new Map<string, DataActionAssignment[]>();

  const proposed = mergeProposedMaps(topology, patterns);
  mergeAssignmentsOntoComponents(components, proposed);
}
