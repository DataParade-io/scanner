import { createHash } from "crypto";

import type { DetectedComponent } from "../types/component";
import type { DetectedDataFlow } from "../types/data-flow";
import type { ScanResult } from "../types/result";
import { stableComponentKey } from "./stable-component-ids";

/**
 * Content-derived, re-scan-stable entity ids.
 *
 * - Component id: `cmp_` + first 12 hex chars of sha256(component key).
 * - Flow id: `flow_` + first 12 hex chars of sha256(flow key), where the flow key
 *   is built from the source/target component keys, flow type, method,
 *   normalized endpoint and the first sorted source file path (no line numbers).
 *
 * Ids are a pure function of what the entity is, so adding or removing an
 * unrelated entity never renumbers the others. When two distinct entities hash
 * to the same id, they are sorted by their full canonical string (then a
 * source position, then a content fingerprint) and every one but the first gets
 * a `_2`, `_3`, … suffix.
 */

const HASH_HEX_LENGTH = 12;

export const STABLE_COMPONENT_ID_PREFIX = "cmp_";
export const STABLE_FLOW_ID_PREFIX = "flow_";

/** Matches ids minted by this module, including collision suffixes. */
export const STABLE_COMPONENT_ID_PATTERN = /^cmp_[0-9a-f]{12}(?:_\d+)?$/;
export const STABLE_FLOW_ID_PATTERN = /^flow_[0-9a-f]{12}(?:_\d+)?$/;

/** Locale-independent string ordering (code units), so ids match across machines. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function shortHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, HASH_HEX_LENGTH);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** JSON with sorted object keys, so fingerprints do not depend on insertion order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type ComponentKeyLookup =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

function lookupKey(lookup: ComponentKeyLookup, id: string): string | undefined {
  if (lookup instanceof Map) return lookup.get(id);
  const record = lookup as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(record, id) ? record[id] : undefined;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * {@link stableComponentKey}, except that a managed-service key's
 * `managed_by_provider` (a component id, which is itself not stable) is replaced
 * by the provider component's own key when the provider is in `componentsById`.
 */
export function resolvedStableComponentKey(
  component: DetectedComponent,
  componentsById?: ReadonlyMap<string, DetectedComponent>,
): string {
  return resolveKey(component, componentsById, new Set());
}

function resolveKey(
  component: DetectedComponent,
  componentsById: ReadonlyMap<string, DetectedComponent> | undefined,
  visiting: Set<DetectedComponent>,
): string {
  const key = stableComponentKey(component);
  if (!key.startsWith("managed:") || !componentsById) return key;
  const providerId = String(component.properties?.managed_by_provider ?? "").trim();
  const provider = componentsById.get(providerId);
  if (!provider || provider === component || visiting.has(component)) return key;
  visiting.add(component);
  const providerKey = resolveKey(provider, componentsById, visiting);
  visiting.delete(component);
  // `managed:<providerId>|<serviceKey>|<section>` → `managed:{<providerKey>}|…`
  return `managed:{${providerKey}}${key.slice("managed:".length + providerId.length)}`;
}

/**
 * Content-derived component id: `cmp_<12 hex>` of the component key. Does not
 * apply collision suffixes; use {@link assignStableEntityIds} for a whole scan.
 */
export function stableComponentId(
  component: DetectedComponent,
  componentsById?: ReadonlyMap<string, DetectedComponent>,
): string {
  return `${STABLE_COMPONENT_ID_PREFIX}${shortHash(resolvedStableComponentKey(component, componentsById))}`;
}

/** Tie-breaker for components that share a key: content only, no ids or id references. */
function componentFingerprint(component: DetectedComponent): string {
  const locations = (component.sourceLocations ?? [])
    .map((loc) => canonicalJson({ ...loc, filePath: normalizePath(loc.filePath) }))
    .sort(compareStrings);
  const detectedFrom = (component.detectedFrom ?? [])
    .map((ref) => canonicalJson(ref))
    .sort(compareStrings);
  return canonicalJson({
    name: component.name,
    type: component.type,
    subType: component.subType ?? null,
    description: component.description ?? null,
    locations,
    detectedFrom,
  });
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

function normalizeMethod(method: string | undefined): string {
  return (method ?? "").trim().toUpperCase();
}

/** Trim, collapse whitespace, unify slashes and drop trailing slashes. */
export function normalizeFlowEndpoint(endpoint: string | undefined): string {
  let value = (endpoint ?? "").trim().replace(/\s+/g, " ").replace(/\\/g, "/");
  while (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

function firstFlowSourceFilePath(flow: DetectedDataFlow): string {
  const paths: string[] = [];
  if (flow.sourceLocation?.filePath) paths.push(normalizePath(flow.sourceLocation.filePath));
  for (const loc of flow.sourceLocations ?? []) {
    if (loc.filePath) paths.push(normalizePath(loc.filePath));
  }
  paths.sort(compareStrings);
  return paths[0] ?? "";
}

/**
 * Canonical identity string of a flow. `componentKeyById` maps component ids to
 * component keys (see {@link buildComponentKeyById}); unknown ids fall back to
 * `id:<componentId>`.
 */
export function stableFlowKey(
  flow: DetectedDataFlow,
  componentKeyById: ComponentKeyLookup,
): string {
  const sourceKey =
    lookupKey(componentKeyById, flow.sourceComponentId) ?? `id:${flow.sourceComponentId}`;
  const targetKey =
    lookupKey(componentKeyById, flow.targetComponentId) ?? `id:${flow.targetComponentId}`;
  return canonicalJson([
    "flow/v1",
    sourceKey,
    targetKey,
    flow.type,
    normalizeMethod(flow.method),
    normalizeFlowEndpoint(flow.endpoint),
    firstFlowSourceFilePath(flow),
  ]);
}

/**
 * Content-derived flow id: `flow_<12 hex>` of {@link stableFlowKey}. Does not
 * apply collision suffixes; use {@link assignStableEntityIds} for a whole scan.
 */
export function stableFlowId(
  flow: DetectedDataFlow,
  componentKeyById: ComponentKeyLookup,
): string {
  return `${STABLE_FLOW_ID_PREFIX}${shortHash(stableFlowKey(flow, componentKeyById))}`;
}

/** Tie-breaker for flows that share a key: content only, endpoints by key. */
function flowFingerprint(flow: DetectedDataFlow, componentKeyById: ComponentKeyLookup): string {
  const locations = [
    ...(flow.sourceLocation ? [flow.sourceLocation] : []),
    ...(flow.sourceLocations ?? []),
  ]
    .map((loc) => canonicalJson({ ...loc, filePath: normalizePath(loc.filePath) }))
    .sort(compareStrings);
  const { id: _id, sourceComponentId: _s, targetComponentId: _t, sourceLocation: _l, sourceLocations: _ls, ...rest } = flow;
  return canonicalJson({
    key: stableFlowKey(flow, componentKeyById),
    locations,
    rest,
  });
}

// ---------------------------------------------------------------------------
// Collision-aware assignment
// ---------------------------------------------------------------------------

type Position = [filePath: string, startLine: number, endLine: number];

interface Keyed<T> {
  item: T;
  originalId: string;
  key: string;
  /** Sorted source positions; numeric so earlier code gets the unsuffixed id. */
  positions: Position[];
  fingerprint: string;
}

function positionsOf(
  locations: Array<{ filePath: string; startLine: number; endLine: number } | undefined>,
): Position[] {
  return locations
    .filter((loc): loc is { filePath: string; startLine: number; endLine: number } => !!loc)
    .map((loc): Position => [normalizePath(loc.filePath), loc.startLine ?? 0, loc.endLine ?? 0])
    .sort(comparePosition);
}

function comparePosition(a: Position, b: Position): number {
  return compareStrings(a[0], b[0]) || a[1] - b[1] || a[2] - b[2];
}

function comparePositions(a: Position[], b: Position[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const cmp = comparePosition(a[i] as Position, b[i] as Position);
    if (cmp !== 0) return cmp;
  }
  return a.length - b.length;
}

/**
 * Hash each key, then disambiguate collisions deterministically: within a
 * colliding group, sort by (key, positions, fingerprint, original id) and suffix all but the
 * first with `_2`, `_3`, …. Returns ids aligned with `entries` plus the keys made
 * unique the same way (identical keys get `#2`, `#3`, …).
 */
function assignWithCollisions<T>(
  entries: Keyed<T>[],
  prefix: string,
): { ids: string[]; uniqueKeys: string[] } {
  const groups = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const base = `${prefix}${shortHash(entry.key)}`;
    const group = groups.get(base);
    if (group) group.push(index);
    else groups.set(base, [index]);
  });

  const ids = new Array<string>(entries.length);
  const uniqueKeys = new Array<string>(entries.length);
  for (const [base, indexes] of groups) {
    indexes.sort((ia, ib) => {
      const a = entries[ia];
      const b = entries[ib];
      return (
        compareStrings(a.key, b.key) ||
        comparePositions(a.positions, b.positions) ||
        compareStrings(a.fingerprint, b.fingerprint) ||
        compareStrings(a.originalId, b.originalId)
      );
    });
    const keyCounts = new Map<string, number>();
    indexes.forEach((entryIndex, position) => {
      ids[entryIndex] = position === 0 ? base : `${base}_${position + 1}`;
      const key = entries[entryIndex].key;
      const seen = (keyCounts.get(key) ?? 0) + 1;
      keyCounts.set(key, seen);
      uniqueKeys[entryIndex] = seen === 1 ? key : `${key}#${seen}`;
    });
  }
  return { ids, uniqueKeys };
}

function computeComponentAssignment(components: DetectedComponent[]): {
  ids: string[];
  uniqueKeys: string[];
} {
  const byId = new Map<string, DetectedComponent>();
  for (const component of components) {
    if (!byId.has(component.id)) byId.set(component.id, component);
  }
  const entries: Keyed<DetectedComponent>[] = components.map((component) => ({
    item: component,
    originalId: component.id,
    key: resolvedStableComponentKey(component, byId),
    positions: positionsOf(component.sourceLocations ?? []),
    fingerprint: componentFingerprint(component),
  }));
  return assignWithCollisions(entries, STABLE_COMPONENT_ID_PREFIX);
}

/**
 * Component id → unique component key, for minting flow ids with
 * {@link stableFlowId}. Works on raw or already-finalized components (keys do not
 * depend on ids); keys shared by several components get `#2`, `#3`, … in the
 * same order {@link assignStableEntityIds} suffixes their ids.
 */
export function buildComponentKeyById(components: DetectedComponent[]): Map<string, string> {
  const { uniqueKeys } = computeComponentAssignment(components);
  const out = new Map<string, string>();
  components.forEach((component, index) => {
    if (!out.has(component.id)) out.set(component.id, uniqueKeys[index]);
  });
  return out;
}

export interface StableEntityIdAssignment {
  scanResult: ScanResult;
  /** Previous component id → new component id. */
  componentIdMap: Map<string, string>;
  /** Previous flow id → new flow id. */
  flowIdMap: Map<string, string>;
  /** New component id → unique component key (input to {@link stableFlowId}). */
  componentKeyById: Map<string, string>;
}

function remapId(map: Map<string, string>, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return map.get(id) ?? id;
}

function remapEvidence(
  evidence: unknown,
  componentIdMap: Map<string, string>,
  flowIdMap: Map<string, string>,
): unknown {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return evidence;
  const topo = { ...(evidence as Record<string, unknown>) };
  if (typeof topo.dataFlowId === "string") {
    const mapped = flowIdMap.get(topo.dataFlowId);
    if (mapped) topo.dataFlowId = mapped;
    else delete topo.dataFlowId; // referenced flow no longer exists in this result
  }
  if (typeof topo.relatedComponentId === "string") {
    const mapped = componentIdMap.get(topo.relatedComponentId);
    if (mapped) topo.relatedComponentId = mapped;
    else delete topo.relatedComponentId;
  }
  return topo;
}

function remapComponentProperties(
  properties: Record<string, unknown>,
  componentIdMap: Map<string, string>,
  flowIdMap: Map<string, string>,
): Record<string, unknown> {
  const next = { ...properties };
  const managedBy = next.managed_by_provider;
  if (typeof managedBy === "string" && componentIdMap.has(managedBy)) {
    next.managed_by_provider = componentIdMap.get(managedBy);
  }
  if (Array.isArray(next.dataActions)) {
    next.dataActions = next.dataActions.map((assignment: unknown) => {
      if (!assignment || typeof assignment !== "object") return assignment;
      const a = assignment as Record<string, unknown>;
      return { ...a, evidence: remapEvidence(a.evidence, componentIdMap, flowIdMap) };
    });
  }
  return next;
}

/**
 * Assign content-derived ids to every component and flow of `scanResult` and
 * rewrite every reference to them: flow endpoints, components' `dataFlowIds`,
 * `managed_by_provider`, data-action topology evidence, and AI inference
 * summaries/proposal details. Idempotent: running it on its own output is a no-op.
 */
export function assignStableEntityIdsWithMaps(scanResult: ScanResult): StableEntityIdAssignment {
  const components = scanResult.components;
  const { ids: componentIds, uniqueKeys } = computeComponentAssignment(components);

  const componentIdMap = new Map<string, string>();
  const keyByOldId = new Map<string, string>();
  components.forEach((component, index) => {
    if (componentIdMap.has(component.id)) return; // duplicate input ids: first wins
    componentIdMap.set(component.id, componentIds[index]);
    keyByOldId.set(component.id, uniqueKeys[index]);
  });

  const flows = scanResult.dataFlows;
  const flowEntries: Keyed<DetectedDataFlow>[] = flows.map((flow) => ({
    item: flow,
    originalId: flow.id,
    key: stableFlowKey(flow, keyByOldId),
    positions: positionsOf([flow.sourceLocation, ...(flow.sourceLocations ?? [])]),
    fingerprint: flowFingerprint(flow, keyByOldId),
  }));
  const { ids: flowIds } = assignWithCollisions(flowEntries, STABLE_FLOW_ID_PREFIX);
  const flowIdMap = new Map<string, string>();
  flows.forEach((flow, index) => {
    if (!flowIdMap.has(flow.id)) flowIdMap.set(flow.id, flowIds[index]);
  });

  const nextComponents = components.map((component, index) => {
    const next: DetectedComponent = {
      ...component,
      id: componentIds[index],
      properties: remapComponentProperties(component.properties ?? {}, componentIdMap, flowIdMap),
    };
    if (component.dataFlowIds !== undefined) {
      next.dataFlowIds = component.dataFlowIds
        .map((id) => flowIdMap.get(id))
        .filter((id): id is string => id !== undefined);
    }
    return next;
  });

  const nextFlows = flows.map((flow, index) => ({
    ...flow,
    id: flowIds[index],
    sourceComponentId: remapId(componentIdMap, flow.sourceComponentId) as string,
    targetComponentId: remapId(componentIdMap, flow.targetComponentId) as string,
  }));

  const next: ScanResult = { ...scanResult, components: nextComponents, dataFlows: nextFlows };

  if (scanResult.aiInferenceSummary) {
    const summary = { ...scanResult.aiInferenceSummary };
    if (summary.thirdPartyDataFlow) {
      summary.thirdPartyDataFlow = {
        ...summary.thirdPartyDataFlow,
        entries: summary.thirdPartyDataFlow.entries.map((entry) => ({
          ...entry,
          componentId: remapId(componentIdMap, entry.componentId) as string,
        })),
      };
    }
    if (summary.agenticTrace) {
      summary.agenticTrace = summary.agenticTrace.map((trace) => ({
        ...trace,
        componentId: remapId(componentIdMap, trace.componentId),
      }));
    }
    next.aiInferenceSummary = summary;
  }

  if (scanResult.aiInferenceProposalDetails) {
    next.aiInferenceProposalDetails = scanResult.aiInferenceProposalDetails.map((detail) => ({
      ...detail,
      targetComponentId: remapId(componentIdMap, detail.targetComponentId),
      targetFlowId: remapId(flowIdMap, detail.targetFlowId),
      sourceComponentId: remapId(componentIdMap, detail.sourceComponentId),
      targetFlowComponentId: remapId(componentIdMap, detail.targetFlowComponentId),
    }));
  }

  const componentKeyById = new Map<string, string>();
  nextComponents.forEach((component, index) => {
    if (!componentKeyById.has(component.id)) componentKeyById.set(component.id, uniqueKeys[index]);
  });

  return { scanResult: next, componentIdMap, flowIdMap, componentKeyById };
}

/** {@link assignStableEntityIdsWithMaps}, returning only the rewritten scan result. */
export function assignStableEntityIds(scanResult: ScanResult): ScanResult {
  return assignStableEntityIdsWithMaps(scanResult).scanResult;
}

/**
 * @deprecated Use {@link assignStableEntityIds}, which also assigns stable flow
 * ids and rewrites every reference. Kept for API compatibility: assigns
 * content-derived component ids and rewrites flow endpoints, `managed_by_provider`
 * and data-action topology evidence; flow ids are left unchanged.
 */
export function assignStableComponentIds(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
): { components: DetectedComponent[]; dataFlows: DetectedDataFlow[] } {
  const { ids } = computeComponentAssignment(components);
  const componentIdMap = new Map<string, string>();
  components.forEach((component, index) => {
    if (!componentIdMap.has(component.id)) componentIdMap.set(component.id, ids[index]);
  });
  const identityFlowMap = new Map(dataFlows.map((flow) => [flow.id, flow.id] as const));
  return {
    components: components.map((component, index) => ({
      ...component,
      id: ids[index],
      properties: remapComponentProperties(component.properties ?? {}, componentIdMap, identityFlowMap),
    })),
    dataFlows: dataFlows.map((flow) => ({
      ...flow,
      sourceComponentId: remapId(componentIdMap, flow.sourceComponentId) as string,
      targetComponentId: remapId(componentIdMap, flow.targetComponentId) as string,
    })),
  };
}
