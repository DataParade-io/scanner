import { z } from "zod";

export const SENTIMENT_SOURCES = [
  "claude-code",
  "cursor-ide",
  "cursor-agent",
  "codex",
  "grok-bot",
  "antigravity",
] as const;

export type SentimentSource = (typeof SENTIMENT_SOURCES)[number];

/**
 * Shared normalized record emitted by every sentiment adapter.
 * `text` carries the human-authored message text only while records are in
 * flight; it must never be persisted to scan state or echoed in output.
 */
export const humanMessageRecordSchema = z.object({
  source: z.enum(SENTIMENT_SOURCES),
  sessionId: z.string().min(1),
  recordId: z.string().min(1),
  projectPath: z.string().min(1),
  timestamp: z.string().refine(isRfc3339Utc, {
    message: "timestamp must be RFC 3339 UTC (Z)",
  }),
  role: z.literal("human"),
  text: z.string(),
  dedupKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "dedupKey must be a sha256 hex digest"),
  provenance: z.object({
    file: z.string(),
    line: z.number().int().nonnegative(),
    key: z.string(),
  }),
});

export type HumanMessageRecord = z.infer<typeof humanMessageRecordSchema>;

export function isRfc3339Utc(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/.test(
    value,
  );
}

export function normalizeTimestampToRfc3339Utc(
  value: string | number | Date,
): string {
  const date = parseTimestampToDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`unparseable timestamp: ${String(value)}`);
  }
  const iso = date.toISOString();
  return iso.replace(/\.000Z$/, "Z");
}

/**
 * Normalize the three native timestamp representations seen across sources:
 * ISO-8601 with Z (Claude Code), Unix epoch milliseconds (Cursor), and
 * RFC 3339 with milliseconds (Codex).
 */
export function parseTimestampToDate(
  value: string | number | Date,
): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  if (/^-?[0-9]+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    // 13-digit values are epoch milliseconds; 10-digit values epoch seconds.
    return new Date(
      trimmed.length >= 13 ? numeric : trimmed.length === 10 ? numeric * 1000 : numeric,
    );
  }
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$/.test(trimmed)) {
    const normalized = trimmed.replace(" ", "T").replace(/([+-][0-9]{2})([0-9]{2})$/, "$1:$2");
    const date = normalized.endsWith("Z") || /[+-][0-9]{2}:[0-9]{2}$/.test(normalized)
      ? new Date(normalized)
      : new Date(`${normalized}Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const fallback = new Date(trimmed);
  return fallback;
}
