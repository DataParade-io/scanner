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

interface RawAuthLibraryConfig {
  id: string;
  patternId: string;
  filePathRegex?: string;
  contentRegexes?: string[];
  strategy?: string;
  confidence?: number;
}

interface RawCacheClientConfig {
  id: string;
  patternId: string;
  databaseType: string;
  componentSubType?: string;
  filePathRegex?: string;
  contentRegexes?: string[];
  confidence?: number;
}

interface RawServiceConfig {
  id: string;
  patternId: string;
  componentSubType?: string;
  filePathRegex?: string;
  classRegex?: string;
  confidence?: number;
}

interface RawRubyPatternConfig {
  active_record?: {
    patternId: string;
    filePathRegex?: string;
    classRegex?: string;
    confidence?: number;
  };
  database_yml?: {
    patternId: string;
    filePathRegex?: string;
    adapterRegex?: string;
    databaseNameRegex?: string;
    confidence?: number;
    drivers?: Record<string, string>;
  };
  routes?: {
    frameworks?: Array<{
      id: string;
      patternId: string;
      filePathRegex?: string;
      routeRegexes?: RawRouteRegex[];
      confidence?: number;
    }>;
  };
  auth?: {
    libraries?: RawAuthLibraryConfig[];
  };
  cache?: {
    clients?: RawCacheClientConfig[];
  };
  services?: RawServiceConfig[];
}

export interface RubyRouteRegex {
  regex: RegExp;
  methodGroup?: number;
  pathGroup?: number;
  defaultMethod?: string;
}

export interface RubyActiveRecordConfig {
  patternId: PatternId;
  filePathRegex: RegExp;
  classRegex: RegExp;
  confidence: number;
}

export interface RubyDatabaseYmlConfig {
  patternId: PatternId;
  filePathRegex: RegExp;
  adapterRegex: RegExp;
  databaseNameRegex: RegExp;
  confidence: number;
  drivers: Record<string, string>;
}

export interface RubyRouteFrameworkConfig {
  id: string;
  patternId: PatternId;
  filePathRegex: RegExp;
  routeRegexes: RubyRouteRegex[];
  confidence: number;
}

export interface RubyAuthLibraryConfig {
  id: string;
  patternId: PatternId;
  filePathRegex?: RegExp;
  contentRegexes: RegExp[];
  strategy?: string;
  confidence: number;
}

export interface RubyCacheClientConfig {
  id: string;
  patternId: PatternId;
  databaseType: string;
  componentSubType?: string;
  filePathRegex?: RegExp;
  contentRegexes: RegExp[];
  confidence: number;
}

export interface RubyServiceConfig {
  id: string;
  patternId: PatternId;
  componentSubType?: string;
  filePathRegex: RegExp;
  classRegex: RegExp;
  confidence: number;
}

export interface RubyPatternConfig {
  activeRecord: RubyActiveRecordConfig;
  databaseYml: RubyDatabaseYmlConfig;
  routes: {
    frameworks: RubyRouteFrameworkConfig[];
  };
  auth: {
    libraries: RubyAuthLibraryConfig[];
  };
  cache: {
    clients: RubyCacheClientConfig[];
  };
  services: RubyServiceConfig[];
}

const DEFAULT_CONFIDENCE = 0.8;

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
  const ar = raw.active_record;
  if (!ar?.classRegex || !ar.filePathRegex) {
    throw new Error("ruby.patterns.yaml: active_record requires filePathRegex and classRegex");
  }

  const dbYml = raw.database_yml;
  if (!dbYml?.adapterRegex || !dbYml.filePathRegex) {
    throw new Error("ruby.patterns.yaml: database_yml requires filePathRegex and adapterRegex");
  }

  return {
    activeRecord: {
      patternId: validatePatternId(ar.patternId, "ruby.active_record"),
      filePathRegex: compileRegex(ar.filePathRegex, "ruby.active_record.filePathRegex"),
      classRegex: compileRegex(ar.classRegex, "ruby.active_record.classRegex"),
      confidence: ar.confidence ?? DEFAULT_CONFIDENCE,
    },
    databaseYml: {
      patternId: validatePatternId(dbYml.patternId, "ruby.database_yml"),
      filePathRegex: compileRegex(dbYml.filePathRegex, "ruby.database_yml.filePathRegex"),
      adapterRegex: compileRegex(dbYml.adapterRegex, "ruby.database_yml.adapterRegex"),
      databaseNameRegex: compileRegex(
        dbYml.databaseNameRegex ?? "^\\s*database:\\s*([\\w_-]+)",
        "ruby.database_yml.databaseNameRegex",
      ),
      confidence: dbYml.confidence ?? DEFAULT_CONFIDENCE,
      drivers: dbYml.drivers ?? {},
    },
    routes: {
      frameworks: (raw.routes?.frameworks ?? []).map((fw) => ({
        id: fw.id,
        patternId: validatePatternId(fw.patternId, `ruby.routes.frameworks.${fw.id}`),
        filePathRegex: compileRegex(
          fw.filePathRegex ?? "(?:^|/)config/routes\\.rb$",
          `ruby.routes.frameworks.${fw.id}.filePathRegex`,
        ),
        routeRegexes: normalizeRouteRegexes(
          fw.routeRegexes,
          `ruby.routes.frameworks.${fw.id}`,
        ),
        confidence: fw.confidence ?? DEFAULT_CONFIDENCE,
      })),
    },
    auth: {
      libraries: (raw.auth?.libraries ?? []).map((lib) => ({
        id: lib.id,
        patternId: validatePatternId(lib.patternId, `ruby.auth.libraries.${lib.id}`),
        filePathRegex: lib.filePathRegex
          ? compileRegex(lib.filePathRegex, `ruby.auth.libraries.${lib.id}.filePathRegex`)
          : undefined,
        contentRegexes: (lib.contentRegexes ?? []).map((pattern, index) =>
          compileRegex(pattern, `ruby.auth.libraries.${lib.id}.contentRegexes[${index}]`),
        ),
        strategy: lib.strategy,
        confidence: lib.confidence ?? DEFAULT_CONFIDENCE,
      })),
    },
    cache: {
      clients: (raw.cache?.clients ?? []).map((client) => ({
        id: client.id,
        patternId: validatePatternId(client.patternId, `ruby.cache.clients.${client.id}`),
        databaseType: client.databaseType,
        componentSubType: client.componentSubType,
        filePathRegex: client.filePathRegex
          ? compileRegex(client.filePathRegex, `ruby.cache.clients.${client.id}.filePathRegex`)
          : undefined,
        contentRegexes: (client.contentRegexes ?? []).map((pattern, index) =>
          compileRegex(pattern, `ruby.cache.clients.${client.id}.contentRegexes[${index}]`),
        ),
        confidence: client.confidence ?? DEFAULT_CONFIDENCE,
      })),
    },
    services: (raw.services ?? []).map((svc) => ({
      id: svc.id,
      patternId: validatePatternId(svc.patternId, `ruby.services.${svc.id}`),
      componentSubType: svc.componentSubType,
      filePathRegex: compileRegex(
        svc.filePathRegex ?? "(?:^|/)app/services/",
        `ruby.services.${svc.id}.filePathRegex`,
      ),
      classRegex: compileRegex(
        svc.classRegex ?? "^\\s*class\\s+(\\w+)",
        `ruby.services.${svc.id}.classRegex`,
      ),
      confidence: svc.confidence ?? DEFAULT_CONFIDENCE,
    })),
  };
}

let cachedConfig: RubyPatternConfig | undefined;

export function loadRubyPatternConfig(): RubyPatternConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getConfigPath();
  const rawText = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(rawText) as RawRubyPatternConfig;
  cachedConfig = normalizeRawConfig(parsed);
  return cachedConfig;
}

export function __clearRubyPatternConfigForTest(): void {
  cachedConfig = undefined;
}
