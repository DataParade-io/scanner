import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";

import { loadPropertyDetectionConfig } from "../../src/config/property-detection-config";
import { loadComponentTaxonomy } from "../../src/classifier/component-taxonomy";

const PATTERNS_ROOT = path.join(__dirname, "../../patterns");

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
  const taxonomy = loadComponentTaxonomy();
  const taxonomySubtypeIds = new Set(
    [...taxonomy.subtypeToType.keys()],
  );
  const taxonomyTypeIds = taxonomy.types;

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

  it("declares api_consumer actor subtype used by application injection", () => {
    expect(taxonomySubtypeIds.has("api_consumer")).toBe(true);
  });

  it("every taxonomy subtype references a declared type", () => {
    for (const [subtype, componentType] of taxonomy.subtypeToType) {
      expect(taxonomyTypeIds.has(componentType)).toBe(true);
      void subtype;
    }
  });

  it("rejects component gold labels that are types rather than subtypes", () => {
    const benchmarkRoot = path.join(__dirname, "../benchmark/repos");
    const componentFiles = fs
      .readdirSync(benchmarkRoot, { withFileTypes: true })
      .map((entry) =>
        path.join(benchmarkRoot, entry.name, "annotations", "components.yaml"),
      )
      .filter((filePath) => fs.existsSync(filePath));

    for (const filePath of componentFiles) {
      const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as {
        annotations?: { expected?: { labels?: string[] } }[];
      };
      for (const annotation of parsed.annotations ?? []) {
        for (const label of annotation.expected?.labels ?? []) {
          expect(taxonomyTypeIds.has(label)).toBe(false);
          expect(taxonomySubtypeIds.has(label)).toBe(true);
        }
      }
    }
  });
});
