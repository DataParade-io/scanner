import type { PersonalDataEvalLayer, PersonalDataFinding } from "../../../../src/eval-layers/collect-personal-data-findings";
import { buildScannerFinding } from "../builders";
import { ruleIdToAncestry, ruleIdToConceptLeaf } from "../concept-map";
import type { CanonicalLayer, CanonicalScannerFinding, ObservedTokenCandidate } from "../types";
import { resolveScannerAdapterMapVersion } from "./manifest";

const LAYER_BY_EVAL: Record<PersonalDataEvalLayer, CanonicalLayer> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

const RULE_ID_PREFIXES = ["raw_hit:", "mention:", "data_item:"] as const;

export function extractPersonalDataRuleId(subjectKey: string): string {
  const normalized = subjectKey.trim().toLowerCase();
  for (const prefix of RULE_ID_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  throw new Error(`Personal data subject key missing known prefix: '${subjectKey}'`);
}

function labelObservedTokens(labels: readonly string[]): ObservedTokenCandidate[] {
  if (labels.length === 0) {
    return [];
  }
  return labels.map((label) => ({
    value: label,
    evidenceRef: 0,
    provenance: "scanner-rule-labels",
    validationState: "unverified" as const,
  }));
}

export function adaptPersonalDataFinding(
  finding: PersonalDataFinding,
  layer: PersonalDataEvalLayer,
  adapterMapVersion: string = resolveScannerAdapterMapVersion(),
): CanonicalScannerFinding {
  const ruleId = extractPersonalDataRuleId(finding.subjectKey);
  const conceptLeaf = ruleIdToConceptLeaf(ruleId);
  const conceptAncestry = ruleIdToAncestry(ruleId);
  const observedTokenCandidates = labelObservedTokens(finding.labels);

  return buildScannerFinding({
    layer: LAYER_BY_EVAL[layer],
    identityKey: finding.subjectKey,
    conceptLeaf,
    conceptAncestry,
    evidenceLocations: finding.evidenceLocations.map((location) => ({
      file_path: location.filePath,
      start_line: location.startLine,
      end_line: location.endLine,
    })),
    observedTokenCandidates:
      observedTokenCandidates.length > 0 ? observedTokenCandidates : undefined,
    adapterMapVersion,
  });
}
