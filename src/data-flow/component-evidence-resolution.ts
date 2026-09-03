import type { DetectedComponent } from "../core/types/component";
import type { DataFlowType } from "../core/types/data-flow";
import type { SourceLocation } from "../core/types/file";
import { normalizeProjectPath } from "./import-graph";
import { hasStrongTransformationOnSpan } from "./transformation-patterns";

export interface EvidenceSpan {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ResolveComponentOptions {
  flowType?: DataFlowType;
  span?: string;
  contextSpan?: string;
}

function normalizeEvidencePath(filePath: string): string {
  return normalizeProjectPath(filePath);
}

function spansOverlap(
  left: Pick<EvidenceSpan, "startLine" | "endLine">,
  right: Pick<SourceLocation, "startLine" | "endLine">,
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function componentSpanSize(location: SourceLocation): number {
  return location.endLine - location.startLine + 1;
}

function resolveStrictOverlap(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
): DetectedComponent | undefined {
  const normalizedPath = normalizeEvidencePath(evidence.filePath);
  const candidates = new Map<
    string,
    { component: DetectedComponent; spanSize: number }
  >();

  for (const component of components) {
    if (!component.sourceLocations || component.sourceLocations.length === 0) {
      continue;
    }

    let smallestSpanForComponent: number | undefined;

    for (const location of component.sourceLocations) {
      if (normalizeEvidencePath(location.filePath) !== normalizedPath) {
        continue;
      }
      if (!spansOverlap(evidence, location)) {
        continue;
      }
      const spanSize = componentSpanSize(location);
      if (
        smallestSpanForComponent === undefined ||
        spanSize < smallestSpanForComponent
      ) {
        smallestSpanForComponent = spanSize;
      }
    }

    if (smallestSpanForComponent !== undefined) {
      candidates.set(component.id, {
        component,
        spanSize: smallestSpanForComponent,
      });
    }
  }

  const ranked = [...candidates.values()].sort((left, right) => {
    if (left.spanSize !== right.spanSize) {
      return left.spanSize - right.spanSize;
    }
    return left.component.id.localeCompare(right.component.id);
  });

  const best = ranked[0];
  if (!best) {
    return undefined;
  }
  if (ranked.length >= 2 && ranked[1]!.spanSize === best.spanSize) {
    return undefined;
  }

  return best.component;
}

function componentsInSameFile(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
): DetectedComponent[] {
  const normalizedPath = normalizeEvidencePath(evidence.filePath);
  const matches: DetectedComponent[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    if (!component.sourceLocations?.length || seen.has(component.id)) {
      continue;
    }
    const inFile = component.sourceLocations.some(
      (location) => normalizeEvidencePath(location.filePath) === normalizedPath,
    );
    if (inFile) {
      seen.add(component.id);
      matches.push(component);
    }
  }

  return matches;
}

function inferPreferredSubTypes(
  flowType: DataFlowType | undefined,
  span: string,
  contextSpan: string,
): string[] {
  const text = `${span}\n${contextSpan}`;
  const preferred: string[] = [];

  if (/jwt|tokenkey|verification_token|authenticate|signon|auth_token/i.test(text)) {
    preferred.push("auth_service");
  }
  if (/CharField|models\.|DriverValue|bcrypt|GenerateFromPassword|wpdb|\.save\s*\(/i.test(text)) {
    preferred.push("database");
  }
  if (/customer|User\.email|actor/i.test(text)) {
    preferred.push("customer");
  }
  if (flowType === "database_query") {
    preferred.push("database");
  }
  if (flowType === "api_call") {
    preferred.push("api");
  }

  return [...new Set(preferred)];
}

function resolveDirectoryWithPreference(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[],
  span: string,
): DetectedComponent | undefined {
  if (!hasStrongTransformationOnSpan(span)) {
    return undefined;
  }

  const directory = directoryOf(evidence.filePath);
  if (!directory) {
    return undefined;
  }

  const inDirectory = components.filter((component) =>
    component.sourceLocations?.some(
      (location) => directoryOf(location.filePath) === directory,
    ),
  );
  if (inDirectory.length === 0) {
    return undefined;
  }

  for (const subType of preferredSubTypes) {
    const matches = inDirectory.filter((component) => component.subType === subType);
    if (matches.length === 1) {
      return matches[0];
    }
  }

  return undefined;
}

function directoryOf(filePath: string): string {
  const normalized = normalizeEvidencePath(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function resolveSameFileWithPreference(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[],
): DetectedComponent | undefined {
  const sameFile = componentsInSameFile(components, evidence);
  if (sameFile.length === 1) {
    return sameFile[0];
  }
  if (sameFile.length === 0) {
    return undefined;
  }

  for (const subType of preferredSubTypes) {
    const matches = sameFile.filter((component) => component.subType === subType);
    if (matches.length === 1) {
      return matches[0];
    }
  }

  return undefined;
}

/**
 * Resolve the single best component owner for an evidence span.
 * Returns undefined when no component overlaps or multiple equally tight matches exist.
 */
export function resolveComponentForEvidence(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  options: ResolveComponentOptions = {},
): DetectedComponent | undefined {
  const strict = resolveStrictOverlap(components, evidence);
  if (strict) {
    return strict;
  }

  const preferredSubTypes = inferPreferredSubTypes(
    options.flowType,
    options.span ?? "",
    options.contextSpan ?? "",
  );

  const sameFile = resolveSameFileWithPreference(
    components,
    evidence,
    preferredSubTypes,
  );
  if (sameFile) {
    return sameFile;
  }

  return resolveDirectoryWithPreference(
    components,
    evidence,
    preferredSubTypes,
    options.span ?? "",
  );
}
