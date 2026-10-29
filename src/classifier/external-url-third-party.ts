import type { RawFinding } from "../core/types/detection";
import { loadClassifierConfig } from "./config";
import { getActiveOrganizationDomains } from "./organization-domains-scan-scope";

/**
 * Structural heuristics (not a vendor list): URLs that are obviously templated or
 * env-driven should not be treated as static third-party endpoints.
 */
const ENV_OR_DYNAMIC_URL = /\$\{|process\.env|import\.meta\.env|\bgetenv\s*\(/i;

export interface ExternalHttpUrlOptions {
  /** When set (including `[]`), only this list is used; when omitted, active scan scope applies. */
  organizationDomains?: readonly string[];
}

export function normalizeOrganizationDomains(
  input?: readonly string[],
): string[] {
  if (!input || input.length === 0) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    let d = raw.trim().toLowerCase();
    if (!d) continue;
    d = d.replace(/^https?:\/\//i, "");
    const hostPart = d.split("/")[0] ?? d;
    d = hostPart.split(":")[0] ?? hostPart;
    if (d.startsWith("www.")) d = d.slice(4);
    const labels = d.split(".").filter(Boolean);
    if (labels.length < 2) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    result.push(d);
  }
  return result;
}

function resolveOrganizationDomains(
  options?: ExternalHttpUrlOptions,
): readonly string[] {
  if (options && options.organizationDomains !== undefined) {
    return normalizeOrganizationDomains(options.organizationDomains);
  }
  return getActiveOrganizationDomains() ?? [];
}

export function hostMatchesOrganizationDomains(
  hostname: string,
  organizationDomains: readonly string[],
): boolean {
  if (organizationDomains.length === 0) return false;
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const domain of organizationDomains) {
    const d = domain.toLowerCase();
    if (host === d) return true;
    if (host.endsWith(`.${d}`)) return true;
  }
  return false;
}

export function urlMatchesOrganizationDomains(
  url: string,
  organizationDomains: readonly string[],
): boolean {
  if (organizationDomains.length === 0) return false;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const hostnameRaw = new URL(t).hostname;
    if (hostnameRaw == null || !hostnameRaw) return false;
    return hostMatchesOrganizationDomains(hostnameRaw, organizationDomains);
  } catch {
    return false;
  }
}

export function externalApiCallFindingUrl(
  finding: RawFinding,
): string | undefined {
  if (finding.pattern !== "external_api_call") return undefined;
  const props = finding.properties ?? {};
  const fromProp = typeof props.url === "string" ? props.url.trim() : "";
  const fromName =
    typeof finding.name === "string" && /^https?:\/\//i.test(finding.name)
      ? finding.name.trim()
      : "";
  const raw = fromProp || fromName;
  if (!raw || !/^https?:\/\//i.test(raw)) return undefined;
  if (ENV_OR_DYNAMIC_URL.test(raw)) return undefined;
  return raw;
}

export function isOrganizationOwnedExternalApiFinding(
  finding: RawFinding,
  organizationDomains: readonly string[],
): boolean {
  if (organizationDomains.length === 0) return false;
  const url = externalApiCallFindingUrl(finding);
  if (!url) return false;
  return urlMatchesOrganizationDomains(url, organizationDomains);
}

function extractLiteralHttpUrl(finding: RawFinding): string | undefined {
  return externalApiCallFindingUrl(finding);
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split(".").map((x) => Number(x));
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
  }
  return false;
}

/**
 * RFC 2606 / RFC 6761 reserved names: example.com/.org/.net (and subdomains) plus
 * the .test, .example, .invalid and .localhost TLDs. These are documentation
 * placeholders, never real vendors.
 */
const RESERVED_PLACEHOLDER_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
] as const;
const RESERVED_PLACEHOLDER_TLDS = [
  "test",
  "example",
  "invalid",
  "localhost",
] as const;

export function isReservedPlaceholderHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  for (const d of RESERVED_PLACEHOLDER_DOMAINS) {
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  const labels = h.split(".");
  const tld = labels[labels.length - 1] ?? "";
  return (RESERVED_PLACEHOLDER_TLDS as readonly string[]).includes(tld);
}

export function shouldIgnoreExternalHttpUrl(
  url: string | undefined,
  options?: ExternalHttpUrlOptions,
): boolean {
  if (typeof url !== "string") return true;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return true;
  if (ENV_OR_DYNAMIC_URL.test(t)) return true;
  if (/^https?:\/\/\.\.\.(\/|$)/i.test(t)) return true;
  try {
    const hostnameRaw = new URL(t).hostname;
    if (hostnameRaw == null || !hostnameRaw || hostnameRaw.includes("${")) {
      return true;
    }
    const hostname = hostnameRaw.toLowerCase();
    if (
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
        hostname,
      )
    ) {
      return true;
    }
    if (isLocalOrPrivateHost(hostname)) return true;
    if (isReservedPlaceholderHost(hostname)) return true;
    const organizationDomains = resolveOrganizationDomains(options);
    if (hostMatchesOrganizationDomains(hostname, organizationDomains)) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Stable third-party key: registrable-style host (last two DNS labels), e.g.
 * api.openai.com → openai.com, clipdrop-api.co → clipdrop-api.co.
 */
export function deriveServiceKeyFromHostname(host: string): string {
  const h = host.replace(/^www\./, "").toLowerCase();
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) {
    return parts[0] ?? h;
  }
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Second-level public suffixes (`co.uk`): the registrable domain then has three labels.
 * A short list of the common ones; anything else is treated as a one-label suffix.
 */
const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "co.za", "co.id", "co.il",
  "com.br", "com.mx", "com.ar", "com.sg", "com.hk", "com.tw", "com.cn", "com.tr", "com.my", "com.ph",
]);

/**
 * Vendor key for a host the catalog does not know: the registrable domain without its
 * public suffix (`api.dramaboxdb.com` -> `dramaboxdb`, `shop.example.co.uk` -> `example`),
 * so components are named after a vendor, not a domain (DATAP-818).
 */
export function vendorNameFromHostname(host: string): string {
  const parts = host.replace(/^www\./, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? host.toLowerCase();
  const lastTwo = parts.slice(-2).join(".");
  const suffixLabels = parts.length >= 3 && TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo) ? 2 : 1;
  return parts[parts.length - 1 - suffixLabels] ?? lastTwo;
}

/**
 * Hostname + registrable domain keys from an absolute http(s) URL (for matching
 * external_api_call findings to third_party nodes by endpoint.
 */
export function urlHostMatchKeys(url: string): Set<string> {
  const keys = new Set<string>();
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) {
    return keys;
  }
  try {
    const hostnameRaw = new URL(t).hostname;
    if (hostnameRaw == null || !hostnameRaw) {
      return keys;
    }
    const hostname = hostnameRaw.toLowerCase();
    keys.add(hostname);
    keys.add(deriveServiceKeyFromHostname(hostname));
  } catch {
    // ignore malformed URLs
  }
  return keys;
}

/**
 * When YAML `url_host_patterns` do not match, derive a stable service key from the
 * URL hostname (registrable-style). Skips env-interpolated and local/private hosts.
 * Used at detection time so we do not maintain an exhaustive vendor URL list.
 */
export function defaultServiceNameFromLiteralPublicUrl(
  url: string | undefined,
  options?: ExternalHttpUrlOptions,
): string | undefined {
  if (shouldIgnoreExternalHttpUrl(url, options)) {
    return undefined;
  }
  const t = (url as string).trim();
  try {
    const hostname = new URL(t).hostname;
    if (hostname == null || !hostname) {
      return undefined;
    }
    return vendorNameFromHostname(hostname);
  } catch {
    return undefined;
  }
}

const DEFAULT_INFERRED_THIRD_PARTY_SUBTYPE = "saas_service";

/**
 * Pick subType from third-party.classifier.yaml by longest matchKey substring
 * contained in the hostname (import-style keys like @scope/pkg are skipped).
 */
function inferSubTypeFromClassifierCatalog(hostname: string): string {
  const hostLower = hostname.toLowerCase();
  const { thirdParties } = loadClassifierConfig();
  let bestLen = 0;
  let bestSubType = DEFAULT_INFERRED_THIRD_PARTY_SUBTYPE;

  for (const tp of thirdParties) {
    for (const mk of tp.matchKeys) {
      const k = mk.toLowerCase().trim();
      if (k.length < 3) continue;
      if (k.startsWith("@")) continue;
      if (k.includes("/") && !k.includes(".")) continue;
      if (!hostLower.includes(k)) continue;
      if (k.length > bestLen) {
        bestLen = k.length;
        bestSubType = tp.subType;
      }
    }
  }

  return bestSubType;
}

/**
 * When a finding is an external_api_call with a literal public http(s) URL and no
 * env interpolation, treat it as a third-party SaaS/API for classification.
 */
export function inferThirdPartyFromLiteralHttpUrl(
  finding: RawFinding,
  options?: ExternalHttpUrlOptions,
): { serviceName: string; subType: string } | undefined {
  const urlString = extractLiteralHttpUrl(finding);
  if (!urlString || shouldIgnoreExternalHttpUrl(urlString, options)) {
    return undefined;
  }

  let hostname: string;
  try {
    const hostnameRaw = new URL(urlString).hostname;
    if (hostnameRaw == null || !hostnameRaw) {
      return undefined;
    }
    hostname = hostnameRaw;
  } catch {
    return undefined;
  }

  if (isLocalOrPrivateHost(hostname) || isReservedPlaceholderHost(hostname)) {
    return undefined;
  }

  const serviceName = vendorNameFromHostname(hostname);
  if (!serviceName) {
    return undefined;
  }

  return {
    serviceName,
    subType: inferSubTypeFromClassifierCatalog(hostname),
  };
}
