export interface ExclusionThresholds {
  pasteMinLength: number;
  pasteMinAsciiRatio: number;
  pasteMinNonBlankLines: number;
}

export const DEFAULT_EXCLUSION_THRESHOLDS: ExclusionThresholds = {
  pasteMinLength: 2000,
  pasteMinAsciiRatio: 0.6,
  pasteMinNonBlankLines: 10,
};

/**
 * Strip non-authored regions from a human message before matching:
 * fenced code blocks (backtick and tilde) and indented code blocks,
 * markdown blockquote lines, and pasted regions detected by a configurable
 * length/shape heuristic.
 */
export function stripExcludedRegions(
  text: string,
  thresholds: ExclusionThresholds = DEFAULT_EXCLUSION_THRESHOLDS,
): string {
  const withoutFences = stripFencedCode(text);
  const withoutIndented = stripIndentedCode(withoutFences);
  const withoutQuotes = stripBlockquotes(withoutIndented);
  return isPastedRegion(withoutQuotes, thresholds) ? "" : withoutQuotes;
}

function stripFencedCode(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (line.trim().startsWith(fence)) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[2][0].repeat(3);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function stripIndentedCode(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line, index) => {
    if (!/^( {4}|\t)/.test(line)) return true;
    // A blank line never counts as code; the first line of the message
    // indented is treated as code only when a later line continues it.
    return line.trim() === "" && !lines[index + 1]?.match(/^( {4}|\t)\S/);
  });
  return kept.join("\n");
}

function stripBlockquotes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

export function isPastedRegion(
  text: string,
  thresholds: ExclusionThresholds = DEFAULT_EXCLUSION_THRESHOLDS,
): boolean {
  const normalized = text.trim();
  if (normalized.length < thresholds.pasteMinLength) return false;
  const nonBlankLines = normalized.split("\n").filter((l) => l.trim() !== "").length;
  const asciiChars = [...normalized].filter((c) => c.charCodeAt(0) < 128).length;
  const asciiRatio = asciiChars / normalized.length;
  return (
    asciiRatio >= thresholds.pasteMinAsciiRatio ||
    nonBlankLines >= thresholds.pasteMinNonBlankLines
  );
}
