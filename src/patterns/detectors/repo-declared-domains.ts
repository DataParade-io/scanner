import type { FileInfo } from "../../core/types/file";
import {
  isReservedPlaceholderHost,
  registrableDomainOf,
} from "../../classifier/external-url-third-party";
import { loadThirdPartyDetectionConfig, platformOfHost } from "../../config/third-party-detection-config";

/**
 * Domains a repository declares as its own (DATAP-818), used as organization domains when
 * none are configured, so a website calling its company's API on another subdomain is a
 * first-party call and not a vendor named after the company.
 *
 * Conservative on purpose. Sources:
 * - `homepage` in a package.json;
 * - site URL settings in env example files and source code: `SITE_URL`, `APP_URL`,
 *   `WEBSITE_URL`, `PUBLIC_URL`, `CANONICAL_URL`, `FRONTEND_URL` (with `NEXT_PUBLIC_`,
 *   `VITE_`, `REACT_APP_`, `PUBLIC_` prefixes), assigned a literal https URL.
 * Never: code and package hosts (github.com ...), shared hosting platforms (*.run.app ...),
 * placeholder and local hosts, and hosts of catalog vendors. `BASE_URL`/`API_URL` are not
 * read: they usually hold a vendor's API. README links and CNAME files are not ingested.
 */
const SITE_URL_SETTING =
  /\b(?:NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_)?(?:SITE|APP|WEBSITE|PUBLIC|CANONICAL|FRONTEND)_URL\b["']?\s*[:=]\s*["'`]?(https:\/\/[^"'`\s/]+)/g;

const NEVER_OWN = new Set([
  "github.com", "githubusercontent.com", "gitlab.com", "bitbucket.org", "npmjs.com", "npmjs.org",
  "pypi.org", "readthedocs.io", "google.com", "medium.com", "notion.site", "localhost",
]);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isCatalogVendorHost(host: string): boolean {
  return loadThirdPartyDetectionConfig().services.some((svc) =>
    svc.urlHostPatterns.some((p) => {
      const pattern = p.toLowerCase().replace(/^\./, "");
      return host === pattern || host.endsWith(`.${pattern}`);
    }),
  );
}

export function collectRepoDeclaredDomains(files: readonly FileInfo[]): string[] {
  const hosts = new Set<string>();
  for (const file of files) {
    const base = file.path.split("/").pop() ?? "";
    const content = file.content ?? "";
    if (base === "package.json") {
      try {
        const homepage = (JSON.parse(content) as { homepage?: unknown }).homepage;
        if (typeof homepage === "string") {
          const host = hostOf(homepage);
          if (host) hosts.add(host);
        }
      } catch {
        // Not JSON: ignore.
      }
      continue;
    }
    const isEnvExample = file.language === "env" || /^\.env\./.test(base);
    const isSource = file.language === "typescript" || file.language === "javascript" || file.language === "python";
    if (!isEnvExample && !isSource) continue;
    if (!/_URL/.test(content)) continue;
    for (const m of content.matchAll(SITE_URL_SETTING)) {
      const host = hostOf(m[1]);
      if (host) hosts.add(host);
    }
  }
  const domains = new Set<string>();
  for (const host of hosts) {
    if (!host.includes(".") || isReservedPlaceholderHost(host) || platformOfHost(host) || isCatalogVendorHost(host)) continue;
    const domain = registrableDomainOf(host);
    if (NEVER_OWN.has(domain)) continue;
    domains.add(domain);
  }
  return [...domains].sort();
}
