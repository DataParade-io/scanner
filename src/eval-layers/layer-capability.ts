/** Evaluation layer ids shared between production emit and harness. */
export type EvalLayerId =
  | "components"
  | "data-flows"
  | "raw-hits"
  | "data-items"
  | "mentions"
  | "data-actions";

import type { FileLanguage } from "../core/types/file";

/** Languages the orchestrator structural pipeline can layer-process (analyzer or TF detector). */
const ORCHESTRATOR_LAYER_LANGUAGES = new Set<FileLanguage>([
  "typescript",
  "javascript",
  "python",
  "cpp",
  "csharp",
  "go",
  "php",
  "java",
  "kotlin",
  "terraform",
]);

/** Languages personal-data (PII) layers can layer-process after ingest. */
const PERSONAL_DATA_LAYER_LANGUAGES = new Set<FileLanguage>([
  "typescript",
  "javascript",
  "python",
  "cpp",
  "csharp",
  "go",
  "php",
  "java",
  "kotlin",
  "terraform",
  "json",
  "yaml",
  "env",
  "rust",
]);

export function isOrchestratorLayerLanguage(language: FileLanguage): boolean {
  return ORCHESTRATOR_LAYER_LANGUAGES.has(language);
}

export function isPersonalDataLayerLanguage(language: FileLanguage): boolean {
  return PERSONAL_DATA_LAYER_LANGUAGES.has(language);
}

export function isLanguageSupportedForEvalLayer(
  layer: EvalLayerId,
  language: FileLanguage,
): boolean {
  switch (layer) {
    case "components":
    case "data-flows":
    case "data-actions":
      return isOrchestratorLayerLanguage(language);
    case "mentions":
    case "raw-hits":
    case "data-items":
      return isPersonalDataLayerLanguage(language);
    default:
      return false;
  }
}

export function orchestratorEvalLayers(): EvalLayerId[] {
  return ["components", "data-flows"];
}

export function personalDataEvalLayers(): EvalLayerId[] {
  return ["mentions", "raw-hits", "data-items"];
}
