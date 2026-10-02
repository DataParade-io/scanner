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

/** Same contract as SentimentBackend, for backends whose inference is async. */
export interface AsyncSentimentBackend {
  readonly name: string;
  scoreMessage(text: string): Promise<SentimentScore | null>;
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
  /**
   * Apply the coding-domain neutralization before scoring (default true —
   * the VADER lexicon needs it; KDATAP-d278a8 quantified this). Setting
   * false scores the raw stripped text.
   */
  codingFilter?: boolean;
}

/** Offline VADER backend: per-message compound score, no network, no model download. */
export function createVaderBackend(options: VaderBackendOptions = {}): SentimentBackend {
  const thresholds = options.thresholds ?? DEFAULT_EXCLUSION_THRESHOLDS;
  const codingFilter = options.codingFilter ?? true;
  return {
    name: "vader",
    scoreMessage(text: string): SentimentScore | null {
      const stripped = stripExcludedRegions(text, thresholds);
      if (stripped.trim() === "" && text.trim() !== "") return null;
      const scores = SentimentIntensityAnalyzer.polarity_scores(
        codingFilter ? neutralizeCodingTerms(stripped) : stripped,
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

/**
 * Shared backend options: `codingFilter` is "auto" by default — each backend
 * applies its documented default (VADER: on, transformer family: off, see
 * the per-backend defaults in the registries). "on"/"off" override the
 * backend default (KDATAP-d278a8/ab09dd).
 */
export interface SentimentBackendOptions {
  codingFilter?: "on" | "off" | "auto";
}

export function codingFilterFor(
  preference: "on" | "off" | "auto" | undefined,
  backendDefault: boolean,
): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return backendDefault;
}

/** Registry of locally available sync backends; "vader" is the default. */
export function createSentimentBackend(name: string | undefined): SentimentBackend {
  const backend = name ?? "vader";
  if (backend === "vader") return createVaderBackend();
  throw new Error(`unknown sentiment backend: ${backend}`);
}

/**
 * Registry including async backends ("transformer", lazily loaded only when
 * selected so the default path never touches the optional dependency).
 * `undefined` selects the default ("vader").
 */
export async function createSentimentBackendAsync(
  name: string | undefined,
  options: SentimentBackendOptions = {},
): Promise<AsyncSentimentBackend> {
  const backend = name ?? "vader";
  if (backend === "vader") {
    const vader = createVaderBackend({ codingFilter: codingFilterFor(options.codingFilter, true) });
    return {
      name: vader.name,
      scoreMessage: async (text) => vader.scoreMessage(text),
    };
  }
  if (backend === "transformer" || backend.startsWith("transformer-")) {
    const mod = await import("./transformer-backend");
    return mod.createTransformerBackend({ model: backend, codingFilter: options.codingFilter });
  }
  throw new Error(`unknown sentiment backend: ${backend}`);
}