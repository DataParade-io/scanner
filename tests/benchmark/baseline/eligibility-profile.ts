import type { FileLanguage } from "../../../src/core/types/file";
import {
  isOrchestratorLayerLanguage,
  isPersonalDataLayerLanguage,
  type EvalLayerId,
} from "../../../src/eval-layers/layer-capability";
import {
  DEFAULT_EXCLUDED_DIRS,
  DEFAULT_EXCLUDED_FILE_GLOBS,
} from "../../../src/patterns/scan-exclusions";
import {
  DEFAULT_MAX_FILE_COUNT,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
} from "../../../src/ingest/file-system";
import { HEADLINE_LAYERS, type HeadlineLayer } from "../../eval/score";
import { digestStableJson } from "./digests";
import type { EligibilityProfileFingerprint, LayerEligibilityProfileSummary } from "./types";

const FILE_LANGUAGES: FileLanguage[] = [
  "typescript",
  "javascript",
  "json",
  "yaml",
  "env",
  "python",
  "cpp",
  "csharp",
  "go",
  "php",
  "java",
  "kotlin",
  "terraform",
  "dockerfile",
  "rust",
];

const REGISTERED_ANALYZERS = [
  "cpp",
  "csharp",
  "go",
  "java",
  "kotlin",
  "php",
  "python",
  "terraform",
  "typescript",
  "javascript",
].sort();

function languagesForLayer(layer: HeadlineLayer): {
  orchestratorLanguages: string[];
  personalDataLanguages: string[];
} {
  const evalLayer = layer as EvalLayerId;
  const orchestratorLanguages = FILE_LANGUAGES.filter((language) =>
    isOrchestratorLayerLanguage(language),
  ).sort();
  const personalDataLanguages = FILE_LANGUAGES.filter((language) =>
    isPersonalDataLayerLanguage(language),
  ).sort();

  if (layer === "components" || layer === "data-flows") {
    return { orchestratorLanguages, personalDataLanguages: [] };
  }

  if (layer === "mentions" || layer === "data-items") {
    return { orchestratorLanguages: [], personalDataLanguages };
  }

  return { orchestratorLanguages, personalDataLanguages };
}

function buildLayerProfile(layer: HeadlineLayer): LayerEligibilityProfileSummary {
  const languages = languagesForLayer(layer);
  const payload = {
    layer,
    ...languages,
    excludedDirectories: [...DEFAULT_EXCLUDED_DIRS].sort(),
    excludedFileGlobs: [...DEFAULT_EXCLUDED_FILE_GLOBS].sort(),
    ingestLimits: {
      maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
      maxFileCount: DEFAULT_MAX_FILE_COUNT,
      maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    },
    registeredAnalyzers: REGISTERED_ANALYZERS,
    fileLanguages: [...FILE_LANGUAGES].sort(),
  };

  return {
    layer,
    orchestratorLanguages: languages.orchestratorLanguages,
    personalDataLanguages: languages.personalDataLanguages,
    profileDigest: digestStableJson(payload),
  };
}

export function buildEligibilityProfileFingerprint(): EligibilityProfileFingerprint {
  const perLayer = HEADLINE_LAYERS.map((layer) => buildLayerProfile(layer));
  const profile = {
    fileLanguages: [...FILE_LANGUAGES].sort(),
    registeredAnalyzers: REGISTERED_ANALYZERS,
    excludedDirectories: [...DEFAULT_EXCLUDED_DIRS].sort(),
    excludedFileGlobs: [...DEFAULT_EXCLUDED_FILE_GLOBS].sort(),
    ingestLimits: {
      maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
      maxFileCount: DEFAULT_MAX_FILE_COUNT,
      maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    },
    perLayer,
  };

  return {
    ...profile,
    profileDigest: digestStableJson(profile),
  };
}
