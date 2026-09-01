export { LEGACY_SOURCE_CONTRACT_VERSION, CANONICAL_CONTRACT_VERSION } from "./contract";
export { annotationRecordToLegacyInput } from "./adapters";
export { CONVERSION_KINDS } from "./conversions";
export {
  buildAnnotationCanonicalBlock,
  buildComponentMigrationLedger,
  buildComponentMigrationLedgerEntry,
  classifyComponentMigrationBucket,
  listAcceptedComponentAnnotations,
} from "./component-migration";
export type {
  ComponentMigrationBucket,
  ComponentMigrationLedger,
  ComponentMigrationLedgerEntry,
} from "./component-migration";
export {
  buildRepoLocalEntityId,
  classificationIdentityKey,
  clearComponentTaxonomyCacheForTest,
  loadComponentTaxonomy,
  resolveComponentSubtype,
} from "./component-taxonomy";
export { loadLegacyGoldRecord } from "./loader";
export type {
  CompatLoadResult,
  ConversionKind,
  LegacyGoldProvenance,
  LegacyGoldRecord,
  LoadLegacyGoldOptions,
  MigrationDiagnostic,
} from "./types";
