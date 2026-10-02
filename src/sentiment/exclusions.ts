export interface ExclusionThresholds {
  pasteMinLength: number;
  pasteMinCitationMarkers: number;
}

/**
 * Tuned on the real Mac corpus (KDATAP-713a0f): the only pasted regions
 * observed are web-research answers, whose signature is bracketed citation
 * markers ("[1]", "[2]", ...) in bulk. Earlier shape thresholds (ascii ratio,
 * line count) excluded the operator's own long orchestration briefs, which
 * are genuine sentiment input — 7.8 percent of all Cursor agent messages —
 * so the heuristic now requires both length and citation density. Genuine
 * long briefs in the corpus carry at most 1-2 citation mentions; pastes carry
 * dozens.
 */
export const DEFAULT_EXCLUSION_THRESHOLDS: ExclusionThresholds = {
  pasteMinLength: 4000,
  pasteMinCitationMarkers: 3,
};

/**
 * Strip non-authored regions from a human message before matching:
 * fenced code blocks (backtick and tilde) and indented code blocks,
 * markdown blockquote lines, and pasted regions detected by a configurable
 * length/citation heuristic.
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
  const citationMarkers = (normalized.match(/\[\d+\]/g) ?? []).length;
  return citationMarkers >= thresholds.pasteMinCitationMarkers;
}