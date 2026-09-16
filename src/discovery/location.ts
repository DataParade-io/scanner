import type { SourceLocation } from "../core/types/file";

export function formatSourceLocation(location: SourceLocation): string {
  const filePath = location.filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  return `${filePath}:${location.startLine}-${location.endLine}`;
}

export function formatPatternEvidenceRef(pattern: string, location?: SourceLocation): string {
  if (location) {
    return `pattern:${pattern}@${formatSourceLocation(location)}`;
  }
  return `pattern:${pattern}`;
}

export function firstEvidenceRef(
  pattern: string | undefined,
  locations: SourceLocation[],
): string {
  if (locations.length > 0) {
    return `scan:${formatSourceLocation(locations[0]!)}`;
  }
  if (pattern) {
    return formatPatternEvidenceRef(pattern);
  }
  return "scan:unknown";
}
