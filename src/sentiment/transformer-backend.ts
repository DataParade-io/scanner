import os from "os";
import path from "path";
import { DEFAULT_EXCLUSION_THRESHOLDS, stripExcludedRegions } from "./exclusions";
import type { ExclusionThresholds } from "./exclusions";
import { labelForCompound } from "./sentiment-classifier";
import type { AsyncSentimentBackend, SentimentScore } from "./sentiment-classifier";

/** Override the on-disk model cache with SENTIMENT_MODEL_CACHE_DIR if set. */
export function defaultTransformerCacheDir(): string {
  return (
    process.env.SENTIMENT_MODEL_CACHE_DIR ||
    path.join(os.homedir(), ".cache", "dataparade", "sentiment-models")
  );
}

export interface TransformerModelSpec {
  /** Backend name used by --sentiment-backend. */
  name: string;
  /** Hugging Face repo id with an onnx/ folder (transformers.js layout). */
  repo: string;
  /** ONNX dtype to load (maps to the exported variant in the repo). */
  dtype: string;
  /** Output-label semantics of the model head. */
  head: "binary" | "softmax3" | "emotions";
  /** Model output label names, by head kind. */
  labels: string[];
}

/**
 * Small local ONNX sentiment/text-classification models, all cached on disk
 * after their one-time download and fully offline afterwards.
 *
 * "transformer" is the default ML backend: the KDATAP-55f716 comparison
 * picked the go_emotions classifier mapped onto pos/neu/neg (best held-out
 * accuracy and VADER agreement; never mislabels neutral as emotional).
 * KDATAP-cc07d6's Cardiff 3-class head stays available as
 * "transformer-cardiff"; the binary SST-2 baseline is kept for comparison.
 */
export const TRANSFORMER_MODELS: Record<string, TransformerModelSpec> = {
  // Winner of the KDATAP-e11340/55f716 comparison: 28-emotion head mapped to
  // pos/neu/neg via GO_EMOTIONS_* sets.
  transformer: {
    name: "transformer",
    repo: "SamLowe/roberta-base-go_emotions-onnx",
    dtype: "q8",
    head: "emotions",
    labels: [
      "admiration", "amusement", "anger", "annoyance", "approval", "caring",
      "confusion", "curiosity", "desire", "disappointment", "disapproval",
      "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief",
      "joy", "love", "nervousness", "optimism", "pride", "realization",
      "relief", "remorse", "sadness", "surprise", "neutral",
    ],
  },
  // KDATAP-cc07d6: 3-class Cardiff head with a real neutral class.
  "transformer-cardiff": {
    name: "transformer-cardiff",
    repo: "Xenova/twitter-roberta-base-sentiment-latest",
    dtype: "q8",
    head: "softmax3",
    labels: ["negative", "neutral", "positive"],
  },
  // KDATAP-e11340 candidates:
  "transformer-xlmr": {
    name: "transformer-xlmr",
    repo: "onnx-community/twitter-xlm-roberta-base-sentiment-ONNX",
    dtype: "q8",
    head: "softmax3",
    labels: ["negative", "neutral", "positive"],
  },
  // KDATAP-2ca1f0 baseline: binary SST-2 head, kept for comparison only.
  "transformer-sst2": {
    name: "transformer-sst2",
    repo: "Xenova/distilbert-base-uncased-finetuned-sst-2-english",
    dtype: "q8",
    head: "binary",
    labels: ["NEGATIVE", "POSITIVE"],
  },
};

export const DEFAULT_TRANSFORMER_MODEL = TRANSFORMER_MODELS.transformer.repo;

/**
 * Documented mapping of the 28 go_emotions labels onto pos/neu/neg:
 * emotional-valence groups; cognitive/ambiguous emotions (confusion,
 * curiosity, realization, surprise) count as neutral.
 */
export const GO_EMOTIONS_POSITIVE = new Set([
  "admiration", "amusement", "approval", "caring", "desire", "excitement",
  "gratitude", "joy", "love", "optimism", "pride", "relief",
]);
export const GO_EMOTIONS_NEGATIVE = new Set([
  "anger", "annoyance", "disappointment", "disapproval", "disgust",
  "embarrassment", "fear", "grief", "nervousness", "remorse", "sadness",
]);

export interface TransformerBackendOptions {
  /** Registry name (see TRANSFORMER_MODELS) or a raw HF repo id (binary head). */
  model?: string;
  cacheDir?: string;
  thresholds?: ExclusionThresholds;
}

function neutralScore(): SentimentScore {
  return { compound: 0, neg: 0, neu: 1, pos: 0, label: "neu" };
}

/**
 * RoBERTa-head ONNX graphs fail past 512 tokens, and some repos leave
 * model_max_length unset (so pipeline-level truncation never kicks in).
 * Clamp the input before scoring; a ~1200-char prefix stays well under the
 * token limit for every candidate model.
 */
const MAX_SCORED_CHARS = 1200;

function scoreFromSoftmax3(
  probs: { negative: number; neutral: number; positive: number },
): SentimentScore {
  const compound = probs.positive - probs.negative;
  const label =
    probs.positive >= probs.neutral && probs.positive >= probs.negative
      ? "pos"
      : probs.negative >= probs.neutral
        ? "neg"
        : "neu";
  return { compound, neg: probs.negative, neu: probs.neutral, pos: probs.positive, label };
}

function scoreFromEmotions(scores: Record<string, number>): SentimentScore {
  let pos = 0;
  let neg = 0;
  for (const [emotion, score] of Object.entries(scores)) {
    if (GO_EMOTIONS_POSITIVE.has(emotion)) pos += score;
    else if (GO_EMOTIONS_NEGATIVE.has(emotion)) neg += score;
  }
  const compound = Math.max(-1, Math.min(1, pos - neg));
  const neu = scores["neutral"] ?? 0;
  const label =
    pos >= neu && pos >= neg ? "pos" : neg >= neu ? "neg" : "neu";
  return { compound, neg, neu, pos, label };
}

function scoreFromBinary(label: string, score: number): SentimentScore {
  const positive = label === "POSITIVE" || label === "positive";
  const compound = positive ? score : -score;
  return {
    compound,
    neg: positive ? 0 : score,
    neu: 0,
    pos: positive ? score : 0,
    label: labelForCompound(compound),
  };
}

/**
 * Local Transformers.js backend. Unlike the VADER lexicon backend it gets no
 * token neutralization: the coding-domain overrides are a lexicon mechanism,
 * and how each model reads the same technical vocabulary is exactly what the
 * backend comparison (KDATAP-2ca1f0, KDATAP-e11340) measures.
 */
export async function createTransformerBackend(
  options: TransformerBackendOptions = {},
): Promise<AsyncSentimentBackend> {
  const spec = TRANSFORMER_MODELS[options.model ?? "transformer"] ??
    (options.model
      ? undefined
      : TRANSFORMER_MODELS.transformer);
  if (!spec) {
    // Raw repo ids keep the old escape hatch (binary head).
    const rawSpec: TransformerModelSpec = {
      name: "transformer",
      repo: options.model!,
      dtype: "q8",
      head: "binary",
      labels: ["NEGATIVE", "POSITIVE"],
    };
    return buildBackend(rawSpec, options);
  }
  return buildBackend(spec, options);
}

async function buildBackend(
  spec: TransformerModelSpec,
  options: TransformerBackendOptions,
): Promise<AsyncSentimentBackend> {
  const cacheDir = options.cacheDir ?? defaultTransformerCacheDir();
  const thresholds = options.thresholds ?? DEFAULT_EXCLUSION_THRESHOLDS;
  // Dynamic import keeps @huggingface/transformers (an optional dependency)
  // out of every default code path. Tokenizer and model are driven directly
  // (not via pipeline) so token-level truncation can be enforced: RoBERTa
  // position-embedding ONNX graphs fail past 512 tokens and some repos leave
  // model_max_length unset.
  const transformers = await import("@huggingface/transformers");
  transformers.env.cacheDir = cacheDir;
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(spec.repo);
  const model = await transformers.AutoModelForSequenceClassification.from_pretrained(
    spec.repo,
    { dtype: spec.dtype as "q8" },
  );
  const config = (model as unknown as { config: { id2label: Record<string, string>; problem_type?: string } }).config;
  const id2label = config.id2label;
  const multiLabel = config.problem_type === "multi_label_classification";

  function probsFromLogits(logits: number[]): Record<string, number> {
    if (multiLabel) {
      const out: Record<string, number> = {};
      logits.forEach((logit, index) => {
        out[id2label[index] ?? `LABEL_${index}`] = 1 / (1 + Math.exp(-logit));
      });
      return out;
    }
    const max = Math.max(...logits);
    const exps = logits.map((logit) => Math.exp(logit - max));
    const sum = exps.reduce((total, value) => total + value, 0);
    const out: Record<string, number> = {};
    exps.forEach((value, index) => {
      out[id2label[index] ?? `LABEL_${index}`] = value / sum;
    });
    return out;
  }

  return {
    name: spec.name,
    async scoreMessage(text: string): Promise<SentimentScore | null> {
      const stripped = stripExcludedRegions(text, thresholds);
      if (stripped.trim() === "" && text.trim() !== "") return null;
      if (stripped.trim() === "") return neutralScore();
      const input = stripped.length > MAX_SCORED_CHARS ? stripped.slice(0, MAX_SCORED_CHARS) : stripped;
      const inputs = tokenizer(input, { truncation: true, max_length: 512 });
      const output = await model(inputs);
      const logits = (output as unknown as { logits: { tolist(): number[][] } }).logits.tolist()[0];
      const probs = probsFromLogits(logits);
      if (spec.head === "emotions") {
        return scoreFromEmotions(probs);
      }
      if (spec.head === "softmax3") {
        return scoreFromSoftmax3({
          negative: probs["negative"] ?? 0,
          neutral: probs["neutral"] ?? 0,
          positive: probs["positive"] ?? 0,
        });
      }
      return scoreFromBinary(probs["POSITIVE"] !== undefined ? "POSITIVE" : "positive", probs["POSITIVE"] ?? probs["positive"] ?? 0);
    },
  };
}