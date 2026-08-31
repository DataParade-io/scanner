export { LEGACY_SOURCE_CONTRACT_VERSION, CANONICAL_CONTRACT_VERSION } from "./contract";
export { annotationRecordToLegacyInput } from "./adapters";
export { CONVERSION_KINDS } from "./conversions";
export { loadLegacyGoldRecord } from "./loader";
export type {
  CompatLoadResult,
  ConversionKind,
  LegacyGoldProvenance,
  LegacyGoldRecord,
  LoadLegacyGoldOptions,
  MigrationDiagnostic,
} from "./types";
