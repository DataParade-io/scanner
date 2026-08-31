import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import { defaultServiceNameFromLiteralPublicUrl } from "../../classifier/external-url-third-party";
import type { RawFinding } from "../../core/types/detection";
import { BUNDLER_GEM_PREFIX } from "../../analyzers/ruby/manifest-parsers";
import {
  buildThirdPartyUrlHostPatterns,
  inferServiceNameFromUrl,
} from "./helpers";

function requirePathMatches(importPath: string, want: string): boolean {
  if (!want) return false;
  return importPath === want || importPath.startsWith(`${want}/`);
}

function hasAnyRequirePath(ctx: PatternContext, paths: string[]): boolean {
  if (paths.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) => {
    if (imp.module.startsWith(BUNDLER_GEM_PREFIX)) return false;
    return paths.some((want) => requirePathMatches(imp.module, want));
  });
}

function hasAnyGemName(ctx: PatternContext, gemNames: string[]): boolean {
  if (gemNames.length === 0) return false;
  const imports = ctx.imports ?? [];
  return imports.some((imp) => {
    if (!imp.module.startsWith(BUNDLER_GEM_PREFIX)) return false;
    const name = imp.module.slice(BUNDLER_GEM_PREFIX.length);
    return gemNames.some((want) => name === want);
  });
}

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

/**
 * Rails HTTP map lives in config/routes.rb, drawn route files under
 * config/routes/, or an explicit Rails.application.routes.draw block.
 * Bare `get "/x"` elsewhere is too generic in Ruby to treat as a route.
 */
function isRailsRoutesContext(ctx: PatternContext): boolean {
  const normalized = (ctx.normalizedPath ?? ctx.file.path)
    .split("\\")
    .join("/")
    .toLowerCase();
  if (
    normalized === "config/routes.rb" ||
    normalized.endsWith("/config/routes.rb") ||
    /(^|\/)config\/routes\//.test(normalized)
  ) {
    return true;
  }
  return /Rails\.application\.routes\.draw/.test(sourceOf(ctx));
}

function callNameRegex(callNames: string[]): RegExp {
  const escaped = callNames
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return /(?!)/;
  return new RegExp(`(?:^|[^A-Za-z0-9_:])(?:${escaped.join("|")})`);
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

export function detectRubyDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const db of config.ruby.dbClients) {
    const hasRequire = hasAnyRequirePath(ctx, db.requirePaths);
    const hasGem = hasAnyGemName(ctx, db.gemNames);
    const hasCall =
      db.callNames.length > 0 && callNameRegex(db.callNames).test(content);

    if (!hasRequire && !hasGem && !hasCall) continue;

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

  const databaseUrl = config.ruby.databaseUrl;
  if (databaseUrl) {
    const lines = content.split(/\r?\n/);
    const seenDrivers = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const match = databaseUrl.regex.exec(lines[i]);
      if (!match) continue;

      const url = (match[1] ?? "").trim();
      const driver = url.split(":")[0]?.toLowerCase() ?? "";
      if (!driver || seenDrivers.has(driver)) continue;
      seenDrivers.add(driver);

      const databaseType =
        databaseUrl.drivers[driver] ?? databaseUrl.defaultDatabaseType;

      findings.push({
        pattern: databaseUrl.patternId,
        name: `${databaseUrl.name}:${driver}`,
        confidence: databaseUrl.confidence,
        location: {
          filePath: ctx.file.path,
          startLine: i + 1,
          endLine: i + 1,
          code: lines[i].trim(),
        },
        properties: {
          client: databaseUrl.name,
          databaseType,
          driver,
          url,
        },
      });
    }
  }

  return findings;
}

export function detectRubyAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const lib of config.ruby.auth.libraries) {
    const hasRequire = hasAnyRequirePath(ctx, lib.requirePaths);
    const hasGem = hasAnyGemName(ctx, lib.gemNames);
    const hasCall =
      lib.callNames.length > 0 && callNameRegex(lib.callNames).test(content);
    const matchesContent =
      lib.contentRegexes.length > 0 &&
      lib.contentRegexes.some((re) => re.test(content));

    if (!hasRequire && !hasGem && !hasCall && !matchesContent) continue;

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

export function detectRubyEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const envCfg = config.ruby.envConfig;
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
        name: key ? `ENV[${key}]` : "env_variable",
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
      const hasRequire = hasAnyRequirePath(ctx, loader.requirePaths);
      const hasGem = hasAnyGemName(ctx, loader.gemNames);
      const hasCall =
        loader.callNames.length > 0 &&
        callNameRegex(loader.callNames).test(content);

      if (!hasRequire && !hasGem && !hasCall) continue;

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

export function detectRubyRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.ruby.routes.frameworks) {
    if (fw.requireRailsRoutesContext && !isRailsRoutesContext(ctx)) {
      continue;
    }

    const gated =
      fw.requirePaths.length > 0 ||
      fw.gemNames.length > 0 ||
      fw.requireRailsRoutesContext;
    const supportsFramework =
      fw.requireRailsRoutesContext ||
      !gated ||
      hasAnyRequirePath(ctx, fw.requirePaths) ||
      hasAnyGemName(ctx, fw.gemNames);
    if (!supportsFramework) continue;

    for (const routeRegex of fw.routeRegexes) {
      for (let i = 0; i < lines.length; i += 1) {
        const text = lines[i].trim();
        if (!text || text.startsWith("#")) continue;

        const match = routeRegex.regex.exec(text);
        if (!match) continue;

        const rawMethod =
          routeRegex.methodGroup != null
            ? match[routeRegex.methodGroup]
            : routeRegex.defaultMethod;
        const method = rawMethod ? rawMethod.toUpperCase() : undefined;
        let routePath =
          routeRegex.pathGroup != null ? match[routeRegex.pathGroup] : undefined;

        // root "home#index" → path "/" for a readable label
        if (fw.id === "rails" && /\broot\s+/.test(text)) {
          routePath = "/";
        }

        // resources :users → /users for a readable label
        if (
          routePath &&
          !routePath.startsWith("/") &&
          fw.id === "rails" &&
          /\bresources?\s+:/.test(text)
        ) {
          routePath = `/${routePath}`;
        }

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

export function detectRubyServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const findings: RawFinding[] = [];

  for (const handler of config.ruby.serverless.handlers) {
    const hasRequire = hasAnyRequirePath(ctx, handler.requirePaths);
    const hasGem = hasAnyGemName(ctx, handler.gemNames);
    if (!hasRequire && !hasGem) continue;

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

export function detectRubyExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const calls = ctx.moduleLevelCalls ?? [];
  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.ruby.externalApis.httpClients) {
    const hasRequire = hasAnyRequirePath(ctx, client.requirePaths);
    const hasGem = hasAnyGemName(ctx, client.gemNames);
    const hasCallSignal =
      client.callNames.length > 0 && callNameRegex(client.callNames).test(content);
    // Zeitwerk apps rarely `require "faraday"` — constant calls are enough.
    if (
      (client.requirePaths.length > 0 || client.gemNames.length > 0) &&
      !hasRequire &&
      !hasGem &&
      !hasCallSignal
    ) {
      continue;
    }

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

    if (!emitted && hasCallSignal) {
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

  return findings;
}
