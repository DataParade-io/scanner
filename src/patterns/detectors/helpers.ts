import type { FileInfo, SourceLocation } from "../../core/types/file";
import type { ImportLike, PatternContext } from "../engine";
import type { UnifiedPatternConfig } from "../config";

/** 1-based inclusive span for an import. Missing or invalid lines fall back to 1. */
export function evidenceLineRange(imp: ImportLike): {
  startLine: number;
  endLine: number;
} {
  const startLine =
    typeof imp.startLine === "number" &&
    Number.isInteger(imp.startLine) &&
    imp.startLine >= 1
      ? imp.startLine
      : 1;
  const endLine =
    typeof imp.endLine === "number" &&
    Number.isInteger(imp.endLine) &&
    imp.endLine >= startLine
      ? imp.endLine
      : startLine;
  return { startLine, endLine };
}

/** Keep the first location for each start:end span. Identical spans collapse; different lines do not. */
export function dedupeLocations(
  locations: readonly SourceLocation[],
): SourceLocation[] {
  const seen = new Set<string>();
  const deduped: SourceLocation[] = [];
  for (const location of locations) {
    const key = `${location.startLine}:${location.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(location);
  }
  return deduped;
}

export function locationsForMatchingImports(
  file: FileInfo,
  imports: readonly ImportLike[] | undefined,
  predicate: (imp: ImportLike) => boolean,
): SourceLocation[] {
  const locations: SourceLocation[] = [];
  for (const imp of imports ?? []) {
    if (!predicate(imp)) continue;
    const span = evidenceLineRange(imp);
    locations.push({
      filePath: file.path,
      startLine: span.startLine,
      endLine: span.endLine,
    });
  }
  return dedupeLocations(locations);
}

export function locationsForContentRegexes(
  file: FileInfo,
  content: string,
  regexes: readonly RegExp[],
): SourceLocation[] {
  const locations: SourceLocation[] = [];
  for (const regex of regexes) {
    for (const { line, match } of findLineMatches(content, regex)) {
      locations.push(createLocationFromLine(file, line, match[0]));
    }
  }
  return dedupeLocations(locations);
}

export function locationsForSubstrings(
  file: FileInfo,
  content: string,
  needles: readonly string[],
): SourceLocation[] {
  const usable = needles.filter((needle) => needle.length > 0);
  if (usable.length === 0) return [];
  const pattern = usable
    .map((needle) => needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return locationsForContentRegexes(file, content, [new RegExp(pattern)]);
}

/**
 * Evidence spans when any were found. Line 1 is only the fallback for a
 * signal that has no statement to cite.
 */
export function spansOrFileStart(
  file: FileInfo,
  locations: readonly SourceLocation[],
): SourceLocation[] {
  const deduped = dedupeLocations(locations);
  if (deduped.length > 0) return deduped;
  return [createLocationFromLine(file, 1)];
}

/** Prefer comment-stripped source when the analyzer supplies it. */
export function sourceOf(ctx: PatternContext): string {
  return ctx.strippedContent ?? ctx.file.content ?? "";
}

export function createLocationFromLine(
  file: FileInfo,
  line: number,
  code?: string,
): SourceLocation {
  return {
    filePath: file.path,
    startLine: line,
    endLine: line,
    code,
  };
}

export function findLineMatches(
  content: string,
  regex: RegExp,
): { line: number; match: RegExpMatchArray }[] {
  const results: { line: number; match: RegExpMatchArray }[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    const trimmed = lineText.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }
    const match = lineText.match(regex);
    if (match) {
      results.push({
        line: i + 1,
        match,
      });
    }
  }

  return results;
}

export function findFirstLineMatch(
  content: string,
  regex: RegExp | undefined,
): { line: number; code: string } | undefined {
  if (!regex) return undefined;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineText = lines[i];
    if (regex.test(lineText)) {
      return { line: i + 1, code: lineText };
    }
  }
  return undefined;
}

export function buildThirdPartyUrlHostPatterns(
  config: UnifiedPatternConfig,
): {
  pattern: string;
  serviceName: string;
}[] {
  const urlHostPatterns: { pattern: string; serviceName: string }[] = [];
  for (const svc of config.thirdParty.services) {
    for (const pattern of svc.urlHostPatterns) {
      urlHostPatterns.push({ pattern, serviceName: svc.serviceName });
    }
  }
  return urlHostPatterns;
}

export function inferServiceNameFromUrl(
  url: string | undefined,
  urlHostPatterns: { pattern: string; serviceName: string }[],
): string | undefined {
  if (!url || urlHostPatterns.length === 0) return undefined;
  const lower = url.toLowerCase();

  for (const { pattern, serviceName } of urlHostPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return serviceName;
    }
  }
  return undefined;
}

