import type { PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";
import type { RawFinding } from "../../core/types/detection";

function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

function normalizedPathOf(ctx: PatternContext): string {
  return (ctx.normalizedPath ?? ctx.file.path).replace(/\\/g, "/");
}

function pathMatches(normalizedPath: string, regex: RegExp | undefined): boolean {
  if (!regex) return true;
  return regex.test(normalizedPath);
}

function pushLineFinding(
  findings: RawFinding[],
  ctx: PatternContext,
  opts: {
    pattern: RawFinding["pattern"];
    name: string;
    confidence: number;
    lineIndex: number;
    lineText: string;
    properties?: Record<string, unknown>;
  },
): void {
  findings.push({
    pattern: opts.pattern,
    name: opts.name,
    confidence: opts.confidence,
    location: {
      filePath: ctx.file.path,
      startLine: opts.lineIndex + 1,
      endLine: opts.lineIndex + 1,
      code: opts.lineText.trim(),
    },
    properties: { ...(opts.properties ?? {}) },
  });
}

export function detectRubyActiveRecordFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const normalizedPath = normalizedPathOf(ctx);
  const ar = config.ruby.activeRecord;
  if (!pathMatches(normalizedPath, ar.filePathRegex)) return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const match = ar.classRegex.exec(text);
    if (!match) continue;

    const className = match[1];
    findings.push({
      pattern: ar.patternId,
      name: className,
      confidence: ar.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: i + 1,
        endLine: i + 1,
        code: text.trim(),
      },
      properties: {
        client: className,
        framework: "rails",
        modelKind: "active_record",
      },
    });
  }

  return findings;
}

export function detectRubyDatabaseYmlPatterns(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  return detectRubyDatabaseYmlFromConfig(ctx, config);
}

export function detectRubyDatabaseYmlFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  const normalizedPath = normalizedPathOf(ctx);
  const dbYml = config.ruby.databaseYml;
  if (!pathMatches(normalizedPath, dbYml.filePathRegex)) return [];

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];
  let currentDatabaseName: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const dbNameMatch = dbYml.databaseNameRegex.exec(text);
    if (dbNameMatch) {
      currentDatabaseName = dbNameMatch[1];
    }

    const adapterMatch = dbYml.adapterRegex.exec(text);
    if (!adapterMatch) continue;

    const adapter = adapterMatch[1].toLowerCase();
    const databaseType = dbYml.drivers[adapter] ?? "sql";

    let databaseName = currentDatabaseName;
    if (!databaseName) {
      for (let j = Math.max(0, i - 6); j < i; j += 1) {
        const prior = dbYml.databaseNameRegex.exec(lines[j]);
        if (prior) databaseName = prior[1];
      }
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        const next = dbYml.databaseNameRegex.exec(lines[j]);
        if (next) {
          databaseName = next[1];
          break;
        }
      }
    }

    findings.push({
      pattern: dbYml.patternId,
      name: databaseName ?? adapter,
      confidence: dbYml.confidence,
      location: {
        filePath: ctx.file.path,
        startLine: i + 1,
        endLine: i + 1,
        code: text.trim(),
      },
      properties: {
        client: databaseName ?? adapter,
        databaseType,
        adapter,
        framework: "rails",
      },
    });
  }

  return findings;
}

export function detectRubyRoutesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const normalizedPath = normalizedPathOf(ctx);
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const fw of config.ruby.routes.frameworks) {
    if (!pathMatches(normalizedPath, fw.filePathRegex)) continue;

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

        const name = method
          ? `${method} ${routePath ?? ""}`.trim()
          : `${fw.id.toUpperCase()}_ROUTE ${routePath ?? ""}`.trim();

        pushLineFinding(findings, ctx, {
          pattern: fw.patternId,
          name,
          confidence: fw.confidence,
          lineIndex: i,
          lineText: text,
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

export function detectRubyAuthFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const normalizedPath = normalizedPathOf(ctx);
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const lib of config.ruby.auth.libraries) {
    if (lib.filePathRegex && !pathMatches(normalizedPath, lib.filePathRegex)) {
      continue;
    }

    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      const matchedRegex = lib.contentRegexes.find((regex) => regex.test(text));
      if (!matchedRegex) continue;

      pushLineFinding(findings, ctx, {
        pattern: lib.patternId,
        name: lib.id,
        confidence: lib.confidence,
        lineIndex: i,
        lineText: text,
        properties: {
          framework: "rails",
          ...(lib.strategy ? { strategy: lib.strategy } : {}),
        },
      });
    }
  }

  return findings;
}

export function detectRubyCacheFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const normalizedPath = normalizedPathOf(ctx);
  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const client of config.ruby.cache.clients) {
    if (client.filePathRegex && !pathMatches(normalizedPath, client.filePathRegex)) {
      continue;
    }

    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      const matchedRegex = client.contentRegexes.find((regex) => regex.test(text));
      if (!matchedRegex) continue;

      pushLineFinding(findings, ctx, {
        pattern: client.patternId,
        name: client.id,
        confidence: client.confidence,
        lineIndex: i,
        lineText: text,
        properties: {
          client: "redis",
          databaseType: client.databaseType,
          framework: "rails",
          ...(client.componentSubType
            ? { componentSubType: client.componentSubType }
            : {}),
        },
      });
    }
  }

  return findings;
}

export function detectRubyServicesFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  const normalizedPath = normalizedPathOf(ctx);
  if (!pathMatches(normalizedPath, /(?:^|\/)app\/(?:services|models\/concerns)\//)) {
    // Individual service rules also have filePathRegex; still allow rule-level gates.
  }

  const lines = sourceOf(ctx).split(/\r?\n/);
  const findings: RawFinding[] = [];

  for (const svc of config.ruby.services) {
    if (!pathMatches(normalizedPath, svc.filePathRegex)) continue;

    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      const match = svc.classRegex.exec(text);
      if (!match) continue;

      const className = match[1];
      pushLineFinding(findings, ctx, {
        pattern: svc.patternId,
        name: className,
        confidence: svc.confidence,
        lineIndex: i,
        lineText: text,
        properties: {
          framework: "rails",
          ...(svc.componentSubType
            ? { componentSubType: svc.componentSubType }
            : {}),
        },
      });
    }
  }

  return findings;
}

export function detectRubyDatabaseConnectionsFromConfig(
  ctx: PatternContext,
  config: UnifiedPatternConfig,
): RawFinding[] {
  if (ctx.language !== "ruby") return [];

  return [
    ...detectRubyActiveRecordFromConfig(ctx, config),
    ...detectRubyCacheFromConfig(ctx, config),
  ];
}
