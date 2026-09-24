import type { DetectedComponent } from "../core/types/component";
import type { DataFlowType } from "../core/types/data-flow";
import type { DetectedDataFlow } from "../core/types/data-flow";

export type HubLinkRuleId = "auth_service" | "section_api" | "unlinked_asset";

export interface HubLinkRule {
  id: HubLinkRuleId;
  /** First matching rule wins for a given component. */
  matches: (component: DetectedComponent) => boolean;
  confidence: number;
  enrichmentNotes: string;
  description: string;
  flowType?: DataFlowType;
}

export function getSectionId(component: DetectedComponent): string {
  const sid = component.properties?.section_id;
  return typeof sid === "string" && sid.trim() ? sid.trim() : "";
}

export function isMainApplication(component: DetectedComponent): boolean {
  return (
    component.type === "asset" &&
    (component.properties?.isMainApplication === true ||
      component.properties?.isMainApplication === "true")
  );
}

export function isSyntheticSectionApiNode(
  component: DetectedComponent,
): boolean {
  return (
    component.properties?.isSectionApiNode === true ||
    component.properties?.isSectionApiNode === "true"
  );
}

export function componentHasFlow(
  componentId: string,
  flows: DetectedDataFlow[],
): boolean {
  return flows.some(
    (f) =>
      f.sourceComponentId === componentId ||
      f.targetComponentId === componentId,
  );
}

export function flowKey(
  sourceId: string,
  targetId: string,
  type: string,
): string {
  return `${sourceId}\t${targetId}\t${type}`;
}

export function nextFlowId(flows: DetectedDataFlow[], offset: number): string {
  let maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);
  return `flow_${maxFlowNum + offset}`;
}

/**
 * Ordered hub-link rules. Auth and section API fire before the catch-all so
 * enrichment notes / confidence stay specific.
 */
export const DEFAULT_HUB_LINK_RULES: HubLinkRule[] = [
  {
    id: "auth_service",
    matches: (c) => c.type === "asset" && c.subType === "auth_service",
    confidence: 0.75,
    enrichmentNotes: "auth_service_hub_link",
    description: "Application hub to auth service",
  },
  {
    id: "section_api",
    matches: (c) =>
      c.type === "asset" &&
      c.subType === "api" &&
      !isSyntheticSectionApiNode(c),
    confidence: 0.75,
    enrichmentNotes: "section_api_hub_link",
    description: "Section main to API surface",
  },
  {
    id: "unlinked_asset",
    matches: (c) => c.type === "asset" && !isSyntheticSectionApiNode(c),
    confidence: 0.55,
    enrichmentNotes: "unlinked_asset_hub_link",
    description: "Application hub to unlinked asset",
  },
];
