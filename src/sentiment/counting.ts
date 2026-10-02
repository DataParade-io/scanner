import { DEFAULT_EXCLUSION_THRESHOLDS, stripExcludedRegions } from "./exclusions";
import type { ExclusionThresholds } from "./exclusions";
import type { SentimentWordList } from "./word-lists";

export const SENTIMENT_FAMILIES = ["gratitude", "fbomb"] as const;
export type SentimentFamily = (typeof SENTIMENT_FAMILIES)[number];

export interface FamilyCount {
  /** Every occurrence of any token in the family. */
  tokenCount: number;
  /** Messages contributing at least one occurrence. */
  messageCount: number;
  /** Occurrences per token (ordered by first appearance). */
  tokens: Record<string, number>;
}

export interface MessageCountResult {
  families: Record<SentimentFamily, FamilyCount>;
  /** Message classified into at least one family. */
  classified: boolean;
  /** True when the entire message was stripped (code, quote, paste). */
  excluded: boolean;
}

export interface CountingOptions {
  thresholds?: ExclusionThresholds;
}

function emptyFamilyCount(): FamilyCount {
  return { tokenCount: 0, messageCount: 0, tokens: {} };
}

function normalizeUnicode(text: string): string {
  return text
    .replace(/[‘’‚‹›«»]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—―‒]/g, "-")
    .replace(/[‐‑]/g, "-")
    .toLowerCase();
}

function escapeRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenPattern(token: string): RegExp {
  const escaped = escapeRegex(normalizeUnicode(token));
  // Space-separated tokens match as a phrase; single tokens match on
  // word boundaries.
  const body = escaped.includes("\\ ")
      ? escaped.split("\\ ").join("\\s+")
      : escaped;
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "g");
}

function isFollowedByPath(text: string, matchEnd: number): boolean {
  const rest = text.slice(matchEnd, matchEnd + 2);
  return rest.startsWith("/") || rest.startsWith(".")
    ? /[a-z0-9]/i.test(text.slice(matchEnd, matchEnd + 3).slice(1))
    : false;
}

/** Path/URL guard: a token immediately followed by a path separator or file extension does not count. */
export function hasPathLikeSuffix(text: string, matchEnd: number): boolean {
  const after = text.slice(matchEnd);
  if (after.startsWith("/") && /^[a-z0-9_-]/i.test(after.slice(1))) return true;
  const extension = /^\.(js|ts|py|json|yaml|yml|md|txt|sh|rs|go|java|rb|css|html|toml|lock)/i.exec(after);
  return extension !== null;
}

export function countMessage(
  text: string,
  wordList: SentimentWordList,
  options: CountingOptions = {},
): MessageCountResult {
  const families = {
    gratitude: emptyFamilyCount(),
    fbomb: emptyFamilyCount(),
  } as Record<SentimentFamily, FamilyCount>;
  const stripped = stripExcludedRegions(text, options.thresholds ?? DEFAULT_EXCLUSION_THRESHOLDS);
  if (stripped.trim() === "" && text.trim() !== "") {
    return { families, classified: false, excluded: true };
  }
  const normalized = normalizeUnicode(stripped);
  let classified = false;
  for (const family of SENTIMENT_FAMILIES) {
    const config = wordList.families[family];
    if (!config) continue;
    for (const token of config.tokens) {
      const pattern = tokenPattern(token);
      let match: RegExpExecArray | null;
      let occurrences = 0;
      while ((match = pattern.exec(normalized)) !== null) {
        if (hasPathLikeSuffix(normalized, match.index + match[0].length)) continue;
        occurrences += 1;
      }
      if (occurrences > 0) {
        families[family].tokens[token] = occurrences;
        families[family].tokenCount += occurrences;
      }
    }
    if (families[family].tokenCount > 0) {
      families[family].messageCount = 1;
      classified = true;
    }
  }
  return { families, classified, excluded: false };
}
