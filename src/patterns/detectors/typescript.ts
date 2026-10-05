import {
  defaultServiceNameFromLiteralPublicUrl,
  shouldIgnoreExternalHttpUrl,
} from "../../classifier/external-url-third-party";
import type { ImportLike, PatternContext } from "../../patterns/engine";
import type { UnifiedPatternConfig } from "../config";
import type { RawFinding } from "../../core/types/detection";
import type { SourceLocation } from "../../core/types/file";
import {
  buildThirdPartyUrlHostPatterns,
  createLocationFromLine,
  dedupeLocations,
  findLineMatches,
  inferServiceNameFromUrl,
  locationsForContentRegexes,
  locationsForMatchingImports,
  locationsForSubstrings,
  sourceOf,
} from "./helpers";

function importMatchesFragment(imp: ImportLike, fragment: string): boolean {
  return (
    imp.module === fragment ||
    imp.module.includes(fragment) ||
    imp.names.some((name) => name === fragment || name.includes(fragment))
  );
}

function matchingImportLocations(
  ctx: PatternContext,
  fragments: readonly string[],
): SourceLocation[] {
  if (fragments.length === 0) return [];
  return locationsForMatchingImports(ctx.file, ctx.imports, (imp) =>
    fragments.some((fragment) => importMatchesFragment(imp, fragment)),
  );
}

export function detectTypeScriptJavaScriptExternalApisFromHttpClients(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.includeThirdPartyHttpLinePatterns
  ) {
    return [];
  }

  const content = ctx.file.content ?? "";
  const findings: RawFinding[] = [];
  const urlHostPatterns = buildThirdPartyUrlHostPatterns(config);

  for (const client of config.thirdParty.httpClients) {
    for (const regex of client.callRegexes) {
      const httpMatches = findLineMatches(content, regex);
      for (const { line, match } of httpMatches) {
        const [, clientName, methodMaybe, url] = match;
        if (shouldIgnoreExternalHttpUrl(url)) {
          continue;
        }
        const method =
          typeof methodMaybe === "string"
            ? methodMaybe.toUpperCase()
            : undefined;

        const serviceName =
          inferServiceNameFromUrl(url, urlHostPatterns) ??
          defaultServiceNameFromLiteralPublicUrl(url);

        findings.push({
          pattern: client.patternId,
          name: url,
          confidence: client.confidence,
          location: createLocationFromLine(ctx.file, line, match[0]),
          properties: {
            client: clientName,
            url,
            httpMethod: method,
            ...(serviceName ? { serviceName } : {}),
          },
        });
      }
    }
  }

  return findings;
}

export function detectTypeScriptRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;
  const lines = content.split(/\r?\n/);

  for (const fw of tsCfg.routes.frameworks) {
    const hasFrameworkImport =
      fw.imports.length === 0
        ? false
        : fw.imports.some((mod) =>
            (ctx.imports ?? []).some(
              (imp) =>
                imp.module === mod ||
                imp.module.includes(mod) ||
                imp.names.some((name) => name === mod || name.includes(mod)),
            ),
          );

    if (!hasFrameworkImport) continue;

    if (fw.id === "express") {
      for (const regex of fw.routeCallRegexes) {
        const matches = findLineMatches(content, regex);
        for (const { line, match } of matches) {
          const [, , method, path] = match;
          const upperMethod =
            typeof method === "string" && method.toUpperCase
              ? method.toUpperCase()
              : "GET";

          findings.push({
            pattern: fw.patternId,
            name: `${upperMethod} ${path}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "express",
              httpMethods: [upperMethod],
              path,
              handlerType: "route_handler",
            },
          });
        }
      }
    } else if (fw.id === "nest") {
      for (const regex of fw.controllerDecoratorRegexes) {
        const controllerMatches = findLineMatches(content, regex);
        for (const { line, match } of controllerMatches) {
          const [, basePath] = match;
          findings.push({
            pattern: fw.patternId,
            name: `NEST_CONTROLLER ${basePath || "/"}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "nest",
              httpMethods: [],
              path: basePath || "/",
            },
          });
        }
      }

      for (const regex of fw.routeDecoratorRegexes) {
        const decoratorMatches = findLineMatches(content, regex);
        for (const { line, match } of decoratorMatches) {
          const [, method, routePath] = match;
          const upperMethod =
            typeof method === "string" && method.toUpperCase
              ? method.toUpperCase()
              : "GET";

          findings.push({
            pattern: fw.patternId,
            name: `${upperMethod} ${routePath || "/"}`,
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              framework: "nest",
              httpMethods: [upperMethod],
              path: routePath || "/",
              handlerType: "controller_action",
            },
          });
        }
      }
    }

    if (fw.routeRegexes.length > 0) {
      for (const routeRegex of fw.routeRegexes) {
        for (let i = 0; i < lines.length; i += 1) {
          const text = lines[i]?.trim() ?? "";
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

          findings.push({
            pattern: fw.patternId,
            name: method
              ? `${method} ${routePath ?? fw.id}`.trim()
              : `${fw.id.toUpperCase()} ${routePath ?? "service"}`.trim(),
            confidence: fw.confidence,
            location: createLocationFromLine(ctx.file, i + 1, text),
            properties: {
              framework: fw.id,
              httpMethods: method ? [method] : [],
              ...(routePath ? { path: routePath } : {}),
              handlerType: "grpc_service",
            },
          });
        }
      }
    }
  }

  const normalizedPath = ctx.normalizedPath.toLowerCase();
  if (
    normalizedPath.includes("pages/api/") ||
    normalizedPath.includes("/app/") ||
    normalizedPath.endsWith("route.ts") ||
    normalizedPath.endsWith("route.js")
  ) {
    const { regex, confidence } = tsCfg.heuristics.nextRouteHandler;
    const handlerMatches = findLineMatches(content, regex);

    for (const { line, match } of handlerMatches) {
      findings.push({
        pattern: "express_route",
        name: "Route handler",
        confidence,
        location: createLocationFromLine(ctx.file, line, match[0]),
        properties: {
          framework: "next_or_react_route",
          httpMethods: [],
          path: undefined,
        },
      });
    }
  }

  return findings;
}

export function detectTypeScriptDatabaseFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  for (const client of tsCfg.dbClients) {
    const importLocations = matchingImportLocations(ctx, client.importModules);
    const hasImport = importLocations.length > 0;
    const seenSpans = new Set<string>();

    for (const regex of client.creationRegexes) {
      const matches = findLineMatches(content, regex);
      for (const { line, match } of matches) {
        const matchedSnippet = String(match[0] ?? "").toLowerCase();
        const hasClientHintInSnippet =
          matchedSnippet.includes(client.id.toLowerCase()) ||
          matchedSnippet.includes(client.databaseType.toLowerCase());
        if (!hasImport && !hasClientHintInSnippet) {
          continue;
        }
        const location = createLocationFromLine(ctx.file, line, match[0]);
        const spanKey = `${location.startLine}:${location.endLine}`;
        if (seenSpans.has(spanKey)) continue;
        seenSpans.add(spanKey);
        findings.push({
          pattern: client.patternId,
          name: client.id,
          confidence: client.confidence,
          location,
          properties: {
            client: client.id,
            databaseType: client.databaseType,
          },
        });
      }
    }

    for (const location of importLocations) {
      const spanKey = `${location.startLine}:${location.endLine}`;
      if (seenSpans.has(spanKey)) continue;
      seenSpans.add(spanKey);
      findings.push({
        pattern: client.patternId,
        name: client.id,
        confidence: Math.max(0.5, client.confidence - 0.2),
        location,
        properties: {
          client: client.id,
          databaseType: client.databaseType,
        },
      });
    }
  }

  const hasAnyDbClientImport = tsCfg.dbClients.some(
    (client) => matchingImportLocations(ctx, client.importModules).length > 0,
  );

  if (hasAnyDbClientImport) {
    for (const location of locationsForContentRegexes(ctx.file, content, [
      tsCfg.heuristics.sqlKeyword.regex,
    ])) {
      findings.push({
        pattern: tsCfg.heuristics.sqlKeyword.patternId,
        name: "sql_query_detected",
        confidence: tsCfg.heuristics.sqlKeyword.confidence,
        location,
        properties: { hint: "raw_sql_keyword" },
      });
    }
  }

  return findings;
}

export function detectTypeScriptAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  for (const lib of tsCfg.auth.libraries) {
    if (lib.filePathRegex && !lib.filePathRegex.test(ctx.normalizedPath)) {
      continue;
    }

    if (lib.contentRegexes.length > 0) {
      for (const regex of lib.contentRegexes) {
        const contentMatches = findLineMatches(content, regex);
        for (const { line, match } of contentMatches) {
          findings.push({
            pattern: lib.patternId,
            name: match[1] ?? lib.id,
            confidence: lib.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              ...(lib.strategy ? { strategy: lib.strategy } : {}),
              ...(lib.componentSubType
                ? { componentSubType: lib.componentSubType }
                : {}),
            },
          });
        }
      }
      if (lib.importFragments.length === 0) {
        continue;
      }
    }

    const libraryImportLocations = matchingImportLocations(
      ctx,
      lib.importFragments,
    );
    const hasLibraryImport = libraryImportLocations.length > 0;

    if (!hasLibraryImport) continue;

    if (lib.id === "passport") {
      let emittedSpecific = false;

      for (const regex of lib.callRegexes) {
        const passportMatches = findLineMatches(content, regex);
        for (const { line, match } of passportMatches) {
          const [, strategy] = match;
          emittedSpecific = true;
          findings.push({
            pattern: lib.patternId,
            name: `passport:${strategy}`,
            confidence: lib.confidence,
            location: createLocationFromLine(ctx.file, line, match[0]),
            properties: {
              library: "passport",
              strategy,
            },
          });
        }
      }

      if (!emittedSpecific) {
        for (const location of libraryImportLocations) {
          findings.push({
            pattern: lib.patternId,
            name: "passport",
            confidence: lib.confidence - 0.15,
            location,
            properties: {
              library: "passport",
            },
          });
        }
      }
    } else if (lib.id === "jsonwebtoken") {
      const callLocations = locationsForSubstrings(ctx.file, content, [
        "jwt.sign(",
        "jwt.verify(",
      ]);
      if (callLocations.length === 0) continue;
      for (const location of dedupeLocations([
        ...libraryImportLocations,
        ...callLocations,
      ])) {
        findings.push({
          pattern: lib.patternId,
          name: "jwt",
          confidence: lib.confidence,
          location,
          properties: {
            library: "jsonwebtoken",
            ...(lib.strategy ? { strategy: lib.strategy } : {}),
          },
        });
      }
    } else if (lib.id === "nest_auth") {
      const guardLocations = locationsForSubstrings(ctx.file, content, [
        "UseGuards(",
      ]);
      if (guardLocations.length === 0) continue;
      for (const location of dedupeLocations([
        ...libraryImportLocations,
        ...guardLocations,
      ])) {
        findings.push({
          pattern: lib.patternId,
          name: "nest_auth_guard",
          confidence: lib.confidence,
          location,
          properties: {
            library: "nestjs_auth",
          },
        });
      }
    } else if (lib.id === "oauth2") {
      for (const location of libraryImportLocations) {
        findings.push({
          pattern: lib.patternId,
          name: lib.id,
          confidence: lib.confidence,
          location,
          properties: {
            library: lib.id,
            ...(lib.strategy ? { strategy: lib.strategy } : {}),
          },
        });
      }
    }
  }

  return findings;
}

export function detectTypeScriptEnvAndConfigFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (
    (ctx.language !== "typescript" && ctx.language !== "javascript") ||
    !ctx.normalizedPath
  ) {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];
  const tsCfg = config.typescript;

  const { regex: envRegex, confidence: envConfidence } =
    tsCfg.heuristics.processEnv;
  const envMatches = findLineMatches(content, envRegex);

  for (const { line, match } of envMatches) {
    const [, key] = match;
    findings.push({
      pattern: "env_variable",
      name: `process.env.${key}`,
      confidence: envConfidence,
      location: createLocationFromLine(ctx.file, line, match[0]),
      properties: {
        key,
      },
    });
  }

  const knownKeys = new Set(tsCfg.configKeys.keys.map((k) => k.name));
  if (knownKeys.size > 0) {
    const configRegex = tsCfg.heuristics.configKeyAccess.regex;
    const configMatches = findLineMatches(content, configRegex);

    for (const { line, match } of configMatches) {
      const [, key] = match;
      if (!knownKeys.has(key)) continue;
      const keyConfig = tsCfg.configKeys.keys.find((k) => k.name === key);
      const confidence = keyConfig?.confidence ?? 0.8;

      findings.push({
        pattern: keyConfig?.patternId ?? "config_file",
        name: `config.${key}`,
        confidence,
        location: createLocationFromLine(ctx.file, line, match[0]),
        properties: {
          key,
        },
      });
    }
  }

  for (const loader of tsCfg.configLoaders) {
    const importLocations = matchingImportLocations(ctx, loader.importFragments);
    if (importLocations.length === 0) continue;

    const callLocations = locationsForContentRegexes(
      ctx.file,
      content,
      loader.callRegexes,
    );
    if (loader.callRegexes.length > 0 && callLocations.length === 0) continue;

    for (const location of dedupeLocations([
      ...importLocations,
      ...callLocations,
    ])) {
      findings.push({
        pattern: loader.patternId,
        name: loader.name,
        confidence: loader.confidence,
        location,
        properties: {
          loader: loader.id,
        },
      });
    }
  }

  return findings;
}

export function detectTypeScriptServerlessHandlersFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "typescript" && ctx.language !== "javascript") {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const handler of config.typescript.serverless.handlers) {
    const hasImport =
      handler.importModules.length === 0
        ? false
        : handler.importModules.some((mod) =>
            (ctx.imports ?? []).some(
              (imp) =>
                imp.module === mod ||
                imp.module.includes(mod) ||
                imp.names.some((name) => name === mod || name.includes(mod)),
            ),
          );
    const hasTypeSignal = handler.typeNames.some((typeName) =>
      content.includes(typeName),
    );

    for (const regex of handler.handlerRegexes) {
      const matches = findLineMatches(content, regex);
      for (const { line, match } of matches) {
        if (!hasImport && !hasTypeSignal) continue;

        findings.push({
          pattern: handler.patternId,
          name: `${handler.id} handler`,
          confidence: handler.confidence,
          location: createLocationFromLine(ctx.file, line, match[0]),
          properties: {
            framework: handler.id,
            handler: "handler",
            handlerType: "serverless_handler",
          },
        });
      }
    }
  }

  return findings;
}

export function detectTypeScriptExternalApisFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "typescript" && ctx.language !== "javascript") {
    return [];
  }

  const content = sourceOf(ctx);
  const findings: RawFinding[] = [];

  for (const client of config.typescript.externalApis.httpClients) {
    const hasClientImport =
      client.importFragments.length === 0 ||
      client.importFragments.some((frag) =>
        (ctx.imports ?? []).some(
          (imp) =>
            imp.module === frag ||
            imp.module.includes(frag) ||
            imp.names.some((name) => name === frag || name.includes(frag)),
        ),
      );
    if (!hasClientImport) continue;

    for (const regex of client.callRegexes) {
      const matches = findLineMatches(content, regex);
      for (const { line, match } of matches) {
        findings.push({
          pattern: client.patternId,
          name: `${client.clientName}_call`,
          confidence: client.confidence,
          location: createLocationFromLine(ctx.file, line, match[0]),
          properties: {
            client: client.clientName,
          },
        });
      }
    }
  }

  return findings;
}

