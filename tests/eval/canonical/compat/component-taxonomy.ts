export {
  clearComponentTaxonomyCacheForTest,
  enforceComponentTaxonomy,
  inferThirdPartySubtypeFromVendor,
  isValidComponentType,
  isValidSubtypeForType,
  loadComponentTaxonomy,
  type ComponentTaxonomy,
} from "../../../../src/classifier/component-taxonomy";

import {
  inferThirdPartySubtypeFromVendor,
  isValidSubtypeForType,
  loadComponentTaxonomy,
} from "../../../../src/classifier/component-taxonomy";

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
