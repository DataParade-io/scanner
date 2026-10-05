import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import { isConcreteServiceSectionId } from "../core/sectioning/section-runtime";
import { findApplicationHubForFlows } from "./application-hub";

const MANIFEST_FILE_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "pipfile",
  "requirements.txt",
  "gemfile",
  "gemfile.lock",
]);

function isManifestMetadataPath(filePath: string | undefined): boolean {
  if (!filePath?.trim()) return false;
  const base = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return MANIFEST_FILE_NAMES.has(base);
}

/**
 * Third parties inferred only from dependency manifests (e.g. `package.json`
 * imports), not from runtime call sites.
 */
export function isManifestOnlyThirdPartyComponent(
  component: DetectedComponent,
): boolean {
  if (component.type !== "third_party") return false;

  if (component.properties?.sourceContext === "dependency_manifest") {
    return true;
  }

  const refs = component.detectedFrom ?? [];
  if (refs.length === 0) return false;

  return refs.every((ref) => {
    if (ref.pattern !== "external_api_call") return false;
    const fp = ref.sourceLocation?.filePath;
    return isManifestMetadataPath(fp);
  });
}

function nextFlowId(flows: DetectedDataFlow[], offset: number): string {
  let maxFlowNum = flows.reduce((max, f) => {
    const m = /^flow_(\d+)$/.exec(f.id);
    return m ? Math.max(max, Number.parseInt(m[1], 10)) : max;
  }, 0);
  return `flow_${maxFlowNum + offset}`;
}

function appendHubToThirdPartyFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
  thirdParties: DetectedComponent[],
  enrichmentNotes: string,
  description: string,
  confidence: number,
): DetectedDataFlow[] {
  if (thirdParties.length === 0) return flows;

  const existingKeys = new Set(
    flows.map((f) => `${f.sourceComponentId}\t${f.targetComponentId}\t${f.type}`),
  );

  const synthetic: DetectedDataFlow[] = [];
  const sortedThirdParties = [...thirdParties].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  for (const thirdParty of sortedThirdParties) {
    const sectionId = String(thirdParty.properties?.section_id ?? "").trim();
    const hub = findApplicationHubForFlows(components, sectionId || undefined);
    if (!hub || hub.id === thirdParty.id) continue;

    const key = `${hub.id}\t${thirdParty.id}\tapi_call`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    synthetic.push({
      id: nextFlowId(flows, synthetic.length + 1),
      sourceComponentId: hub.id,
      targetComponentId: thirdParty.id,
      type: "api_call",
      confidence,
      description,
      enrichmentNotes,
    });
  }

  return synthetic.length > 0 ? [...flows, ...synthetic] : flows;
}

/**
 * Connects each workspace package hub to third parties declared in its manifest.
 * Runtime call sites still produce their own flows; this only fills gaps for
 * manifest-only vendors (e.g. Anthropic listed in `package.json` but called via
 * OpenRouter at runtime).
 */
export function ensureManifestDeclaredThirdPartyFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const manifestThirdParties = components.filter(isManifestOnlyThirdPartyComponent);
  return appendHubToThirdPartyFlows(
    components,
    flows,
    manifestThirdParties,
    "declared_dependency",
    "Declared dependency (manifest)",
    0.65,
  );
}

/**
 * Connects section hubs to third parties that have no in-section inbound edge.
 * Covers AI-enriched / non-manifest vendors so occupied sections are never
 * left with floating third parties.
 */
export function ensureHubToOrphanThirdPartyFlows(
  components: DetectedComponent[],
  flows: DetectedDataFlow[],
): DetectedDataFlow[] {
  const componentById = new Map(components.map((c) => [c.id, c]));
  const hasInSectionInbound = new Set<string>();

  for (const flow of flows) {
    const source = componentById.get(flow.sourceComponentId);
    const target = componentById.get(flow.targetComponentId);
    if (!source || !target || target.type !== "third_party") continue;
    const sourceSection = String(source.properties?.section_id ?? "").trim();
    const targetSection = String(target.properties?.section_id ?? "").trim();
    if (!sourceSection || sourceSection !== targetSection) continue;
    hasInSectionInbound.add(target.id);
  }

  const orphans = components.filter((c) => {
    if (c.type !== "third_party") return false;
    if (hasInSectionInbound.has(c.id)) return false;
    const sid = String(c.properties?.section_id ?? "").trim();
    return isConcreteServiceSectionId(sid);
  });

  return appendHubToThirdPartyFlows(
    components,
    flows,
    orphans,
    "section_hub_orphan_third_party",
    "Section hub to orphan third party",
    0.6,
  );
}
