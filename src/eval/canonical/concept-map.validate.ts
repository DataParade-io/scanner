import { z } from "zod";

/** Gold taxonomy parent keys — never valid as concept_leaf (KDATAP-326fdd). */
export const FORBIDDEN_CATEGORY_LEAVES: readonly string[] = [
  "person_name",
  "national_identifier",
  "user_identifier",
  "street_address",
  "credential_secret",
  "password_verifier",
  "employment_information",
  "residence_information",
];

const FORBIDDEN_CATEGORY_LEAF_SET = new Set(
  FORBIDDEN_CATEGORY_LEAVES.map(normalizeConceptToken),
);

const FORBIDDEN_ENTRY_KEYS = ["aliases", "equivalent_to", "group"] as const;

const entrySchema = z
  .object({
    rule_id: z.string().min(1),
    concept_leaf: z.string().min(1),
    concept_ancestry: z.array(z.string().min(1)).optional(),
  })
  .strict();

const documentSchema = z
  .object({
    version: z.string().min(1),
    personal_data_concept_map: z.array(entrySchema).min(1),
  })
  .strict();

export interface PersonalDataConceptMapEntry {
  ruleId: string;
  conceptLeaf: string;
  conceptAncestry: readonly string[];
}

export interface PersonalDataConceptMap {
  version: string;
  entries: readonly PersonalDataConceptMapEntry[];
}

export function normalizeConceptToken(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_");
}

function rejectForbiddenEntryKeys(rawEntry: Record<string, unknown>, index: number): void {
  for (const key of FORBIDDEN_ENTRY_KEYS) {
    if (key in rawEntry) {
      throw new Error(
        `personal_data_concept_map[${index}]: forbidden key '${key}' — map must not be group-shaped`,
      );
    }
  }
}

function rejectForbiddenDocumentKeys(raw: Record<string, unknown>): void {
  for (const key of FORBIDDEN_ENTRY_KEYS) {
    if (key in raw) {
      throw new Error(
        `personal-data-concept-map: forbidden key '${key}' at document root — map must not be group-shaped`,
      );
    }
  }
}

/**
 * Validate a parsed YAML document against the closed PII rule-id inventory.
 * Throws on any group-shaped, duplicate-leaf, category-as-leaf, or coverage mismatch.
 */
export function validatePersonalDataConceptMapDocument(
  parsed: unknown,
  expectedRuleIds: readonly string[],
): PersonalDataConceptMap {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("personal-data-concept-map: expected YAML object at document root");
  }

  const raw = parsed as Record<string, unknown>;
  rejectForbiddenDocumentKeys(raw);

  const normalized = documentSchema.parse(parsed);
  const expectedSet = new Set(expectedRuleIds.map(normalizeConceptToken));
  const seenRuleIds = new Set<string>();
  const seenLeaves = new Set<string>();
  const entries: PersonalDataConceptMapEntry[] = [];

  for (let index = 0; index < normalized.personal_data_concept_map.length; index += 1) {
    const row = normalized.personal_data_concept_map[index];
    const rawRow = (raw.personal_data_concept_map as unknown[])[index];
    if (typeof rawRow === "object" && rawRow !== null && !Array.isArray(rawRow)) {
      rejectForbiddenEntryKeys(rawRow as Record<string, unknown>, index);
    }

    const ruleId = normalizeConceptToken(row.rule_id);
    const conceptLeaf = normalizeConceptToken(row.concept_leaf);

    if (seenRuleIds.has(ruleId)) {
      throw new Error(
        `personal_data_concept_map[${index}]: duplicate rule_id '${row.rule_id}'`,
      );
    }
    seenRuleIds.add(ruleId);

    if (!expectedSet.has(ruleId)) {
      throw new Error(
        `personal_data_concept_map[${index}]: orphan rule_id '${row.rule_id}' not in patterns/pii-signals.rules.yaml`,
      );
    }

    if (FORBIDDEN_CATEGORY_LEAF_SET.has(conceptLeaf)) {
      throw new Error(
        `personal_data_concept_map[${index}]: concept_leaf '${row.concept_leaf}' is a forbidden gold category key`,
      );
    }

    if (seenLeaves.has(conceptLeaf)) {
      throw new Error(
        `personal_data_concept_map[${index}]: duplicate concept_leaf '${row.concept_leaf}' — map must be one-to-one at the leaf`,
      );
    }
    seenLeaves.add(conceptLeaf);

    const ancestryRaw = row.concept_ancestry ?? [row.concept_leaf];
    const conceptAncestry = ancestryRaw.map((token) => normalizeConceptToken(token));
    const terminal = conceptAncestry[conceptAncestry.length - 1];
    if (terminal !== conceptLeaf) {
      throw new Error(
        `personal_data_concept_map[${index}]: concept_ancestry terminal '${terminal}' must equal concept_leaf '${row.concept_leaf}'`,
      );
    }

    entries.push({
      ruleId,
      conceptLeaf,
      conceptAncestry,
    });
  }

  for (const expectedId of expectedSet) {
    if (!seenRuleIds.has(expectedId)) {
      throw new Error(
        `personal-data-concept-map: missing rule_id '${expectedId}' from patterns/pii-signals.rules.yaml`,
      );
    }
  }

  return {
    version: normalized.version.trim(),
    entries,
  };
}
