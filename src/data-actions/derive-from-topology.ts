import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type {
  DataActionAssignment,
  TopologyEvidence,
} from "../core/types/data-action";
import { componentMayCarryDataActions } from "../core/types/data-action";
import type { DataAction } from "./taxonomy";

/** Asset subtypes that imply persistence (PRD cloud_storage → scanner `storage`). */
export const STORAGE_SUBTYPES: ReadonlySet<string> = new Set([
  "database",
  "storage",
]);

const TOPOLOGY_CONFIDENCE = 1;

function isAsserted(assignment: DataActionAssignment): boolean {
  return (assignment.status ?? "asserted") === "asserted";
}

function hasAssertedVerb(
  assignments: DataActionAssignment[],
  verb: DataAction,
): boolean {
  return assignments.some((a) => a.action === verb && isAsserted(a));
}

function topologyAssignment(
  action: DataAction,
  evidence: TopologyEvidence,
  status: DataActionAssignment["status"] = "asserted",
): DataActionAssignment {
  return {
    action,
    source: "deterministic",
    confidence: TOPOLOGY_CONFIDENCE,
    evidence,
    status,
  };
}

/**
 * Derive privacy verbs from the component/data-flow graph (PRD §4.3.1).
 * Returns proposed assignments keyed by component id (set-valued; callers merge).
 *
 * Emits only: collect, store, disclose, relay (candidate). Never asserts relay
 * without corroboration.
 */
export function deriveFromTopology(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
): Map<string, DataActionAssignment[]> {
  const byId = new Map(components.map((c) => [c.id, c]));
  const proposed = new Map<string, DataActionAssignment[]>();

  const push = (componentId: string, assignment: DataActionAssignment): void => {
    const component = byId.get(componentId);
    if (!component || !componentMayCarryDataActions(component.type)) {
      return;
    }
    const list = proposed.get(componentId) ?? [];
    list.push(assignment);
    proposed.set(componentId, list);
  };

  // --- Store from storage subtypes ---
  for (const component of components) {
    if (component.type !== "asset") continue;
    const subType = component.subType?.trim();
    if (!subType || !STORAGE_SUBTYPES.has(subType)) continue;
    push(
      component.id,
      topologyAssignment("store", {
        kind: "storage_subtype",
        description: `asset subtype ${subType}`,
        relatedComponentId: component.id,
      }),
    );
  }

  // --- Collect / disclose from edges ---
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const flow of dataFlows) {
    inDegree.set(
      flow.targetComponentId,
      (inDegree.get(flow.targetComponentId) ?? 0) + 1,
    );
    outDegree.set(
      flow.sourceComponentId,
      (outDegree.get(flow.sourceComponentId) ?? 0) + 1,
    );

    const source = byId.get(flow.sourceComponentId);
    const target = byId.get(flow.targetComponentId);
    if (!source || !target) continue;

    if (source.type === "actor" && componentMayCarryDataActions(target.type)) {
      push(
        target.id,
        topologyAssignment("collect", {
          kind: "inbound_from_actor",
          description: `inbound from actor ${source.name}`,
          dataFlowId: flow.id,
          relatedComponentId: source.id,
        }),
      );
    }

    if (
      componentMayCarryDataActions(source.type) &&
      target.type === "third_party"
    ) {
      push(
        source.id,
        topologyAssignment("disclose", {
          kind: "outbound_to_third_party",
          description: `outbound edge to third_party ${target.name}`,
          dataFlowId: flow.id,
          relatedComponentId: target.id,
        }),
      );
    }
  }

  // --- Relay candidates (after store/collect/disclose so "no store/use" sees them) ---
  for (const component of components) {
    if (!componentMayCarryDataActions(component.type)) continue;
    const inD = inDegree.get(component.id) ?? 0;
    const outD = outDegree.get(component.id) ?? 0;
    if (inD === 0 || outD === 0) continue;

    const existing = proposed.get(component.id) ?? [];
    if (hasAssertedVerb(existing, "store") || hasAssertedVerb(existing, "use")) {
      continue;
    }

    push(
      component.id,
      topologyAssignment(
        "relay",
        {
          kind: "relay_topology",
          description:
            "in-degree and out-degree with no store/use evidence (topology-only)",
        },
        "candidate",
      ),
    );
  }

  return proposed;
}
