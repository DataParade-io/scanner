import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";
import { findPackageRoot } from "../package-root";

/**
 * Per-concept hints of the declared-column catalog, read from `patterns/concept-profiles.yaml`
 * (KDATAP-0df343): the type names that settle a concept, and the role words of its
 * configured keys. Keeping them in data makes a new concept an entry, not code.
 */

const profileSchema = z.object({
  id: z.string().min(1),
  type_hints: z.array(z.string()).default([]),
  role_words: z.array(z.string()).default([]),
  role_runs: z.array(z.string()).default([]),
  tail_words: z.array(z.string()).default([]),
  role_words_suffice: z.boolean().default(false),
});

const catalogSchema = z.object({
  negative_words: z.array(z.string()).default([]),
  concept_profiles: z.array(profileSchema).default([]),
});

export interface ConceptProfile {
  /** Normalized type names that settle the concept (see `normalizeTypeName`). */
  typeHints: ReadonlySet<string>;
  roleWords: ReadonlySet<string>;
  roleRuns: readonly string[];
  tailWords: ReadonlySet<string>;
  roleWordsSuffice: boolean;
  /** Last words that mark a configured key as a flag, count or id (shared by all concepts). */
  negativeWords: ReadonlySet<string>;
}

let cached: z.infer<typeof catalogSchema> | undefined;

function loadCatalog(): z.infer<typeof catalogSchema> {
  if (!cached) {
    const file = path.join(findPackageRoot(__dirname), "patterns", "concept-profiles.yaml");
    cached = catalogSchema.parse(YAML.parse(fs.readFileSync(file, "utf8")));
  }
  return cached;
}

/** Lower-case a type name and drop its module prefix and punctuation: `models.EmailField` -> `emailfield`. */
export function normalizeTypeName(type: string): string {
  return (type.split(".").pop() ?? type).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The profile of a concept id (`email`, `phone_number`). A concept without an entry gets
 * an empty one plus the types named like the concept (`phonenumber`, `phonenumberfield`).
 */
export function conceptProfile(concept: string): ConceptProfile {
  const catalog = loadCatalog();
  const entry = catalog.concept_profiles.find((profile) => profile.id === concept);
  const own = normalizeTypeName(concept);
  return {
    typeHints: new Set([own, `${own}field`, ...(entry?.type_hints ?? []).map(normalizeTypeName)]),
    roleWords: new Set(entry?.role_words ?? []),
    roleRuns: entry?.role_runs ?? [],
    tailWords: new Set(entry?.tail_words ?? []),
    roleWordsSuffice: entry?.role_words_suffice ?? false,
    negativeWords: new Set(catalog.negative_words),
  };
}
