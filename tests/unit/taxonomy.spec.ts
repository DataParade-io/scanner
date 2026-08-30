import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";

import { loadPropertyDetectionConfig } from "../../src/config/property-detection-config";

const PATTERNS_ROOT = path.join(__dirname, "../../patterns");
const TAXONOMY_PATH = path.join(PATTERNS_ROOT, "component-taxonomy.yaml");

interface TaxonomySubtype {
  id: string;
  type: string;
}

function loadTaxonomy(): { subtypes: TaxonomySubtype[]; types: string[] } {
  const raw = fs.readFileSync(TAXONOMY_PATH, "utf8");
  const parsed = YAML.parse(raw) as {
    types: { id: string }[];
    subtypes: TaxonomySubtype[];
  };
  return {
    types: parsed.types.map((t) => t.id),
    subtypes: parsed.subtypes,
  };
}

function loadClassifierYamlSubtypes(fileName: string): string[] {
  const fullPath = path.join(PATTERNS_ROOT, "classifier", fileName);
  if (!fs.existsSync(fullPath)) return [];
  const raw = fs.readFileSync(fullPath, "utf8");
  const parsed = YAML.parse(raw) as Record<string, unknown>;
  const subtypes: string[] = [];

  function extract(obj: unknown): void {
    if (typeof obj !== "object" || obj === null) return;
    if (Array.isArray(obj)) {
      for (const item of obj) extract(item);
      return;
    }
    const record = obj as Record<string, unknown>;
    if (typeof record.subType === "string") {
      subtypes.push(record.subType);
    }
    for (const value of Object.values(record)) {
      if (typeof value === "object") extract(value);
    }
  }

  extract(parsed);
  return subtypes;
}

describe("component taxonomy is the single source of truth", () => {
  const taxonomy = loadTaxonomy();
  const taxonomySubtypeIds = new Set(taxonomy.subtypes.map((s) => s.id));
  const taxonomyTypeIds = new Set(taxonomy.types);

  it("declares all subtypes used by classifier YAMLs", () => {
    const files = [
      "components.classifier.yaml",
      "third-party.classifier.yaml",
      "actors.classifier.yaml",
    ];
    for (const file of files) {
      for (const st of loadClassifierYamlSubtypes(file)) {
        expect(taxonomySubtypeIds.has(st)).toBe(true);
      }
    }
  });

  it("declares all subtypes used by the TS property-detection config", () => {
    const config = loadPropertyDetectionConfig();
    const tsSubtypes = [
      ...config.enhance.mainAppSubtypes,
      ...config.enhance.cloudAssetSubtypes,
      ...config.enhance.onPremAssetSubtypes,
    ];
    for (const st of tsSubtypes) {
      expect(taxonomySubtypeIds.has(st)).toBe(true);
    }
  });

  it("every taxonomy subtype references a declared type", () => {
    for (const subtype of taxonomy.subtypes) {
      expect(taxonomyTypeIds.has(subtype.type)).toBe(true);
    }
  });
});
