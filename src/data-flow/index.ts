export { detectDataFlows } from "./detector";
export { dedupeDataFlows } from "./dedupe";
export { rewireFlowsThroughApplication } from "./rewire";
export { ensureActorToAppFlow } from "./ensure-actor-flow";
export {
  ensureManifestDeclaredThirdPartyFlows,
  ensureHubToOrphanThirdPartyFlows,
  isManifestOnlyThirdPartyComponent,
} from "./ensure-manifest-declared-flows";
export { ensureHubToUnlinkedAssets } from "./ensure-hub-linked-assets";
export { DEFAULT_HUB_LINK_RULES, type HubLinkRule } from "./hub-link-policy";
export { resolveAuthMiddlewareTarget } from "./auth-middleware-target";
export { detectDataFlows as detectRawDataFlows } from "./detect";
export { postprocessDataFlows } from "./postprocess";
