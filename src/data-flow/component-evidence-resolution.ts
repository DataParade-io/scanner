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

function lineDistanceToLocation(
  evidence: EvidenceSpan,
  location: SourceLocation,
): number {
  if (evidence.startLine < location.startLine) {
    return location.startLine - evidence.startLine;
  }
  if (evidence.startLine > location.endLine) {
    return evidence.startLine - location.endLine;
  }
  return 0;
}

function resolveNearestSpanInFile(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[] = [],
): DetectedComponent | undefined {
  const normalizedPath = normalizeEvidencePath(evidence.filePath);
  const ranked: Array<{ component: DetectedComponent; distance: number }> = [];

  for (const component of components) {
    if (!component.sourceLocations?.length) {
      continue;
    }

    let bestDistance: number | undefined;
    for (const location of component.sourceLocations) {
      if (normalizeEvidencePath(location.filePath) !== normalizedPath) {
        continue;
      }
      const distance = lineDistanceToLocation(evidence, location);
      if (bestDistance === undefined || distance < bestDistance) {
        bestDistance = distance;
      }
    }

    if (bestDistance !== undefined) {
      ranked.push({ component, distance: bestDistance });
    }
  }

  ranked.sort((left, right) => {
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    return left.component.id.localeCompare(right.component.id);
  });

  const best = ranked[0];
  if (!best) {
    return undefined;
  }

  const tied = ranked.filter((entry) => entry.distance === best.distance);
  if (tied.length === 1) {
    return best.component;
  }

  for (const subType of preferredSubTypes) {
    const preferred = tied.filter((entry) => entry.component.subType === subType);
    if (preferred.length === 1) {
      return preferred[0]!.component;
    }
    if (subType === "customer") {
      const customerActors = tied.filter(
        (entry) => entry.component.type === "actor" && entry.component.subType === "customer",
      );
      if (customerActors.length === 1) {
        return customerActors[0]!.component;
      }
    }
  }

  return undefined;
}

function inferPreferredSubTypes(
  flowType: DataFlowType | undefined,
  span: string,
  contextSpan: string,
): string[] {
  const text = `${span}\n${contextSpan}`;
  const preferred: string[] = [];

  if (/jwt|tokenkey|verification_token|authenticate|signon|auth_token|session_store|has_secure_password|check_password/i.test(text)) {
    preferred.push("auth_service");
  }
  if (
    /CharField|models\.|DriverValue|bcrypt|GenerateFromPassword|wpdb|\.save\s*\(/i.test(text) ||
    /has_one|has_many|belongs_to|ActiveRecord/i.test(text)
  ) {
    preferred.push("database");
  }
  if (/customer|User\.email|actor|belongs_to\s+:customer/i.test(text)) {
    preferred.push("customer");
  }
  if (/session_store|has_secure_password/i.test(text)) {
    preferred.unshift("auth_service");
  }
  if (/<route\s+url=|routes\.rb|webapi\.xml/i.test(text)) {
    preferred.push("api");
  }
  if (/export\s*\*\s*from|discoveryPath/i.test(text)) {
    preferred.push("api");
  }
  if (flowType === "database_query") {
    preferred.push("database");
  }
  if (flowType === "api_call") {
    preferred.push("api");
  }
  if (/repository|repositories\//i.test(text)) {
    preferred.push("service");
  }
  if (/controllers?\/|router-controller|member-controller/i.test(text)) {
    preferred.push("api");
  }

  return [...new Set(preferred)];
}

function resolveDirectoryWithPreference(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[],
  span: string,
  contextSpan: string,
): DetectedComponent | undefined {
  if (!hasStrongTransformationOnSpan(span, contextSpan)) {
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

function moduleNameFromPath(filePath: string): string | undefined {
  const normalized = normalizeEvidencePath(filePath);
  const modulesMatch = normalized.match(/(?:^|\/)modules\/([^/]+)\.ts$/i);
  if (modulesMatch) {
    return modulesMatch[1];
  }
  const srcModulesMatch = normalized.match(/src\/modules\/([^/]+)\.ts$/i);
  if (srcModulesMatch) {
    return srcModulesMatch[1];
  }
  return undefined;
}

function resolveModuleReexport(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  span: string,
  contextSpan: string,
): DetectedComponent | undefined {
  const text = `${span}\n${contextSpan}`;
  if (!/export\s*\*\s*from|discoveryPath/i.test(text)) {
    return undefined;
  }

  const moduleName = moduleNameFromPath(evidence.filePath);
  if (!moduleName) {
    return undefined;
  }

  const normalizedModule = moduleName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const candidates = components.filter((component) => {
    const nameKey = component.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const idKey = component.id.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      nameKey.includes(normalizedModule) ||
      idKey.includes(normalizedModule) ||
      component.sourceLocations?.some((location) =>
        normalizeEvidencePath(location.filePath).includes(moduleName),
      )
    );
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  return resolveNearestSpanInFile(candidates, evidence);
}

function resolveRailsModelFile(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  span: string = "",
  preferredSubTypes: string[] = [],
): DetectedComponent | undefined {
  const path = normalizeEvidencePath(evidence.filePath);
  if (!/(?:^|\/)app\/models\/.*\.rb$/i.test(path) && !/_model\.rb$/i.test(path)) {
    return undefined;
  }

  const isUserModel =
    /(?:^|\/)app\/models\/user\.rb$/i.test(path) ||
    /(?:^|\/)app\/models\/.*\/user\.rb$/i.test(path);
  const isUserPasswordModel = /(?:^|\/)app\/models\/user_password\.rb$/i.test(path);

  if (
    isUserPasswordModel &&
    /password_validator|UserPasswordValidator|raw_password/i.test(span)
  ) {
    const authServices = componentsInSameFile(components, evidence).filter(
      (component) => component.subType === "auth_service",
    );
    if (authServices.length === 1) {
      return authServices[0];
    }
    const nearestAuth = resolveNearestSpanInFile(authServices, evidence, ["auth_service"]);
    if (nearestAuth) {
      return nearestAuth;
    }
  }

  if (
    /user_second_factor\.rb$/i.test(path) &&
    /\bscope\s+:\w*totp/i.test(span)
  ) {
    const authServices = componentsInSameFile(components, evidence).filter(
      (component) => component.subType === "auth_service",
    );
    if (authServices.length === 1) {
      return authServices[0];
    }
    const nearestAuth = resolveNearestSpanInFile(authServices, evidence, ["auth_service"]);
    if (nearestAuth) {
      return nearestAuth;
    }
  }

  if (
    isUserModel &&
    /\bafter_(?:create|save|update)\s+:/i.test(span)
  ) {
    const customerActors = componentsInSameFile(components, evidence).filter(
      (component) => component.type === "actor" && component.subType === "customer",
    );
    if (customerActors.length === 1) {
      return customerActors[0];
    }
  }

  if (
    isUserModel &&
    /password|email|user_password|has_one|belongs_to/i.test(span)
  ) {
    const customerActors = componentsInSameFile(components, evidence).filter(
      (component) => component.type === "actor" && component.subType === "customer",
    );
    if (customerActors.length === 1) {
      return customerActors[0];
    }
  }

  if (
    isUserModel &&
    /check_password|try_to_login|hashed_password|authenticate/i.test(span)
  ) {
    const authServices = componentsInSameFile(components, evidence).filter(
      (component) => component.subType === "auth_service",
    );
    if (authServices.length === 1) {
      return authServices[0];
    }
  }

  const strict = resolveStrictOverlap(components, evidence);
  if (strict) {
    return strict;
  }

  const nearest = resolveNearestSpanInFile(components, evidence, preferredSubTypes);
  if (nearest) {
    return nearest;
  }

  const subtypePreference = ["customer", "database", "actor", ...preferredSubTypes];
  for (const subType of [...new Set(subtypePreference)]) {
    const sameFile = componentsInSameFile(components, evidence).filter(
      (component) => component.subType === subType,
    );
    if (sameFile.length === 1) {
      return sameFile[0];
    }
  }

  return undefined;
}

function resolveRailsInitializerFile(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  span: string,
  contextSpan: string,
): DetectedComponent | undefined {
  const path = normalizeEvidencePath(evidence.filePath);
  if (!/(?:^|\/)config\/initializers\/.*\.rb$/i.test(path)) {
    return undefined;
  }

  const text = `${span}\n${contextSpan}`;
  if (!/session_store|has_secure_password|authenticate/i.test(text)) {
    return undefined;
  }

  const strict = resolveStrictOverlap(components, evidence);
  if (strict) {
    return strict;
  }

  const nearest = resolveNearestSpanInFile(components, evidence, ["auth_service"]);
  if (nearest) {
    return nearest;
  }

  const authInFile = componentsInSameFile(components, evidence).filter(
    (component) => component.subType === "auth_service",
  );
  if (authInFile.length === 1) {
    return authInFile[0];
  }

  return undefined;
}

function pathModuleHint(filePath: string): string | undefined {
  const normalized = normalizeEvidencePath(filePath);
  const magentoMatch = normalized.match(/Magento\/([^/]+)/i);
  if (magentoMatch) {
    return magentoMatch[1].toLowerCase();
  }
  const modulesMatch = normalized.match(/(?:^|\/)modules\/([^/]+)/i);
  if (modulesMatch) {
    return modulesMatch[1].toLowerCase();
  }
  return undefined;
}

function resolveModuleHintComponent(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[],
): DetectedComponent | undefined {
  const hint = pathModuleHint(evidence.filePath);
  if (!hint) {
    return undefined;
  }

  const candidates = components.filter((component) => {
    const nameKey = component.name.toLowerCase();
    const idKey = component.id.toLowerCase();
    const matchesHint =
      nameKey.includes(hint) ||
      idKey.includes(hint) ||
      component.sourceLocations?.some((location) =>
        normalizeEvidencePath(location.filePath).toLowerCase().includes(hint),
      );
    if (!matchesHint) {
      return false;
    }
    if (preferredSubTypes.length === 0) {
      return true;
    }
    return preferredSubTypes.includes(component.subType ?? "");
  });

  if (candidates.length === 1) {
    return candidates[0];
  }

  return undefined;
}

function resolveConfigRouteFile(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  preferredSubTypes: string[] = ["api"],
): DetectedComponent | undefined {
  const path = normalizeEvidencePath(evidence.filePath);
  const isRouteConfig =
    path.endsWith("webapi.xml") ||
    path.endsWith("routes.rb") ||
    /\/etc\/webapi\.xml$/i.test(path);

  if (!isRouteConfig) {
    return undefined;
  }

  const strict = resolveStrictOverlap(components, evidence);
  if (strict) {
    return strict;
  }

  const overlapping = componentsInSameFile(components, evidence).filter(
    (component) =>
      component.sourceLocations?.some((location) => spansOverlap(evidence, location)),
  );
  if (overlapping.length === 1) {
    return overlapping[0];
  }

  const nearest = resolveNearestSpanInFile(components, evidence, preferredSubTypes);
  if (nearest) {
    return nearest;
  }

  const apiComponents = componentsInSameFile(components, evidence).filter(
    (component) => component.subType === "api",
  );
  if (apiComponents.length === 1) {
    return apiComponents[0];
  }

  return resolveModuleHintComponent(components, evidence, preferredSubTypes);
}

function pickDeterministicComponent(
  components: DetectedComponent[],
  subType: string,
): DetectedComponent | undefined {
  const matches = components.filter(
    (component) => component.type === "asset" && component.subType === subType,
  );
  const main = matches.find(
    (component) =>
      component.properties?.isMainApplication === true ||
      component.properties?.isMainApplication === "true",
  );
  if (main) {
    return main;
  }
  if (matches.length > 0) {
    return [...matches].sort((left, right) => left.id.localeCompare(right.id))[0];
  }

  if (subType === "service") {
    const serviceLike = components.filter(
      (component) =>
        component.type === "asset" &&
        (component.subType === "service" ||
          /repository/i.test(component.name) ||
          /repository/i.test(component.id)),
    );
    if (serviceLike.length > 0) {
      return [...serviceLike].sort((left, right) => left.id.localeCompare(right.id))[0];
    }
  }

  return undefined;
}

function resolveIntraComponentFallback(
  components: DetectedComponent[],
  evidence: EvidenceSpan,
  span: string,
): DetectedComponent | undefined {
  const filePath = normalizeEvidencePath(evidence.filePath);

  if (/field_password|field_email|record_tokens/i.test(filePath)) {
    return pickDeterministicComponent(components, "database");
  }
  if (/router-controller|member-controller/i.test(filePath) && /sendEmailWithMagicLink|decodeToken|createCustomer|createCheckoutSession/i.test(span)) {
    return pickDeterministicComponent(components, "api");
  }

  return undefined;
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
  const span = options.span ?? "";
  const contextSpan = options.contextSpan ?? "";
  const preferredSubTypes = inferPreferredSubTypes(
    options.flowType,
    span,
    contextSpan,
  );

  const configRoute = resolveConfigRouteFile(
    components,
    evidence,
    preferredSubTypes,
  );
  if (configRoute) {
    return configRoute;
  }

  const moduleReexport = resolveModuleReexport(components, evidence, span, contextSpan);
  if (moduleReexport) {
    return moduleReexport;
  }

  const railsInitializer = resolveRailsInitializerFile(
    components,
    evidence,
    span,
    contextSpan,
  );
  if (railsInitializer) {
    return railsInitializer;
  }

  const railsModel = resolveRailsModelFile(
    components,
    evidence,
    span,
    preferredSubTypes,
  );
  if (railsModel) {
    return railsModel;
  }

  const strict = resolveStrictOverlap(components, evidence);
  if (strict) {
    return strict;
  }

  const sameFile = resolveSameFileWithPreference(
    components,
    evidence,
    preferredSubTypes,
  );
  if (sameFile) {
    return sameFile;
  }

  const fallback = resolveIntraComponentFallback(components, evidence, span);
  if (fallback) {
    return fallback;
  }

  return resolveDirectoryWithPreference(
    components,
    evidence,
    preferredSubTypes,
    span,
    contextSpan,
  );
}
