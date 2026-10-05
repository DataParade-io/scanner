import type { SourceLocation } from "../core/types/file";
import type { DetectedComponent } from "../core/types/component";

export interface PropertyEvidenceRef {
  filePath: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export type PropertyEvidenceMap = Record<string, PropertyEvidenceRef[]>;

const INTERNAL_PROPERTY_KEYS = new Set([
  "propertyEvidence",
  "inference_status",
  "isMainApplication",
  "isSectionApiNode",
  "sourceContext",
  "section_id",
  "section_label",
  "section_role",
  "dataActions",
  "primaryDataAction",
]);

export function isInternalPropertyKey(key: string): boolean {
  if (INTERNAL_PROPERTY_KEYS.has(key)) return true;
  return key.startsWith("section_");
}

/** Values that do not require per-property evidence (empty / schema default). */
export function isEmptyLikePropertyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value === false) return true;
  if (typeof value === "string" && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function isValuedUserProperty(key: string, value: unknown): boolean {
  if (isInternalPropertyKey(key)) return false;
  return !isEmptyLikePropertyValue(value);
}

function isEvidenceRef(value: unknown): value is PropertyEvidenceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.filePath === "string" &&
    typeof ref.startLine === "number" &&
    typeof ref.endLine === "number" &&
    typeof ref.reason === "string"
  );
}

export function readPropertyEvidenceMap(raw: unknown): PropertyEvidenceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: PropertyEvidenceMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const refs = value.filter(isEvidenceRef);
    if (refs.length > 0) out[key] = refs;
  }
  return out;
}

function evidenceRefKey(ref: PropertyEvidenceRef): string {
  return `${ref.filePath}:${ref.startLine}:${ref.endLine}:${ref.reason}`;
}

export function unionEvidenceRefs(
  existing: PropertyEvidenceRef[] | undefined,
  incoming: PropertyEvidenceRef[],
): PropertyEvidenceRef[] {
  const merged: PropertyEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const ref of [...(existing ?? []), ...incoming]) {
    if (!isEvidenceRef(ref)) continue;
    const key = evidenceRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged;
}

/** Union `propertyEvidence` maps by key (scanner grouping / collapse). */
export function mergePropertyEvidenceMaps(
  existingRaw: unknown,
  incomingRaw: unknown,
): PropertyEvidenceMap | undefined {
  const next = readPropertyEvidenceMap(existingRaw);
  const incoming = readPropertyEvidenceMap(incomingRaw);
  for (const [key, refs] of Object.entries(incoming)) {
    next[key] = unionEvidenceRefs(next[key], refs);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function evidenceRefFromLocation(
  location: SourceLocation,
  reason: string,
): PropertyEvidenceRef | undefined {
  if (!location.filePath) return undefined;
  return {
    filePath: location.filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    reason,
  };
}

export function appendPropertyEvidence(
  properties: Record<string, unknown>,
  key: string,
  refs: PropertyEvidenceRef[],
): void {
  if (refs.length === 0) return;
  const current = readPropertyEvidenceMap(properties.propertyEvidence);
  current[key] = unionEvidenceRefs(current[key], refs);
  properties.propertyEvidence = current;
}

/**
 * For valued keys that still lack citations, cite `location`.
 * Inference-authored evidence is left intact.
 */
export function ensureLocationEvidenceForValuedKeys(
  properties: Record<string, unknown>,
  location: SourceLocation,
  reason: string,
): void {
  const ref = evidenceRefFromLocation(location, reason);
  if (!ref) return;
  const current = readPropertyEvidenceMap(properties.propertyEvidence);
  for (const [key, value] of Object.entries(properties)) {
    if (!isValuedUserProperty(key, value)) continue;
    if ((current[key]?.length ?? 0) > 0) continue;
    current[key] = [ref];
  }
  if (Object.keys(current).length > 0) {
    properties.propertyEvidence = current;
  }
}

export function heuristicEvidenceRefs(
  component: Pick<DetectedComponent, "sourceLocations" | "detectedFrom">,
  fnName: string,
): PropertyEvidenceRef[] {
  const reason = `scanner_heuristic:${fnName}`;
  const refs: PropertyEvidenceRef[] = [];
  const seen = new Set<string>();

  const push = (loc: SourceLocation | undefined): void => {
    if (!loc) return;
    const ref = evidenceRefFromLocation(loc, reason);
    if (!ref) return;
    const key = evidenceRefKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const loc of component.sourceLocations ?? []) {
    push(loc);
  }
  for (const detected of component.detectedFrom ?? []) {
    push(detected.sourceLocation);
  }
  return refs;
}
