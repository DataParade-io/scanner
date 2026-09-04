import fs from "fs";
import path from "path";
import YAML from "yaml";

import { loadPiiSignalRules } from "../../pii-signals/pii-signal-rules";
import {
  type PersonalDataConceptMap,
  type PersonalDataConceptMapEntry,
  validatePersonalDataConceptMapDocument,
} from "./concept-map.validate";

let cachedMap: PersonalDataConceptMap | undefined;
let cachedByRuleId: Map<string, PersonalDataConceptMapEntry> | undefined;

export function clearPersonalDataConceptMapCacheForTest(): void {
  cachedMap = undefined;
  cachedByRuleId = undefined;
}

function getConceptMapPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const repoRoot =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "patterns", "personal-data-concept-map.yaml");
}

function indexByRuleId(map: PersonalDataConceptMap): Map<string, PersonalDataConceptMapEntry> {
  const index = new Map<string, PersonalDataConceptMapEntry>();
  for (const entry of map.entries) {
    index.set(entry.ruleId, entry);
  }
  return index;
}

export function loadPersonalDataConceptMap(): PersonalDataConceptMap {
  if (cachedMap) {
    return cachedMap;
  }

  const configPath = getConceptMapPath();
  let rawText: string;
  try {
    rawText = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Personal data concept map required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Personal data concept map at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  const expectedRuleIds = loadPiiSignalRules().map((rule) => rule.id);
  cachedMap = validatePersonalDataConceptMapDocument(parsed, expectedRuleIds);
  cachedByRuleId = indexByRuleId(cachedMap);
  return cachedMap;
}

function requireEntry(ruleId: string): PersonalDataConceptMapEntry {
  const map = loadPersonalDataConceptMap();
  const normalized = ruleId.trim().toLowerCase().replace(/-/g, "_");
  const entry = cachedByRuleId?.get(normalized);
  if (!entry) {
    throw new Error(
      `Personal data concept map has no entry for rule_id '${ruleId}'`,
    );
  }
  return entry;
}

/** Lookup a concept-map entry without throwing when the rule id is unknown. */
export function tryRuleIdToConceptEntry(ruleId: string): PersonalDataConceptMapEntry | undefined {
  loadPersonalDataConceptMap();
  const normalized = ruleId.trim().toLowerCase().replace(/-/g, "_");
  return cachedByRuleId?.get(normalized);
}

/** Canonical concept leaf for a detector rule id from patterns/pii-signals.rules.yaml. */
export function ruleIdToConceptLeaf(ruleId: string): string {
  return requireEntry(ruleId).conceptLeaf;
}

/** Taxonomy ancestry for a detector rule id; terminal element equals the concept leaf. */
export function ruleIdToAncestry(ruleId: string): readonly string[] {
  return requireEntry(ruleId).conceptAncestry;
}

export type { PersonalDataConceptMap, PersonalDataConceptMapEntry } from "./concept-map.validate";
export {
  FORBIDDEN_CATEGORY_LEAVES,
  normalizeConceptToken,
  validatePersonalDataConceptMapDocument,
} from "./concept-map.validate";
