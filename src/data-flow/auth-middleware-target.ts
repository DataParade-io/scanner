import type { DetectedComponent } from "../core/types/component";
import type { RawFinding } from "../core/types/detection";
import {
  getSectionIdFromComponent,
  getSectionIdFromFinding,
  isConcreteServiceSectionId,
} from "./source-resolution";

/**
 * Map auth_middleware finding tokens (name / strategy) to normalized component
 * name/vendor tokens used when matching auth_service assets.
 */
export const AUTH_FINDING_TO_COMPONENT_ALIASES: Record<string, string[]> = {
  jwt: ["jwt", "jsonwebtoken", "jose"],
  devise: ["devise"],
  warden: ["devise", "warden"],
  passport: ["passport"],
  bcrypt: ["bcrypt", "bcryptjs"],
  omniauth: ["omniauth", "omniauth-oauth2"],
  session_cookie: ["session", "rails_session", "cookie_store"],
  rails_session: ["session", "rails_session", "cookie_store"],
  api_key: ["api_key", "apikey"],
  auth0: ["auth0"],
};

export function normalizeAuthFindingToken(
  name: string | undefined,
  strategy?: string | undefined,
): string {
  const raw = (name || strategy || "").trim().toLowerCase();
  if (!raw) return "";
  // Strip common suffixes/noise: "auth0 guard", "jwt middleware"
  return (
    raw
      .replace(/\b(guard|middleware|strategy|auth|authentication)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0] ?? ""
  );
}

function componentMatchTokens(component: DetectedComponent): string[] {
  const tokens: string[] = [];
  const name = (component.name || "").trim().toLowerCase();
  if (name) tokens.push(name);

  const vendor = component.properties?.vendor;
  if (typeof vendor === "string" && vendor.trim()) {
    tokens.push(vendor.trim().toLowerCase());
  }
  const client = component.properties?.client;
  if (typeof client === "string" && client.trim()) {
    tokens.push(client.trim().toLowerCase());
  }
  const serviceName = component.properties?.serviceName;
  if (typeof serviceName === "string" && serviceName.trim()) {
    tokens.push(serviceName.trim().toLowerCase());
  }
  return tokens;
}

function tokensMatchFinding(
  componentTokens: string[],
  findingToken: string,
  aliases: string[],
): boolean {
  const candidates = new Set([findingToken, ...aliases]);
  return componentTokens.some((ct) => {
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (
        ct === candidate ||
        ct.includes(candidate) ||
        candidate.includes(ct)
      ) {
        return true;
      }
    }
    return false;
  });
}

export function isAuthProviderThirdParty(
  component: DetectedComponent,
): boolean {
  if (component.type !== "third_party") return false;
  const serviceName = component.properties?.serviceName;
  const normalizedService =
    typeof serviceName === "string" ? serviceName.trim().toLowerCase() : "";
  const normalizedName = (component.name || "").trim().toLowerCase();
  return (
    normalizedService.includes("auth0") ||
    normalizedName.includes("auth0") ||
    normalizedService.includes("omniauth") ||
    normalizedName.includes("omniauth")
  );
}

function inSection(
  component: DetectedComponent,
  sectionId: string | undefined,
): boolean {
  if (!sectionId) return true;
  return getSectionIdFromComponent(component) === sectionId;
}

/**
 * Resolve the auth_service (or Auth0 third_party) target for an auth_middleware
 * finding, preferring name/alias match over "first auth_service in section".
 */
export function resolveAuthMiddlewareTarget(
  finding: RawFinding,
  components: DetectedComponent[],
): DetectedComponent | undefined {
  const sectionId = getSectionIdFromFinding(finding);
  const strategy =
    typeof finding.properties?.strategy === "string"
      ? finding.properties.strategy
      : undefined;
  const findingToken = normalizeAuthFindingToken(finding.name, strategy);
  const aliases = findingToken
    ? (AUTH_FINDING_TO_COMPONENT_ALIASES[findingToken] ?? [findingToken])
    : [];

  const authServicesInSection = components.filter(
    (c) =>
      c.type === "asset" &&
      c.subType === "auth_service" &&
      inSection(c, sectionId),
  );

  if (findingToken && authServicesInSection.length > 0) {
    const byName = authServicesInSection.find((c) =>
      tokensMatchFinding(componentMatchTokens(c), findingToken, aliases),
    );
    if (byName) return byName;
  }

  // Exactly one auth_service in section + no specific match → use it (generic auth).
  if (authServicesInSection.length === 1) {
    return authServicesInSection[0];
  }

  // Multiple auth services with no name match: do not pick arbitrarily.
  if (authServicesInSection.length > 1 && findingToken) {
    // Fall through to third_party / global only when name matching failed.
  } else if (authServicesInSection.length > 0) {
    return authServicesInSection[0];
  }

  const authThirdPartyInSection = components.find(
    (c) => isAuthProviderThirdParty(c) && inSection(c, sectionId),
  );
  if (authThirdPartyInSection) {
    if (findingToken) {
      const tpTokens = componentMatchTokens(authThirdPartyInSection);
      if (tokensMatchFinding(tpTokens, findingToken, aliases)) {
        return authThirdPartyInSection;
      }
      // Auth0 guard / auth0-named findings: third_party is still valid.
      if (
        findingToken.includes("auth0") ||
        aliases.some((a) => a.includes("auth0"))
      ) {
        return authThirdPartyInSection;
      }
    } else {
      return authThirdPartyInSection;
    }
  }

  // For concrete section-scoped findings, avoid cross-section fallback.
  if (isConcreteServiceSectionId(sectionId)) {
    return undefined;
  }

  if (findingToken) {
    const globalByName = components.find(
      (c) =>
        c.type === "asset" &&
        c.subType === "auth_service" &&
        tokensMatchFinding(componentMatchTokens(c), findingToken, aliases),
    );
    if (globalByName) return globalByName;
  }

  return (
    components.find(
      (c) => c.type === "asset" && c.subType === "auth_service",
    ) ?? components.find((c) => isAuthProviderThirdParty(c))
  );
}
