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
  importPaths?: string[];
  crateNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  crateNames?: string[];
  callNames?: unknown[];
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawRouteFrameworkConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  crateNames?: string[];
  routeRegexes?: RawRouteRegex[];
  confidence?: number;
}

interface RawServerlessHandlerConfig {
  id: string;
  patternId: string;
  importPaths?: string[];
  crateNames?: string[];
  callNames?: unknown[];
  confidence?: number;
}

interface RawConfigLoader {
  id: string;
  importPaths?: string[];
  crateNames?: string[];
  callNames?: unknown[];
}

interface RawHttpClientConfig {
  id: string;
  patternId: string;
  clientName: string;
  importPaths?: string[];
  crateNames?: string[];
  callNames?: unknown[];
  callNameSuffixes?: unknown[];
  urlRegex?: string;
  confidence?: number;
}

interface RawRustPatternConfig {
  db_clients?: RawDbClientConfig[];
  sqlx_url?: {
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

export interface RustRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface RustDbClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  importPaths: string[];
  crateNames: string[];
  callNames: string[];
  confidence: number;
}

export interface RustAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  crateNames: string[];
  callNames: string[];
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface RustRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  crateNames: string[];
  routeRegexes: RustRouteRegex[];
  confidence: number;
}

export interface RustServerlessHandlerConfig {
  id: string;
  patternId: PatternId;
  importPaths: string[];
  crateNames: string[];
  callNames: string[];
  confidence: number;
}

export interface RustConfigLoader {
  id: string;
  importPaths: string[];
  crateNames: string[];
  callNames: string[];
}

export interface RustHttpClientConfig {
  id: string;
  patternId: PatternId;
  clientName: string;
  importPaths: string[];
  crateNames: string[];
  callNames: string[];
  callNameSuffixes: string[];
  urlRegex: RegExp;
  confidence: number;
}

export interface RustPatternConfig {
  dbClients: RustDbClientConfig[];
  sqlxUrl?: {
    patternId: PatternId;
    regex: RegExp;
    name: string;
    confidence: number;
    drivers: Record<string, string>;
    defaultDatabaseType: string;
  };
  auth: {
    libraries: RustAuthLibraryConfig[];
  };
  routes: {
    frameworks: RustRouteFrameworkConfig[];
  };
  serverless: {
    handlers: RustServerlessHandlerConfig[];
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
      loaders: RustConfigLoader[];
    };
    configFile?: {
      patternId: PatternId;
      fileNameRegex: RegExp;
      name: string;
      confidence: number;
    };
  };
  externalApis: {
    httpClients: RustHttpClientConfig[];
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
  return path.join(cliRoot, "patterns", "rust.patterns.yaml");
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
): RustRouteRegex[] {
  return (raw ?? []).map((entry, index) => ({
    regex: compileRegex(entry.regex, `${context}.routeRegexes[${index}]`),
    methodGroup: entry.methodGroup,
    pathGroup: entry.pathGroup,
    defaultMethod: entry.defaultMethod,
  }));
}

function normalizeRawConfig(raw: RawRustPatternConfig): RustPatternConfig {
  const dbClients: RustDbClientConfig[] =
    raw.db_clients?.map((c) => ({
      id: c.id,
      patternId: validatePatternId(
        c.patternId,
        `rust.db_clients entry '${c.id}'`,
      ),
      databaseType: c.databaseType,
      importPaths: normalizeList(c.importPaths),
      crateNames: normalizeList(c.crateNames),
      callNames: normalizeCallNames(c.callNames),
      confidence: c.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const sqlxUrlRaw = raw.sqlx_url;
  const sqlxUrl =
    sqlxUrlRaw && sqlxUrlRaw.patternId && sqlxUrlRaw.regex
      ? {
          patternId: validatePatternId(
            sqlxUrlRaw.patternId,
            "rust.sqlx_url.patternId",
          ),
          regex: compileRegex(sqlxUrlRaw.regex, "rust.sqlx_url.regex"),
          name: sqlxUrlRaw.name ?? "sqlx_url",
          confidence: sqlxUrlRaw.confidence ?? DEFAULT_CONFIDENCE,
          drivers: sqlxUrlRaw.drivers ?? {},
          defaultDatabaseType: sqlxUrlRaw.defaultDatabaseType ?? "sql",
        }
      : undefined;

  const authLibraries: RustAuthLibraryConfig[] =
    raw.auth?.libraries?.map((lib) => ({
      id: lib.id,
      patternId: validatePatternId(
        lib.patternId,
        `rust.auth.libraries['${lib.id}']`,
      ),
      importPaths: normalizeList(lib.importPaths),
      crateNames: normalizeList(lib.crateNames),
      callNames: normalizeCallNames(lib.callNames),
      contentRegexes: (lib.contentRegexes ?? []).map((p) =>
        compileRegex(p, `rust.auth.libraries['${lib.id}'].contentRegexes`),
      ),
      strategy: lib.strategy,
      confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const routeFrameworks: RustRouteFrameworkConfig[] =
    raw.routes?.frameworks?.map((fw) => ({
      id: fw.id,
      patternId: validatePatternId(
        fw.patternId,
        `rust.routes.frameworks['${fw.id}']`,
      ),
      importPaths: normalizeList(fw.importPaths),
      crateNames: normalizeList(fw.crateNames),
      routeRegexes: normalizeRouteRegexes(
        fw.routeRegexes,
        `rust.routes.frameworks['${fw.id}']`,
      ),
      confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const serverlessHandlers: RustServerlessHandlerConfig[] =
    raw.serverless?.handlers?.map((handler) => ({
      id: handler.id,
      patternId: validatePatternId(
        handler.patternId,
        `rust.serverless.handlers['${handler.id}']`,
      ),
      importPaths: normalizeList(handler.importPaths),
      crateNames: normalizeList(handler.crateNames),
      callNames: normalizeCallNames(handler.callNames),
      confidence: handler.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  const envVarRaw = raw.env_config?.envVariable;
  const envVariable =
    envVarRaw && envVarRaw.patternId && envVarRaw.regex
      ? {
          patternId: validatePatternId(
            envVarRaw.patternId,
            "rust.env_config.envVariable.patternId",
          ),
          regex: compileRegex(
            envVarRaw.regex,
            "rust.env_config.envVariable.regex",
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
            "rust.env_config.configLoaders.patternId",
          ),
          confidence: configLoadersRaw.confidence ?? DEFAULT_CONFIDENCE,
          loaders: (configLoadersRaw.loaders ?? []).map((loader) => ({
            id: loader.id,
            importPaths: normalizeList(loader.importPaths),
            crateNames: normalizeList(loader.crateNames),
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
            "rust.env_config.configFile.patternId",
          ),
          fileNameRegex: compileRegex(
            configFileRaw.fileNameRegex,
            "rust.env_config.configFile.fileNameRegex",
          ),
          name: configFileRaw.name ?? "rust_config",
          confidence: configFileRaw.confidence ?? DEFAULT_CONFIDENCE,
        }
      : undefined;

  const httpClients: RustHttpClientConfig[] =
    raw.external_apis?.httpClients?.map((client) => ({
      id: client.id,
      patternId: validatePatternId(
        client.patternId,
        `rust.external_apis.httpClients['${client.id}']`,
      ),
      clientName: client.clientName,
      importPaths: normalizeList(client.importPaths),
      crateNames: normalizeList(client.crateNames),
      callNames: normalizeCallNames(client.callNames),
      callNameSuffixes: normalizeCallNames(client.callNameSuffixes),
      urlRegex: compileRegex(
        client.urlRegex ?? DEFAULT_URL_REGEX,
        `rust.external_apis.httpClients['${client.id}'].urlRegex`,
      ),
      confidence: client.confidence ?? DEFAULT_CONFIDENCE,
    })) ?? [];

  return {
    dbClients,
    sqlxUrl,
    auth: { libraries: authLibraries },
    routes: { frameworks: routeFrameworks },
    serverless: { handlers: serverlessHandlers },
    envConfig: { envVariable, configLoaders, configFile },
    externalApis: { httpClients },
  };
}

let cachedConfig: RustPatternConfig | undefined;

export function clearRustPatternConfigCache(): void {
  cachedConfig = undefined;
}

export function loadRustPatternConfig(): RustPatternConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let rawYaml: string;
  try {
    rawYaml = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Rust pattern config is required but could not be read from '${configPath}': ${msg}`,
    );
  }

  const parsed = YAML.parse(rawYaml) as RawRustPatternConfig | undefined;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Rust pattern config at '${configPath}' did not parse to an object.`,
    );
  }

  const normalized = normalizeRawConfig(parsed);
  cachedConfig = normalized;
  return normalized;
}
