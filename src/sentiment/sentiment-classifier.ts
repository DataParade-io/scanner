import { DEFAULT_EXCLUSION_THRESHOLDS, stripExcludedRegions } from "./exclusions";
import type { ExclusionThresholds } from "./exclusions";
import { SentimentIntensityAnalyzer } from "vader-sentiment";

export type SentimentLabel = "pos" | "neu" | "neg";

export interface SentimentScore {
  /** Compound score in [-1, +1]: normalized sum of token valences. */
  compound: number;
  /** Proportion of scored tokens that are negative (0..1). */
  neg: number;
  /** Proportion of tokens that are neutral (0..1). */
  neu: number;
  /** Proportion of tokens that are positive (0..1). */
  pos: number;
  label: SentimentLabel;
}

export interface SentimentBackend {
  /** Stable identifier used in reports and CLI flags. */
  readonly name: string;
  /**
   * Score the raw message text on the same code/quote/paste-stripped view the
   * counter uses. Returns null when the message is entirely excluded.
   */
  scoreMessage(text: string): SentimentScore | null;
}

/**
 * Standard VADER convention: |compound| >= 0.05 is decisive, in between is
 * neutral.
 */
export const SENTIMENT_LABEL_THRESHOLDS = { posAt: 0.05, negAt: -0.05 } as const;

export function labelForCompound(compound: number): SentimentLabel {
  if (compound >= SENTIMENT_LABEL_THRESHOLDS.posAt) return "pos";
  if (compound <= SENTIMENT_LABEL_THRESHOLDS.negAt) return "neg";
  return "neu";
}

/**
 * Terms that are negative in general English but neutral in coding sessions,
 * where they describe program behavior rather than the assistant's work or
 * the operator's mood. Each entry is neutralized (valence forced to 0) before
 * scoring, applied on word boundaries so inflections need separate entries.
 * Emotionally loaded words (sucks, terrible, hate, ...) are deliberately NOT
 * listed: "this crash sucks" stays negative via "sucks".
 *
 * KDATAP-40977f: verified that replacing an override token with a
 * zero-valence placeholder is numerically identical to removing it from the
 * VADER lexicon (the compound depends only on the valence sum).
 */
export const CODING_DOMAIN_OVERRIDES: readonly string[] = [
  // Crashing / killing processes
  "kill", "kills", "killed", "killer", "killing",
  "crash", "crashes", "crashed", "crashing",
  "abort", "aborts", "aborted", "aborting",
  "panic", "panics", "panicked",
  // Errors and failures as technical nouns/verbs
  "error", "errors", "erroring",
  "fail", "fails", "failed", "failing", "failure", "failures",
  "bug", "bugs", "buggy",
  "exception", "exceptions",
  "throw", "throws", "threw", "thrown",
  "fatal", "invalid", "undefined", "deprecated",
  "warning", "warnings",
  // Resource and state jargon
  "leak", "leaks", "leaked",
  "dead", "missing", "blocked", "block", "blocks", "blocking",
  "regression", "regressions",
  "conflict", "conflicts",
  "hack", "hacked", "hacking",
  // State adjectives that dominate technical phrasing ("empty input")
  "empty",
];

function escapeRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Neutralize coding-domain terms in text before scoring: each override word
 * is replaced on word boundaries with a placeholder that has zero valence in
 * the VADER lexicon ("zz"), leaving surrounding negation/intensifier
 * structure intact.
 */
export function neutralizeCodingTerms(text: string): string {
  let out = text;
  for (const term of CODING_DOMAIN_OVERRIDES) {
    out = out.replace(
      new RegExp(`(?<![a-z0-9])${escapeRegex(term)}(?![a-z0-9])`, "gi"),
      "zz",
    );
  }
  return out;
}

export interface VaderBackendOptions {
  thresholds?: ExclusionThresholds;
}

/** Offline VADER backend: per-message compound score, no network, no model download. */
export function createVaderBackend(options: VaderBackendOptions = {}): SentimentBackend {
  const thresholds = options.thresholds ?? DEFAULT_EXCLUSION_THRESHOLDS;
  return {
    name: "vader",
    scoreMessage(text: string): SentimentScore | null {
      const stripped = stripExcludedRegions(text, thresholds);
      if (stripped.trim() === "" && text.trim() !== "") return null;
      const scores = SentimentIntensityAnalyzer.polarity_scores(
        neutralizeCodingTerms(stripped),
      );
      return {
        compound: scores.compound,
        neg: scores.neg,
        neu: scores.neu,
        pos: scores.pos,
        label: labelForCompound(scores.compound),
      };
    },
  };
}

/** Registry of locally available backends; "vader" is the default. */
export function createSentimentBackend(name: string | undefined): SentimentBackend {
  const backend = name ?? "vader";
  if (backend === "vader") return createVaderBackend();
  throw new Error(`unknown sentiment backend: ${backend}`);
}