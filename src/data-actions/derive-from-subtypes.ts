import type { DetectedComponent } from "../core/types/component";
import type {
  DataActionAssignment,
  TopologyEvidence,
} from "../core/types/data-action";
import { componentMayCarryDataActions } from "../core/types/data-action";

/**
 * Asset subtypes that imply persistence (PRD §4.3 / DA-4).
 * PRD `cloud_storage` → scanner `storage`; no `file_system` subtype in taxonomy.
 * `cache` is treated as ephemeral store (still retention of personal data).
 */
export const SUBTYPE_STORE_SUBTYPES: ReadonlySet<string> = new Set([
  "database",
  "storage",
  "cache",
]);

/**
 * Terraform / infra resource subtypes that must NOT get asserted relay from
 * subtype defaults (DA-4: API-gateway → relay corroboration is out of v1).
 * Relay may still arrive via pattern corroboration elsewhere.
 */
export const TERRAFORM_GATEWAY_SUBTYPES: ReadonlySet<string> = new Set([
  "api",
  "application",
  "service",
  "function",
  "container",
]);

const CONFIDENCE = 1;

function isTerraformComponent(component: DetectedComponent): boolean {
  const addr = component.properties?.terraform_address;
  if (typeof addr === "string" && addr.trim() !== "") return true;
  const provider = component.properties?.cloud_provider;
  if (typeof provider === "string" && provider.trim() !== "" && provider !== "unknown") {
    // Heuristic: terraform-detected assets often carry cloud_provider.
    return component.detectedFrom.some((ref) =>
      /terraform|aws_|google_|azurerm_/i.test(ref.pattern),
    );
  }
  return component.detectedFrom.some((ref) =>
    /terraform/i.test(ref.pattern),
  );
}

function assignment(
  action: DataActionAssignment["action"],
  evidence: TopologyEvidence,
): DataActionAssignment {
  return {
    action,
    source: "deterministic",
    confidence: CONFIDENCE,
    status: "asserted",
    evidence,
  };
}

function push(
  proposed: Map<string, DataActionAssignment[]>,
  componentId: string,
  next: DataActionAssignment,
): void {
  const list = proposed.get(componentId) ?? [];
  list.push(next);
  proposed.set(componentId, list);
}

/**
 * Classifier / subtype defaults (PRD §4.3.3 + DA-4).
 * - Storage-like asset subtypes → store
 * - Third-party sinks → disclose (on the TP node itself)
 * - Never assert relay from subtype/Terraform gateway defaults
 */
export function deriveFromSubtypes(
  components: DetectedComponent[],
): Map<string, DataActionAssignment[]> {
  const proposed = new Map<string, DataActionAssignment[]>();

  for (const component of components) {
    if (!componentMayCarryDataActions(component.type)) continue;

    if (component.type === "asset") {
      const subType = component.subType?.trim();
      if (subType && SUBTYPE_STORE_SUBTYPES.has(subType)) {
        push(
          proposed,
          component.id,
          assignment("store", {
            kind: "storage_subtype",
            description: `classifier subtype ${subType}`,
            relatedComponentId: component.id,
          }),
        );
      }

      // DA-4: terraform gateway-like assets do not get asserted relay here.
      if (
        isTerraformComponent(component) &&
        subType &&
        TERRAFORM_GATEWAY_SUBTYPES.has(subType)
      ) {
        // Explicit no-op: do not emit relay from subtype defaults.
        continue;
      }
    }

    if (component.type === "third_party") {
      push(
        proposed,
        component.id,
        assignment("disclose", {
          kind: "outbound_to_third_party",
          description: `third_party sink default (${component.subType ?? component.name})`,
          relatedComponentId: component.id,
        }),
      );
    }
  }

  return proposed;
}
