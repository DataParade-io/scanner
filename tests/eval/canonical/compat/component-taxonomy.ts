import * as fs from "fs";
import * as path from "path";

import YAML from "yaml";

import { findPackageRoot } from "../../../benchmark/paths";

const TAXONOMY_PATH = path.join(
  findPackageRoot(__dirname),
  "patterns/component-taxonomy.yaml",
);

export interface ComponentTaxonomy {
  types: Set<string>;
  subtypesByType: Map<string, Set<string>>;
  subtypeToType: Map<string, string>;
}

let cachedTaxonomy: ComponentTaxonomy | undefined;

export function loadComponentTaxonomy(): ComponentTaxonomy {
  if (cachedTaxonomy) {
    return cachedTaxonomy;
  }

  const raw = fs.readFileSync(TAXONOMY_PATH, "utf8");
  const parsed = YAML.parse(raw) as {
    types: { id: string }[];
    subtypes: { id: string; type: string }[];
    known_third_party_names?: Record<string, string[]>;
  };

  const types = new Set(parsed.types.map((entry) => entry.id));
  const subtypesByType = new Map<string, Set<string>>();
  const subtypeToType = new Map<string, string>();

  for (const subtype of parsed.subtypes) {
    if (!subtypesByType.has(subtype.type)) {
      subtypesByType.set(subtype.type, new Set());
    }
    subtypesByType.get(subtype.type)!.add(subtype.id);
    subtypeToType.set(subtype.id, subtype.type);
  }

  cachedTaxonomy = { types, subtypesByType, subtypeToType };
  cachedKnownThirdPartyNames = parsed.known_third_party_names ?? {};
  return cachedTaxonomy;
}

let cachedKnownThirdPartyNames: Record<string, string[]> = {};

export function inferThirdPartySubtypeFromVendor(vendorSlug: string): string | undefined {
  loadComponentTaxonomy();
  const normalized = vendorSlug.trim().toLowerCase();
  for (const [subtype, names] of Object.entries(cachedKnownThirdPartyNames)) {
    if (names.some((name) => name.toLowerCase() === normalized)) {
      return subtype;
    }
  }
  return undefined;
}

export function clearComponentTaxonomyCacheForTest(): void {
  cachedTaxonomy = undefined;
  cachedKnownThirdPartyNames = {};
}

export function isValidComponentType(type: string, taxonomy = loadComponentTaxonomy()): boolean {
  return taxonomy.types.has(type);
}

export function isValidSubtypeForType(
  componentType: string,
  subtype: string,
  taxonomy = loadComponentTaxonomy(),
): boolean {
  return taxonomy.subtypesByType.get(componentType)?.has(subtype) ?? false;
}

/**
 * Resolve taxonomy subtype from reviewed labels, then key suffix when valid.
 */
export function resolveComponentSubtype(
  componentType: string,
  labels: readonly string[],
  keySuffix: string,
  taxonomy = loadComponentTaxonomy(),
): string {
  const label = labels[0]?.trim().toLowerCase();
  if (label && isValidSubtypeForType(componentType, label, taxonomy)) {
    return label;
  }

  if (componentType === "third_party") {
    const inferred = inferThirdPartySubtypeFromVendor(keySuffix);
    if (inferred && isValidSubtypeForType(componentType, inferred, taxonomy)) {
      return inferred;
    }
    if (isValidSubtypeForType(componentType, "saas_service", taxonomy)) {
      return "saas_service";
    }
  }

  const suffix = keySuffix.trim().toLowerCase();
  if (suffix && isValidSubtypeForType(componentType, suffix, taxonomy)) {
    return suffix;
  }

  throw new Error(
    `No valid taxonomy subtype for type '${componentType}' from labels [${labels.join(", ")}] or key suffix '${keySuffix}'`,
  );
}

export function classificationIdentityKey(componentType: string, componentSubtype: string): string {
  return `${componentType}:${componentSubtype}`;
}

export function buildRepoLocalEntityId(repoKey: string, annotationId: string): string {
  return `${repoKey}::${annotationId}`;
}
