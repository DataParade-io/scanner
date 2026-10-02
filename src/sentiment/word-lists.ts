import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

const wordListSchema = z.object({
  version: z.number().int().nonnegative(),
  families: z.record(
    z.string().min(1),
    z.object({
      tokens: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export type SentimentWordList = z.infer<typeof wordListSchema>;

export type SentimentFamilyName = keyof typeof DEFAULT_FAMILY_ORDER;

const DEFAULT_FAMILY_ORDER = { gratitude: true, fbomb: true } as const;

let cachedList: SentimentWordList | undefined;

export function clearSentimentWordListCacheForTest(): void {
  cachedList = undefined;
}

function getSentimentWordsPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const cliRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(cliRoot, "patterns", "sentiment-words.yaml");
}

export function loadSentimentWordList(configPath?: string): SentimentWordList {
  if (cachedList && !configPath) return cachedList;
  const resolvedPath = configPath ?? getSentimentWordsPath();

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Sentiment word list is required but could not be read from '${resolvedPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Sentiment word list at '${resolvedPath}' could not be parsed as YAML: ${message}`,
    );
  }

  const normalized = wordListSchema.parse(parsed);
  for (const family of Object.keys(DEFAULT_FAMILY_ORDER)) {
    if (!(family in normalized.families)) {
      throw new Error(`Sentiment word list is missing the '${family}' family`);
    }
  }
  if (!configPath) cachedList = normalized;
  return normalized;
}
