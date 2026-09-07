import type { DetectedComponent } from "../core/types/component";
import type {
  DataActionAssignment,
  DataActionAssignmentStatus,
  TopologyEvidence,
} from "../core/types/data-action";
import { componentMayCarryDataActions } from "../core/types/data-action";
import type { DataAction } from "./taxonomy";

function assignmentStatus(
  assignment: DataActionAssignment,
): DataActionAssignmentStatus {
  return assignment.status ?? "asserted";
}

function isTopologyEvidence(
  evidence: DataActionAssignment["evidence"],
): evidence is TopologyEvidence {
  return (
    !Array.isArray(evidence) &&
    typeof evidence === "object" &&
    evidence !== null &&
    "kind" in evidence
  );
}

function provenanceRank(source: DataActionAssignment["source"]): number {
  // Higher wins when choosing which assignment to keep for a verb.
  if (source === "user") return 3;
  if (source === "deterministic") return 2;
  return 1; // ai
}

function statusRank(status: DataActionAssignmentStatus): number {
  return status === "asserted" ? 2 : 1;
}

function mergeEvidence(
  a: DataActionAssignment["evidence"],
  b: DataActionAssignment["evidence"],
): DataActionAssignment["evidence"] {
  if (Array.isArray(a) && Array.isArray(b)) {
    return [...a, ...b];
  }
  if (isTopologyEvidence(a) && isTopologyEvidence(b)) {
    const descriptions = [a.description, b.description].filter(Boolean);
    return {
      ...a,
      ...b,
      description: [...new Set(descriptions)].join("; "),
      corroboration: a.corroboration ?? b.corroboration,
      dataFlowId: a.dataFlowId ?? b.dataFlowId,
      relatedComponentId: a.relatedComponentId ?? b.relatedComponentId,
      ruleId: a.ruleId ?? b.ruleId,
    };
  }
  // Prefer keeping the winner's evidence shape when mixed.
  return a;
}

/**
 * Merge one incoming assignment into an existing list for the same component.
 * Dedupes by verb; asserted beats candidate; user provenance is sticky.
 */
export function mergeOneAssignment(
  existing: DataActionAssignment[],
  incoming: DataActionAssignment,
): DataActionAssignment[] {
  const idx = existing.findIndex((a) => a.action === incoming.action);
  if (idx < 0) {
    return [...existing, incoming];
  }

  const current = existing[idx]!;

  // User assignments are never overwritten by machine sources.
  if (current.source === "user" && incoming.source !== "user") {
    return existing;
  }

  const currentStatus = assignmentStatus(current);
  const incomingStatus = assignmentStatus(incoming);

  const preferIncoming =
    statusRank(incomingStatus) > statusRank(currentStatus) ||
    (statusRank(incomingStatus) === statusRank(currentStatus) &&
      provenanceRank(incoming.source) > provenanceRank(current.source)) ||
    (statusRank(incomingStatus) === statusRank(currentStatus) &&
      provenanceRank(incoming.source) === provenanceRank(current.source) &&
      incoming.confidence > current.confidence);

  const winner = preferIncoming ? incoming : current;
  const loser = preferIncoming ? current : incoming;

  const merged: DataActionAssignment = {
    ...winner,
    confidence: Math.max(current.confidence, incoming.confidence),
    status: statusRank(incomingStatus) >= statusRank(currentStatus)
      ? incomingStatus === "asserted" || currentStatus === "asserted"
        ? "asserted"
        : incomingStatus
      : currentStatus === "asserted"
        ? "asserted"
        : currentStatus,
    evidence: mergeEvidence(winner.evidence, loser.evidence),
  };

  // Conservative-absence: never promote relay to asserted without corroboration.
  if (merged.action === "relay" && assignmentStatus(merged) === "asserted") {
    const evidence = merged.evidence;
    if (
      !isTopologyEvidence(evidence) ||
      !evidence.corroboration ||
      evidence.corroboration.trim() === ""
    ) {
      merged.status = "candidate";
    }
  }

  const next = [...existing];
  next[idx] = merged;
  return next;
}

/**
 * Apply proposed assignments (by component id) onto components in place.
 * Set-valued: accumulates all 11 verbs; never writes onto actors (DA-1).
 */
export function mergeAssignmentsOntoComponents(
  components: DetectedComponent[],
  proposedByComponentId: Map<string, DataActionAssignment[]>,
): void {
  for (const component of components) {
    if (!componentMayCarryDataActions(component.type)) {
      // Strip any accidental actor dataActions.
      if ("dataActions" in component.properties) {
        delete component.properties.dataActions;
      }
      continue;
    }

    const proposed = proposedByComponentId.get(component.id) ?? [];
    if (proposed.length === 0 && !Array.isArray(component.properties.dataActions)) {
      continue;
    }

    const existingRaw = component.properties.dataActions;
    let merged: DataActionAssignment[] = Array.isArray(existingRaw)
      ? ([...existingRaw] as DataActionAssignment[])
      : [];

    for (const assignment of proposed) {
      merged = mergeOneAssignment(merged, assignment);
    }

    // Stable order by action name for determinism.
    merged.sort((a, b) => a.action.localeCompare(b.action));
    component.properties.dataActions = merged;
  }
}

/** Read asserted+candidate assignments from a component (empty if absent/actor). */
export function readDataActions(
  component: DetectedComponent,
): DataActionAssignment[] {
  if (!componentMayCarryDataActions(component.type)) return [];
  const raw = component.properties.dataActions;
  if (!Array.isArray(raw)) return [];
  return raw as DataActionAssignment[];
}

export function hasVerb(
  component: DetectedComponent,
  action: DataAction,
  opts?: { assertedOnly?: boolean },
): boolean {
  return readDataActions(component).some((a) => {
    if (a.action !== action) return false;
    if (opts?.assertedOnly) return assignmentStatus(a) === "asserted";
    return true;
  });
}
