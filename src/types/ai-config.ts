/** Shared AI-related scan configuration types (CLI applies inference after scan()). */

export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "local",
  "mock",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiInferenceScope = "default" | "third_party_only";
