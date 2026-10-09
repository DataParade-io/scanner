export { classifyRawFindings } from "./component-factory";
export {
  dedupeComponents,
  mergeDatabaseAssetsByType,
  alignGenericEntityFrameworkWithProvider,
  compactAuthServiceComponents,
  foldUnroutedInfrastructureIntoRoutedSection,
  mergeGlobalIdentityProviderThirdParties,
} from "./postprocessing";
export {
  injectApplicationAssetsPerSectionIfMissing,
  ensureApplicationHubsForOccupiedSections,
  injectApplicationAssetIfMissing,
  injectActorIfMissing,
  synthesizeSectionApiNodes,
} from "./application-injection";
