/**
 * Stable identity keys for the four personal-data evaluation grades.
 *
 * - raw_hit: YAML heuristic pattern match before roll-up (one per line hit)
 * - mention: file+line receipt that a data item was seen
 * - data_item: unique personal-data concept in a fixture (rolled up)
 */

/** Rule id from patterns/pii-signals.rules.yaml maps 1:1 to a data item concept. */
export function dataItemConceptId(ruleId: string): string {
  return ruleId;
}

export function rawHitIdentity(ruleId: string): string {
  return `raw_hit:${ruleId}`;
}

export function mentionIdentity(ruleId: string): string {
  return `mention:${dataItemConceptId(ruleId)}`;
}

export function dataItemIdentity(ruleId: string): string {
  return `data_item:${dataItemConceptId(ruleId)}`;
}

/** @deprecated Use mentionIdentity or rawHitIdentity; kept for transitional imports. */
export function piiSignalIdentity(ruleId: string): string {
  return rawHitIdentity(ruleId);
}
