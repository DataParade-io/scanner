import type { PiiSignalHit } from "../../../../src/pii-signals/match-pii-signals";
import { mentionIdentity } from "../../../../src/eval-layers/identities";
import type { LayerFinding } from "../../types";
import {
  personalDataFindingToLayerFinding,
  scanCanonicalPersonalDataLayer,
  scanFixturePersonalDataLayer,
} from "../personal-data-adapter";

export { personalDataFindingToLayerFinding };

export function mentionHitToLayerFinding(hit: PiiSignalHit): LayerFinding {
  return personalDataFindingToLayerFinding({
    subjectKey: mentionIdentity(hit.id),
    labels: [...hit.labels],
    evidenceLocations: [
      {
        filePath: hit.evidence.filePath,
        startLine: hit.evidence.startLine,
        endLine: hit.evidence.endLine,
      },
    ],
  });
}

export async function scanFixtureMentions(fixture: string) {
  return scanFixturePersonalDataLayer(fixture, "mentions");
}

export async function scanCanonicalMentions(fixture: string) {
  return scanCanonicalPersonalDataLayer(fixture, "mentions");
}
