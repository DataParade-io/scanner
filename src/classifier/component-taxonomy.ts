import * as fs from "fs";
import * as path from "path";

import YAML from "yaml";

import type { DetectedComponent } from "../core/types/component";
import { findPackageRoot } from "../package-root";

function resolveTaxonomyPath(): string {
  return path.join(findPackageRoot(__dirname), "patterns", "component-taxonomy.yaml");
}

export interface ComponentTaxonomy {
  types: Set<string>;
  subtypesByType: Map<string, Set<string>>;
  subtypeToType: Map<string, string>;
}

let cachedTaxonomy: ComponentTaxonomy | undefined;
let cachedKnownThirdPartyNames: Record<string, string[]> = {};

export function loadComponentTaxonomy(): ComponentTaxonomy {
  if (cachedTaxonomy) {
    return cachedTaxonomy;
  }

  const raw = fs.readFileSync(resolveTaxonomyPath(), "utf8");
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

export function isValidComponentType(
  type: string,
  taxonomy = loadComponentTaxonomy(),
): boolean {
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
 * Strip subtypes that are not declared in component-taxonomy.yaml for the component type.
 * Components are still emitted; undeclared subtypes are omitted rather than passed through.
 */
export function enforceComponentTaxonomy(components: DetectedComponent[]): DetectedComponent[] {
  loadComponentTaxonomy();
  return components.map((component) => {
    if (component.subType === undefined) {
      return component;
    }
    if (isValidSubtypeForType(component.type, component.subType)) {
      return component;
    }
    return { ...component, subType: undefined };
  });
}
