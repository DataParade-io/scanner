/**
 * Attribute and grouping metrics for occurrence gold (KDATAP-ec05ea).
 *
 * Attributes are scored like vendor resolution: each attribute has its own
 * denominator of matched pairs whose gold asserts that attribute. Grouping is
 * scored pairwise over matched positive occurrences. Neither ever changes a
 * headline recall or precision denominator, and there is no cross-metric scalar.
 */

export interface OccurrenceDeclarationValue {
  file_path: string;
  line: number;
  kind: string;
}

/** Attribute values as carried on occurrence gold and on scanner occurrence findings. */
export interface OccurrenceAttributeValues {
  syntax_kind?: string;
  declaration?: OccurrenceDeclarationValue | "unresolved";
  type_annotation?: string;
  owner?: string;
  touches?: string[];
  group?: string;
}

export const SCORED_OCCURRENCE_ATTRIBUTES = [
  "syntax_kind",
  "declaration",
  "type_annotation",
  "owner",
  "touches",
] as const;

export type ScoredOccurrenceAttribute = (typeof SCORED_OCCURRENCE_ATTRIBUTES)[number];

export type AttributeMetricState =
  | "computable"
  /** No matched gold asserts this attribute. */
  | "not_asserted_by_gold"
  /** The scanner emits no findings carrying this attribute. */
  | "scanner_capability_not_declared";

export interface AttributeMetricScore {
  state: AttributeMetricState;
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface MatchedOccurrencePair {
  gold?: OccurrenceAttributeValues;
  finding?: OccurrenceAttributeValues;
}

function attributeEquals(
  attribute: ScoredOccurrenceAttribute,
  gold: OccurrenceAttributeValues,
  finding: OccurrenceAttributeValues,
): boolean {
  if (attribute === "declaration") {
    const expected = gold.declaration;
    const actual = finding.declaration;
    if (expected === "unresolved" || actual === "unresolved") {
      return expected === actual;
    }
    return (
      expected !== undefined &&
      actual !== undefined &&
      expected.file_path === actual.file_path &&
      expected.line === actual.line &&
      expected.kind === actual.kind
    );
  }
  if (attribute === "touches") {
    const expected = [...(gold.touches ?? [])].sort();
    const actual = [...(finding.touches ?? [])].sort();
    return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
  }
  return gold[attribute] === finding[attribute];
}

/**
 * Accuracy per attribute over matched pairs whose gold asserts the attribute.
 * `declaredAttributes` lists attributes the scanner emits on any occurrence finding
 * (not only matched ones); an undeclared attribute is never scored as wrong.
 */
export function computeOccurrenceAttributeMetrics(
  pairs: MatchedOccurrencePair[],
  declaredAttributes: ReadonlySet<ScoredOccurrenceAttribute>,
): Record<ScoredOccurrenceAttribute, AttributeMetricScore> {
  const result = {} as Record<ScoredOccurrenceAttribute, AttributeMetricScore>;
  for (const attribute of SCORED_OCCURRENCE_ATTRIBUTES) {
    const asserting = pairs.filter((pair) => pair.gold?.[attribute] !== undefined);
    if (asserting.length === 0) {
      result[attribute] = { state: "not_asserted_by_gold", value: null, numerator: 0, denominator: 0 };
      continue;
    }
    if (!declaredAttributes.has(attribute)) {
      result[attribute] = {
        state: "scanner_capability_not_declared",
        value: null,
        numerator: 0,
        denominator: asserting.length,
      };
      continue;
    }
    const numerator = asserting.filter(
      (pair) => pair.finding !== undefined && attributeEquals(attribute, pair.gold!, pair.finding),
    ).length;
    result[attribute] = {
      state: "computable",
      value: numerator / asserting.length,
      numerator,
      denominator: asserting.length,
    };
  }
  return result;
}

/** Attributes present on at least one scanner occurrence finding. */
export function declaredOccurrenceAttributes(
  findings: Array<OccurrenceAttributeValues | undefined>,
): Set<ScoredOccurrenceAttribute> {
  const declared = new Set<ScoredOccurrenceAttribute>();
  for (const attributes of findings) {
    if (!attributes) {
      continue;
    }
    for (const attribute of SCORED_OCCURRENCE_ATTRIBUTES) {
      if (attributes[attribute] !== undefined) {
        declared.add(attribute);
      }
    }
  }
  return declared;
}

export interface GroupedOccurrence {
  goldGroup?: string;
  predictedGroup?: string;
}

export interface PairwiseGroupingScores {
  precision: AttributeMetricScore;
  recall: AttributeMetricScore;
}

/**
 * Pairwise grouping over matched positive occurrences whose gold asserts a group.
 * Recall: gold same-group pairs the scanner also puts together.
 * Precision: scanner same-group pairs that gold also puts together.
 * A occurrence without a predicted group is its own singleton.
 */
export function computePairwiseGrouping(
  occurrences: GroupedOccurrence[],
  scannerDeclaresGroups: boolean,
): PairwiseGroupingScores {
  const grouped = occurrences.filter((occurrence) => occurrence.goldGroup !== undefined);
  let goldPairs = 0;
  let predictedPairs = 0;
  let bothPairs = 0;
  for (let i = 0; i < grouped.length; i += 1) {
    for (let j = i + 1; j < grouped.length; j += 1) {
      const sameGold = grouped[i].goldGroup === grouped[j].goldGroup;
      const samePredicted =
        grouped[i].predictedGroup !== undefined &&
        grouped[i].predictedGroup === grouped[j].predictedGroup;
      if (sameGold) goldPairs += 1;
      if (samePredicted) predictedPairs += 1;
      if (sameGold && samePredicted) bothPairs += 1;
    }
  }
  if (grouped.length === 0) {
    const empty: AttributeMetricScore = { state: "not_asserted_by_gold", value: null, numerator: 0, denominator: 0 };
    return { precision: empty, recall: empty };
  }
  if (!scannerDeclaresGroups) {
    return {
      precision: { state: "scanner_capability_not_declared", value: null, numerator: 0, denominator: 0 },
      recall: { state: "scanner_capability_not_declared", value: null, numerator: 0, denominator: goldPairs },
    };
  }
  return {
    precision: {
      state: "computable",
      value: predictedPairs === 0 ? null : bothPairs / predictedPairs,
      numerator: bothPairs,
      denominator: predictedPairs,
    },
    recall: {
      state: "computable",
      value: goldPairs === 0 ? null : bothPairs / goldPairs,
      numerator: bothPairs,
      denominator: goldPairs,
    },
  };
}
