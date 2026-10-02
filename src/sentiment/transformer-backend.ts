import os from "os";
import path from "path";
import { DEFAULT_EXCLUSION_THRESHOLDS, stripExcludedRegions } from "./exclusions";
import type { ExclusionThresholds } from "./exclusions";
import { labelForCompound } from "./sentiment-classifier";
import type { AsyncSentimentBackend, SentimentScore } from "./sentiment-classifier";

/**
 * Small local ONNX sentiment model (SST-2 distilbert, quantized). Downloaded
 * once and cached under the cache dir; every later run is fully offline.
 */
export const DEFAULT_TRANSFORMER_MODEL = "Xenova/distilbert-base-uncased-finetuned-sst-2-english";

/** Override the on-disk model cache with SENTIMENT_MODEL_CACHE_DIR if set. */
export function defaultTransformerCacheDir(): string {
  return (
    process.env.SENTIMENT_MODEL_CACHE_DIR ||
    path.join(os.homedir(), ".cache", "dataparade", "sentiment-models")
  );
}

export interface TransformerBackendOptions {
  model?: string;
  cacheDir?: string;
  thresholds?: ExclusionThresholds;
}

function neutralScore(): SentimentScore {
  return { compound: 0, neg: 0, neu: 1, pos: 0, label: "neu" };
}

/**
 * Local Transformers.js backend. Unlike the VADER lexicon backend it gets no
 * token neutralization: the coding-domain overrides are a lexicon mechanism,
 * and how the transformer reads the same technical vocabulary is exactly
 * what the backend comparison (KDATAP-2ca1f0) measures.
 */
export async function createTransformerBackend(
  options: TransformerBackendOptions = {},
): Promise<AsyncSentimentBackend> {
  const model = options.model ?? DEFAULT_TRANSFORMER_MODEL;
  const cacheDir = options.cacheDir ?? defaultTransformerCacheDir();
  const thresholds = options.thresholds ?? DEFAULT_EXCLUSION_THRESHOLDS;
  // Dynamic import keeps @huggingface/transformers (an optional dependency)
  // out of every default code path.
  const transformers = await import("@huggingface/transformers");
  transformers.env.cacheDir = cacheDir;
  const pipe = await transformers.pipeline("sentiment-analysis", model, { dtype: "q8" });
  return {
    name: "transformer",
    async scoreMessage(text: string): Promise<SentimentScore | null> {
      const stripped = stripExcludedRegions(text, thresholds);
      if (stripped.trim() === "" && text.trim() !== "") return null;
      if (stripped.trim() === "") return neutralScore();
      const output = (await pipe(stripped)) as { label: string; score: number }[];
      const first = output[0];
      // Binary SST-2 head: confidence in [0,1] mapped onto [-1,+1].
      const compound = first.label === "POSITIVE" ? first.score : -first.score;
      return {
        compound,
        neg: first.label === "POSITIVE" ? 0 : first.score,
        neu: 0,
        pos: first.label === "POSITIVE" ? first.score : 0,
        label: labelForCompound(compound),
      };
    },
  };
}