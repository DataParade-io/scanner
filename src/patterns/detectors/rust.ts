import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import { CARGO_CRATE_PREFIX } from "../../analyzers/rust/manifest-parsers";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

/**
 * Match a Rust `use` path against a configured prefix.
 * `axum` matches `axum::routing::get`.
 */
function importPathMatches(importPath: string, want: string): boolean {
  if (!want) return false;
  return importPath === want || importPath.startsWith(`${want}::`);
}

function hasAnyImportPath(ctx: PatternContext, paths: string[]): boolean {
  if (paths.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) => {
    if (imp.module.startsWith(CARGO_CRATE_PREFIX)) return false;
    return paths.some((want) => importPathMatches(imp.module, want));
  });
}

/**
 * Cargo crate names are fed as `crate:<name>` so they stay disjoint from
 * `use` paths that use `::`.
 */
function hasAnyCrateName(ctx: PatternContext, crateNames: string[]): boolean {
  if (crateNames.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) => {
    if (!imp.module.startsWith(CARGO_CRATE_PREFIX)) return false;
    const name = imp.module.slice(CARGO_CRATE_PREFIX.length);
    return crateNames.some((want) => name === want);
  });
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return /(?!)/;
  return new RegExp(`(?:^|[^A-Za-z0-9_:])(?:${escaped.join("|")})\\s*[({!]`);
}

function calleeMatches(
  callee: string,
  callNames: string[],
  suffixes: string[],
): boolean {
  if (callNames.some((name) => callee === name || callee.endsWith(name))) {
    return true;
  }
  return suffixes.some((suffix) => callee.endsWith(suffix));
}

export function detectRustDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.rust.dbClients) {
    const hasImport = hasAnyImportPath(ctx, db.importPaths);
    const hasCrate = hasAnyCrateName(ctx, db.crateNames);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);

    if (!hasImport && !hasCrate && !hasCall) continue;

    findings.push({
      pattern: db.patternId,
      name: db.id,
      confidence: db.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        client: db.id,
        databaseType: db.databaseType,
      },
    });
  }

  const sqlxUrl = config.rust.sqlxUrl;
  if (sqlxUrl) {
    const lines = content.split(/\r?\n/);
    const seenDrivers = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const match = sqlxUrl.regex.exec(lines[i]);
      if (!match) continue;

      const url = (match[1] ?? "").trim();
      const driver = url.split(":")[0]?.toLowerCase() ?? "";
      if (!driver || seenDrivers.has(driver)) continue;
      seenDrivers.add(driver);

      const databaseType =
        sqlxUrl.drivers[driver] ?? sqlxUrl.defaultDatabaseType;

      findings.push({
        pattern: sqlxUrl.patternId,
        name: `${sqlxUrl.name}:${driver}`,
        confidence: sqlxUrl.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: lines[i].trim(),
        },
        properties: {
          client: sqlxUrl.name,
          databaseType,
          driver,
          url,
        },
      });
    }
  }

  return findings;
}

export function detectRustAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.rust.auth.libraries) {
    const hasImport = hasAnyImportPath(ctx, lib.importPaths);
    const hasCrate = hasAnyCrateName(ctx, lib.crateNames);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasImport && !hasCrate && !hasCall && !matchesContent) continue;

    findings.push({
      pattern: lib.patternId,
      name: lib.id,
      confidence: lib.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        ...(lib.strategy ? { strategy: lib.strategy } : {}),
      },
    });
  }

  return findings;
}

export function detectRustEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const envCfg = config.rust.envConfig;
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  if (envCfg.envVariable) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = envCfg.envVariable.regex.exec(line);
      if (!match) continue;

      const key = match[1];
      findings.push({
        pattern: envCfg.envVariable.patternId,
        name: key ? `env::var(${key})` : "env_variable",
        confidence: envCfg.envVariable.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim(),
        },
        properties: key ? { key } : {},
      });
    }
  }

  if (envCfg.configLoaders) {
    for (const loader of envCfg.configLoaders.loaders) {
      const hasImport = hasAnyImportPath(ctx, loader.importPaths);
      const hasCrate = hasAnyCrateName(ctx, loader.crateNames);
      const hasCall =
        loader.callNames.length > 0 &&
        callNameRegex(loader.callNames).test(content);

      if (!hasImport && !hasCrate && !hasCall) continue;

      findings.push({
        pattern: envCfg.configLoaders.patternId,
        name: loader.id,
        confidence: envCfg.configLoaders.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {},
      });
    }
  }

  if (envCfg.configFile) {
    const normalizedPath = (ctx.normalizedPath ?? ctx.file.path).toLowerCase();
    if (envCfg.configFile.fileNameRegex.test(normalizedPath)) {
      findings.push({
        pattern: envCfg.configFile.patternId,
        name: envCfg.configFile.name,
        confidence: envCfg.configFile.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: 1,
          endLine: 1,
        },
        properties: {},
      });
    }
  }

  return findings;
}

export function detectRustRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.rust.routes.frameworks) {
    const gated = fw.importPaths.length > 0 || fw.crateNames.length > 0;
    const supportsFramework =
      !gated ||
      hasAnyImportPath(ctx, fw.importPaths) ||
      hasAnyCrateName(ctx, fw.crateNames);
    if (!supportsFramework) continue;

    for (const routeRegex of fw.routeRegexes) {
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i].trim();
        if (!text) continue;

        const match = routeRegex.regex.exec(text);
        if (!match) continue;

        const rawMethod =
          routeRegex.methodGroup != null
            ? match[routeRegex.methodGroup]
            : routeRegex.defaultMethod;
        const method = rawMethod ? rawMethod.toUpperCase() : undefined;
        const routePath =
          routeRegex.pathGroup != null ? match[routeRegex.pathGroup] : undefined;

        // Skip bare Router::new() noise when a path was expected on other rules.
        if (!routePath && !method) continue;

        const name = method
          ? `${method} ${routePath ?? ""}`.trim()
          : `${fw.id.toUpperCase()}_ROUTE ${routePath ?? ""}`.trim();

        findings.push({
          pattern: fw.patternId,
          name,
          confidence: fw.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: i + 1,
            endLine: i + 1,
            code: text,
          },
          properties: {
            framework: fw.id,
            httpMethods: method ? [method] : [],
            ...(routePath ? { path: routePath } : {}),
          },
        });
      }
    }
  }

  return findings;
}

export function detectRustServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const findings: RawFinding[] = [];

  for (const handler of config.rust.serverless.handlers) {
    const hasImport = hasAnyImportPath(ctx, handler.importPaths);
    const hasCrate = hasAnyCrateName(ctx, handler.crateNames);
    if (!hasImport && !hasCrate) continue;

    findings.push({
      pattern: handler.patternId,
      name: handler.id,
      confidence: handler.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: 1,
        endLine: 1,
      },
      properties: {
        framework: handler.id,
      },
    });
  }

  return findings;
}

export function detectRustExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "rust") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.rust.externalApis.httpClients) {
    const gated =
      client.importPaths.length > 0 || client.crateNames.length > 0;
    const supportsClient =
      !gated ||
      hasAnyImportPath(ctx, client.importPaths) ||
      hasAnyCrateName(ctx, client.crateNames);
    if (!supportsClient) continue;

    let emitted = false;

    for (const call of calls) {
      const callee = call.callee ?? "";
      if (!calleeMatches(callee, client.callNames, client.callNameSuffixes)) {
        continue;
      }

      const snippet = call.argumentsSnippet ?? "";
      const match = client.urlRegex.exec(snippet);
      const url = match?.[1];

      const serviceName =
        inferServiceNameFromUrl(url, urlHostPatterns) ??
        defaultServiceNameFromLiteralPublicUrl(url) ??
        client.clientName;

      findings.push({
        pattern: client.patternId,
        name: `${client.clientName}_call`,
        confidence: client.confidence,
        location: call.location,
        properties: {
          ...(url ? { url } : {}),
          ...(serviceName ? { serviceName } : {}),
        },
      });
      emitted = true;
    }

    if (!emitted && client.callNames.length > 0) {
      if (callNameRegex(client.callNames).test(content)) {
        const urlMatch = client.urlRegex.exec(content);
        const url = urlMatch?.[1];
        const serviceName =
          inferServiceNameFromUrl(url, urlHostPatterns) ??
          defaultServiceNameFromLiteralPublicUrl(url) ??
          client.clientName;

        findings.push({
          pattern: client.patternId,
          name: `${client.clientName}_call`,
          confidence: client.confidence,
          location: {
            filePath: ctx.file.path,
            startLine: 1,
            endLine: 1,
          },
          properties: {
            ...(url ? { url } : {}),
            ...(serviceName ? { serviceName } : {}),
          },
        });
      }
    }
  }

  return findings;
}
