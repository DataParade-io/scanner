import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { findApplicationHubForFlows } from "./application-hub";
import {
  DEFAULT_HUB_LINK_RULES,
  componentHasFlow,
  flowKey,
  getSectionId,
  isMainApplication,
  nextFlowId,
  type HubLinkRule,
} from "./hub-link-policy";

/**
 * Links the section application hub to assets that still have no incident edges.
 * Rules are applied in order; the first matching rule wins per component.
 */
export function ensureHubToUnlinkedAssets(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  rules: HubLinkRule[] = DEFAULT_HUB_LINK_RULES,
): DetectedDataFlow[] {
  const flowKeys = new Set(
    flows.map((f) => flowKey(f.sourceComponentId, f.targetComponentId, f.type)),
  );
  const linkedIds = new Set<string>();
  const synthetic: DetectedDataFlow[] = [];

  const assets = components
    .filter((c) => c.type === "asset")
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const rule of rules) {
    for (const asset of assets) {
      if (linkedIds.has(asset.id)) continue;
      if (componentHasFlow(asset.id, flows)) continue;
      if (isMainApplication(asset)) continue;
      if (!rule.matches(asset)) continue;

      const sectionId = getSectionId(asset);
      const hub = findApplicationHubForFlows(
        components,
        sectionId || undefined,
      );
      if (!hub || hub.id === asset.id) continue;

      const type = rule.flowType ?? "api_call";
      const key = flowKey(hub.id, asset.id, type);
      if (flowKeys.has(key)) continue;
      flowKeys.add(key);
      linkedIds.add(asset.id);

      synthetic.push({
        id: nextFlowId(flows, synthetic.length + 1),
        sourceComponentId: hub.id,
        targetComponentId: asset.id,
        type,
        confidence: rule.confidence,
        description: rule.description,
        enrichmentNotes: rule.enrichmentNotes,
      });
    }
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}
