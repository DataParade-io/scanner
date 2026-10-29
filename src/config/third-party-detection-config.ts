/**
 * Shared third-party detection config loader.
 * Reads patterns/third-party.patterns.yaml (known HTTP clients and services).
 * Used by analyzers to detect external_api_call findings.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  type PatternId,
  PATTERN_IDS,
} from "../core/types/detection";

export interface ThirdPartyHttpClientConfig {
  clientId: string;
  patternId: PatternId;
  callRegexes: RegExp[];
  confidence: number;
}

export interface ThirdPartyServiceConfig {
  serviceName: string;
  patternId: PatternId;
  importFragments: string[];
  confidence: number;
  urlHostPatterns: string[];
}

/**
 * One rule for a host shared by several products (DATAP-818). `path` is tested against the
 * URL path (no query); `hint` against the calling code's names (file path, class, function,
 * URL expression). The first rule whose tests all pass names the service.
 */
export interface ThirdPartyUrlRouteRule {
  path?: RegExp;
  hint?: RegExp;
  serviceName: string;
  /** Overrides the catalog subtype for this route (e.g. Instagram messaging vs publishing). */
  subType?: string;
}

export interface ThirdPartyUrlRoute {
  host: string;
  rules: ThirdPartyUrlRouteRule[];
}

/** LLM gateway model prefix (`groq/llama-3.1-8b`) naming the provider (DATAP-818). */
export interface LlmModelPrefix {
  prefix: string;
  serviceName: string;
}

export interface ThirdPartyDetectionConfig {
  httpClients: ThirdPartyHttpClientConfig[];
  services: ThirdPartyServiceConfig[];
  urlRoutes: ThirdPartyUrlRoute[];
  /** Rules for URLs whose host is only known at runtime (`https://{shop}/api/mcp`): path and hint required. */
  urlPathRoutes: ThirdPartyUrlRouteRule[];
  llmModelPrefixes: LlmModelPrefix[];
  /** `googleapiclient.discovery.build("<api>", ...)` API name -> service (DATAP-818). */
  googleApiServices: Map<string, string>;
  /** Shared hosting suffixes (`*.run.app`): own services, never vendors (DATAP-818). */
  platformHosts: Array<{ pattern: RegExp; platform: string }>;
}

interface RawHttpClient {
  clientId: string;
  patternId: string;
  regexes?: string[];
  confidence?: number;
}

interface RawService {
  serviceName: string;
  patternId: string;
  importFragments?: string[];
  confidence?: number;
  url_host_patterns?: string[];
}

interface RawUrlRoute {
  host: string;
  rules?: Array<{ path?: string; hint?: string; serviceName: string; subType?: string }>;
}

interface RawConfig {
  http_clients?: RawHttpClient[];
  services?: RawService[];
  url_routes?: RawUrlRoute[];
  url_path_routes?: Array<{ path?: string; hint?: string; serviceName: string; subType?: string }>;
  llm_model_prefixes?: Record<string, string>;
  google_api_services?: Record<string, string>;
  platform_hosts?: Array<{ pattern: string; platform: string }>;
}

const DEFAULT_CONFIDENCE = 0.8;

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "third-party.patterns.yaml");
}

function compileRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`third-party-detection regex '${pattern}' invalid: ${msg}`);
  }
}

function compileRegexList(patterns: string[] | undefined): RegExp[] {
  if (!patterns || patterns.length === 0) return [];
  return patterns.map((p) => compileRegex(p));
}

function validatePatternId(rawValue: unknown, context: string): PatternId {
  const id = String(rawValue);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${rawValue}' in ${context}`);
  }
  return id as PatternId;
}

let cached: ThirdPartyDetectionConfig | undefined;

export function clearThirdPartyDetectionConfigCache(): void {
  cached = undefined;
}

export function loadThirdPartyDetectionConfig(): ThirdPartyDetectionConfig {
  if (cached) return cached;

  const configPath = getConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Third-party detection config is required but could not be read from '${configPath}': ${message}`,
    );
  }

  const parsed = YAML.parse(raw) as RawConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Third-party detection config at '${configPath}' did not parse to an object.`,
    );
  }

  const httpClients: ThirdPartyHttpClientConfig[] = [];
  if (Array.isArray(parsed.http_clients)) {
    for (const hc of parsed.http_clients) {
      const patternId = validatePatternId(
        hc.patternId,
        `third-party-detection.http_clients['${hc.clientId}']`,
      );
      httpClients.push({
        clientId: hc.clientId,
        patternId,
        callRegexes: compileRegexList(hc.regexes),
        confidence: hc.confidence ?? DEFAULT_CONFIDENCE,
      });
    }
  }

  const services: ThirdPartyServiceConfig[] = [];
  if (Array.isArray(parsed.services)) {
    for (const svc of parsed.services) {
      const patternId = validatePatternId(
        svc.patternId,
        `third-party-detection.services['${svc.serviceName}']`,
      );
      const urlHostPatterns: string[] = Array.isArray(svc.url_host_patterns)
        ? svc.url_host_patterns.filter((p): p is string => typeof p === "string")
        : [];
      services.push({
        serviceName: svc.serviceName,
        patternId,
        importFragments: svc.importFragments ?? [],
        confidence: svc.confidence ?? DEFAULT_CONFIDENCE,
        urlHostPatterns,
      });
    }
  }

  const urlRoutes: ThirdPartyUrlRoute[] = [];
  if (Array.isArray(parsed.url_routes)) {
    for (const route of parsed.url_routes) {
      if (!route?.host || !Array.isArray(route.rules)) {
        throw new Error(`third-party-detection.url_routes entries need host and rules (${configPath}).`);
      }
      urlRoutes.push({
        host: route.host.toLowerCase(),
        rules: route.rules.map((rule) => {
          if (!rule.serviceName) {
            throw new Error(`third-party-detection.url_routes['${route.host}'] rule is missing serviceName.`);
          }
          return {
            serviceName: rule.serviceName,
            ...(rule.path ? { path: new RegExp(rule.path, "i") } : {}),
            ...(rule.hint ? { hint: new RegExp(rule.hint, "i") } : {}),
            ...(rule.subType ? { subType: rule.subType } : {}),
          };
        }),
      });
    }
  }

  const urlPathRoutes: ThirdPartyUrlRouteRule[] = (parsed.url_path_routes ?? []).map((rule) => {
    if (!rule.serviceName || !rule.path || !rule.hint) {
      throw new Error("third-party-detection.url_path_routes rules need path, hint and serviceName.");
    }
    return {
      serviceName: rule.serviceName,
      path: new RegExp(rule.path, "i"),
      hint: new RegExp(rule.hint, "i"),
      ...(rule.subType ? { subType: rule.subType } : {}),
    };
  });

  const llmModelPrefixes: LlmModelPrefix[] = Object.entries(parsed.llm_model_prefixes ?? {}).map(
    ([prefix, serviceName]) => ({ prefix: prefix.toLowerCase().replace(/\/$/, ""), serviceName: String(serviceName) }),
  );

  const googleApiServices = new Map(
    Object.entries(parsed.google_api_services ?? {}).map(([api, serviceName]) => [api.toLowerCase(), String(serviceName)]),
  );

  const platformHosts = (parsed.platform_hosts ?? []).map((entry) => ({
    pattern: compileRegex(entry.pattern),
    platform: String(entry.platform),
  }));

  cached = { httpClients, services, urlRoutes, urlPathRoutes, llmModelPrefixes, googleApiServices, platformHosts };
  return cached;
}

/** Platform of a host on a shared hosting suffix (`gcp/cloud_run`), or undefined. */
export function platformOfHost(host: string): string | undefined {
  const h = host.toLowerCase();
  return loadThirdPartyDetectionConfig().platformHosts.find((entry) => entry.pattern.test(h))?.platform;
}
