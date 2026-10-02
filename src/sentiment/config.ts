import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

const sentimentConfigSchema = z.object({
  timezone: z.string().min(1).optional(),
  dayStart: z.string().regex(/^[0-9]{1,2}:[0-9]{2}$/).optional(),
  sources: z.array(z.string().min(1)).optional(),
  roots: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
  words: z.string().min(1).optional(),
  sentimentBackend: z.string().min(1).optional(),
  sentimentCodingFilter: z.enum(["on", "off", "auto"]).optional(),
  bands: z
    .object({
      mostlyGratefulAt: z.number().min(0).max(1),
      mixedAt: z.number().min(0).max(1),
    })
    .optional(),
});

export type SentimentConfig = z.infer<typeof sentimentConfigSchema>;

export function sentimentConfigPath(homeDir?: string): string {
  const home = homeDir ?? process.env.HOME ?? "";
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "dataparade", "sentiment.meter.yaml");
}
/** A missing config file means pure defaults. */
export function loadSentimentConfig(homeDir?: string): SentimentConfig {
  const configPath = sentimentConfigPath(homeDir);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = YAML.parse(raw);
    return sentimentConfigSchema.parse(parsed ?? {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export function resolveWithConfig<T extends Record<string, unknown>>(
  flagValues: Partial<Record<keyof SentimentConfig | "window" | "since" | "until" | "cacheDir" | "doctor" | "json", unknown>>,
  config: SentimentConfig,
  defaults: SentimentConfig,
): T {
  const merged = { ...defaults, ...config, ...flagValues } as T;
  return merged;
}
