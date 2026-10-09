import { getSectionIdFromProperties } from "../../classifier/sectioning";
import type { DetectedComponent } from "../types/component";

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function firstSourceFilePath(component: DetectedComponent): string {
  const paths = (component.sourceLocations ?? []).map((loc) =>
    loc.filePath.replace(/\\/g, "/"),
  );
  // Code-unit order (not localeCompare) so keys do not depend on the runtime locale.
  paths.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return paths[0] ?? "";
}

/**
 * Deterministic identity of a component, hashed into its id by
 * `stableComponentId` / `assignStableEntityIds` (see stable-entity-ids.ts).
 * Priority: terraform_address → managed service tuple → app surface tuple.
 *
 * The managed tuple embeds `managed_by_provider`, which is a component id; the
 * id assigners resolve it to the provider's own key so the result is stable.
 */
export function stableComponentKey(component: DetectedComponent): string {
  const addr = component.properties?.terraform_address;
  if (typeof addr === "string" && addr.trim()) {
    return `tf:${addr.trim()}`;
  }

  const managedBy = component.properties?.managed_by_provider;
  const managedKey = component.properties?.managed_service_key;
  if (
    typeof managedBy === "string" &&
    managedBy.trim() &&
    typeof managedKey === "string" &&
    managedKey.trim()
  ) {
    const sid = getSectionIdFromProperties(component.properties);
    return `managed:${managedBy.trim()}|${String(managedKey).trim()}|${sid}`;
  }

  const sid = getSectionIdFromProperties(component.properties);
  const subType = component.subType ?? "";
  const filePath = firstSourceFilePath(component);
  return `app:${sid}|${component.type}|${subType}|${filePath}|${normalizeName(component.name)}`;
}
