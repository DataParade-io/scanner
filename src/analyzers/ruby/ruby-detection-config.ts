import fs from "fs";
import path from "path";
import YAML from "yaml";

import { type PatternId, PATTERN_IDS } from "../../core/types/detection";

interface RawRouteRegex {
  regex: string;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

interface RawDbClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  requirePaths?: string[];
  gemNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  requirePaths?: string[];
  gemNames?: string[];
  callNames?: unknown[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  requirePaths?: string[];
  gemNames?: string[];
  requireRailsRoutesContext?: boolean;
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  requirePaths?: string[];
  gemNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawConfigLoader {
  id: string;
  requirePaths?: string[];
  gemNames?: string[];
  callNames?: unknown[];
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  requirePaths?: string[];
  gemNames?: string[];
  callNames?: unknown[];
  callNameSuffixes?: unknown[];
  urlRegex?: string;
  confidence?: number;
}

interface RawRubyPatternConfig {
  db_clients?: RawDbClientConfig[];
  database_url?: {
    patternId: string;
    regex?: string;
    name?: string;
    confidence?: number;
    drivers?: Record<string, string>;
    defaultDatabaseType?: string;
  };
  auth?: {
    libraries?: RawAuthLibraryConfig[];
  };
  routes?: {
    frameworks?: RawRouteFrameworkConfig[];
  };
  serverless?: {
    handlers?: RawServerlessHandlerConfig[];
  };
  env_config?: {
    envVariable?: {
      patternId: string;
      regex?: string;
      confidence?: number;
    };
    configLoaders?: {
      patternId: string;
      confidence?: number;
      loaders?: RawConfigLoader[];
    };
    configFile?: {
      patternId: string;
      fileNameRegex?: string;
      name?: string;
      confidence?: number;
    };
  };
  external_apis?: {
    httpClients?: RawHttpClientConfig[];
  };
}

export interface RubyRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface RubyDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  requirePaths: string[];
  gemNames: string[];
  callNames: string[];
  confidence: number;
}

export interface RubyAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  requirePaths: string[];
  gemNames: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface RubyRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  requirePaths: string[];
  gemNames: string[];
  requireRailsRoutesContext: boolean;
  routeRegexes: RubyRouteRegex[];
  confidence: number;
}

export interface RubyServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  requirePaths: string[];
  gemNames: string[];
  callNames: string[];
  confidence: number;
}

export interface RubyConfigLoader {
  id: string;
  requirePaths: string[];
  gemNames: string[];
  callNames: string[];
}

export interface RubyHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  requirePaths: string[];
  gemNames: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  confidence: number;
}

export interface RubyPatternConfig {
  dbClients: RubyDbClientConfig[];
  databaseUrl?: {
    patternId: PatternId;
    regex: RegExp;
    name: string;
    confidence: number;
    drivers: Record<string, string>;
    defaultDatabaseType: string;
  };
  auth: {
    libraries: RubyAuthLibraryConfig[];
  };
  routes: {
    frameworks: RubyRouteFrameworkConfig[];
  };
  serverless: {
    handlers: RubyServerlessHandlerConfig[];
  };
  envConfig: {
    envVariable?: {
      patternId: PatternId;
      regex: RegExp;
      confidence: number;
    };
    configLoaders?: {
      patternId: PatternId;
      confidence: number;
      loaders: RubyConfigLoader[];
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: RubyHttpClientConfig[];
  };
}

const DEFAULT_CONFIDENCE = 0.8;
const DEFAULT_URL_REGEX = '["\'](https?:\\/\\/[^"\']+)["\']';

function validatePatternId(raw: unknown, context: string): PatternId {
  const id = String(raw);
  if (!PATTERN_IDS.includes(id as PatternId)) {
    throw new Error(`Invalid patternId '${raw}' in ${context}`);
  }
  return id as PatternId;
}

function compileRegex(pattern: string, context: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex in ${context}: ${msg}`);
  }
}

function getConfigPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "../../..");
  return path.join(cliRoot, "patterns", "ruby.patterns.yaml");
}

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
    .filter(Boolean);
}

function normalizeCallNames(values: unknown[] | undefined): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
      continue;
    }
    if (v && typeof v === "object") {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        if (key.trim()) out.push(key.trim());
      }
    }
  }
  return out;
}

function normalizeRouteRegexes(
  raw: RawRouteRegex[] | undefined,
  context: string,
): RubyRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawRubyPatternConfig): RubyPatternConfig {
  const dbClients: RubyDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `ruby.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      requirePaths: normalizeList(c.requirePaths),
      gemNames: normalizeList(c.gemNames),
      callNames: normalizeCallNames(c.callNames),
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const databaseUrlRaw = raw.database_url;
  const databaseUrl =
    databaseUrlRaw && databaseUrlRaw.patternId && databaseUrlRaw.regex
      ? {
          patternId: validatePatternId(
            databaseUrlRaw.patternId,
            "ruby.database_url.patternId",
          ),
          regex: compileRegex(
            databaseUrlRaw.regex,
            "ruby.database_url.regex",
          ),
          name: databaseUrlRaw.name ?? "database_url",
          confidence: databaseUrlRaw.confidence ?? DEFAULT_CONFIDENCE,
          drivers: databaseUrlRaw.drivers ?? {},
          defaultDatabaseType: databaseUrlRaw.defaultDatabaseType ?? "sql",
        }
      : undefined;

  const authLibraries: RubyAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `ruby.auth.libraries['${lib.id}']`,
      ),
      requirePaths: normalizeList(lib.requirePaths),
      gemNames: normalizeList(lib.gemNames),
      callNames: normalizeCallNames(lib.callNames),
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `ruby.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: RubyRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `ruby.routes.frameworks['${fw.id}']`,
      ),
      requirePaths: normalizeList(fw.requirePaths),
      gemNames: normalizeList(fw.gemNames),
      requireRailsRoutesContext: Boolean(fw.requireRailsRoutesContext),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `ruby.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: RubyServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `ruby.serverless.handlers['${handler.id}']`,
      ),
      requirePaths: normalizeList(handler.requirePaths),
      gemNames: normalizeList(handler.gemNames),
      callNames: normalizeCallNames(handler.callNames),
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "ruby.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "ruby.env_config.envVariable.regex",
          ),
          confidence: envVarRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const configLoadersRaw = raw.env_config?.configLoaders;
  const configLoaders =
    configLoadersRaw && configLoadersRaw.patternId
      ? {
          patternId: validatePatternId(
            configLoadersRaw.patternId,
            "ruby.env_config.configLoaders.patternId",
          ),
          confidence: configLoadersRaw.confidence ?? DEFAULT_CONFIDENCE,
          loaders: (configLoadersRaw.loaders ?? []).map((loader) => ({
            id: loader.id,
            requirePaths: normalizeList(loader.requirePaths),
            gemNames: normalizeList(loader.gemNames),
            callNames: normalizeCallNames(loader.callNames),
          })),
        }
      : undefined;

  const configFileRaw = raw.env_config?.configFile;
  const configFile =
    configFileRaw && configFileRaw.patternId && configFileRaw.fileNameRegex
      ? {
          patternId: validatePatternId(
            configFileRaw.patternId,
            "ruby.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "ruby.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "rails_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: RubyHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `ruby.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      requirePaths: normalizeList(client.requirePaths),
      gemNames: normalizeList(client.gemNames),
      callNames: normalizeCallNames(client.callNames),
      callNameSuffixes: normalizeCallNames(client.callNameSuffixes),
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `ruby.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    databaseUrl,
    auth: { libraries: authLibraries },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, configLoaders, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: RubyPatternConfig | undefined;

export function clearRubyPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadRubyPatternConfig(): RubyPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ruby pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawRubyPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Ruby pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
