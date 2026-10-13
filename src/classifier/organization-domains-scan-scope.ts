import { normalizeOrganizationDomains } from "./external-url-third-party";

let activeOrganizationDomains: readonly string[] | undefined;

/**
 * While a structural scan runs analyzers, pattern detectors read org domains from
 * this scope when they call `shouldIgnoreExternalHttpUrl` without explicit options.
 */
export function runWithOrganizationDomainsScope<T>(
  organizationDomains: readonly string[] | undefined,
  fn: () => T,
): T {
  const prev = activeOrganizationDomains;
  const normalized = normalizeOrganizationDomains(organizationDomains);
  activeOrganizationDomains =
    normalized.length > 0 ? normalized : undefined;
  try {
    return fn();
  } finally {
    activeOrganizationDomains = prev;
  }
}

export function getActiveOrganizationDomains(): readonly string[] | undefined {
  return activeOrganizationDomains;
}
