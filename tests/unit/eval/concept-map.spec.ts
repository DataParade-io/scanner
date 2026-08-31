import fs from "fs";
import path from "path";

import { loadPiiSignalRules } from "../../../src/pii-signals/pii-signal-rules";
import {
  clearPersonalDataConceptMapCacheForTest,
  FORBIDDEN_CATEGORY_LEAVES,
  loadPersonalDataConceptMap,
  ruleIdToAncestry,
  ruleIdToConceptLeaf,
  validatePersonalDataConceptMapDocument,
} from "../../eval/canonical";

const LOCKED_ROWS: ReadonlyArray<{
  rule_id: string;
  concept_leaf: string;
  concept_ancestry: readonly string[];
}> = [
  { rule_id: "first_name", concept_leaf: "first_name", concept_ancestry: ["person_name", "first_name"] },
  { rule_id: "last_name", concept_leaf: "last_name", concept_ancestry: ["person_name", "last_name"] },
  { rule_id: "full_name", concept_leaf: "full_name", concept_ancestry: ["person_name", "full_name"] },
  { rule_id: "date_of_birth", concept_leaf: "date_of_birth", concept_ancestry: ["date_of_birth"] },
  { rule_id: "phone_number", concept_leaf: "phone_number", concept_ancestry: ["phone_number"] },
  { rule_id: "address", concept_leaf: "address", concept_ancestry: ["street_address", "address"] },
  {
    rule_id: "ssn",
    concept_leaf: "social_security_number",
    concept_ancestry: ["national_identifier", "social_security_number"],
  },
  {
    rule_id: "passport",
    concept_leaf: "passport_number",
    concept_ancestry: ["national_identifier", "passport_number"],
  },
  {
    rule_id: "national_id",
    concept_leaf: "national_id",
    concept_ancestry: ["national_identifier", "national_id"],
  },
  {
    rule_id: "drivers_license",
    concept_leaf: "drivers_license_number",
    concept_ancestry: ["national_identifier", "drivers_license_number"],
  },
  {
    rule_id: "tax_id",
    concept_leaf: "tax_identifier",
    concept_ancestry: ["national_identifier", "tax_identifier"],
  },
  { rule_id: "account_number", concept_leaf: "account_number", concept_ancestry: ["account_number"] },
  { rule_id: "username", concept_leaf: "username", concept_ancestry: ["user_identifier", "username"] },
  { rule_id: "email", concept_leaf: "email_address", concept_ancestry: ["email_address"] },
  { rule_id: "password", concept_leaf: "password", concept_ancestry: ["password"] },
];

function expectedRuleIds(): string[] {
  return loadPiiSignalRules().map((rule) => rule.id);
}

function minimalValidDocument(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "test-1.0.0",
    personal_data_concept_map: LOCKED_ROWS.map((row) => ({
      rule_id: row.rule_id,
      concept_leaf: row.concept_leaf,
      concept_ancestry: [...row.concept_ancestry],
    })),
    ...overrides,
  };
}

describe("personal data concept map", () => {
  beforeEach(() => {
    clearPersonalDataConceptMapCacheForTest();
  });

  it("covers exactly the 15 PII rule ids from patterns/pii-signals.rules.yaml", () => {
    const ruleIds = expectedRuleIds();
    expect(ruleIds).toHaveLength(15);
    const map = loadPersonalDataConceptMap();
    expect(map.entries).toHaveLength(15);
    expect(new Set(map.entries.map((entry) => entry.ruleId))).toEqual(new Set(ruleIds));
  });

  it("matches the locked 15-row reviewed table", () => {
    const map = loadPersonalDataConceptMap();
    for (const expected of LOCKED_ROWS) {
      const entry = map.entries.find((row) => row.ruleId === expected.rule_id);
      expect(entry).toBeDefined();
      expect(entry?.conceptLeaf).toBe(expected.concept_leaf);
      expect(entry?.conceptAncestry).toEqual(expected.concept_ancestry);
    }
  });

  it("maps rule ids through ruleIdToConceptLeaf and ruleIdToAncestry", () => {
    expect(ruleIdToConceptLeaf("ssn")).toBe("social_security_number");
    expect(ruleIdToAncestry("ssn")).toEqual(["national_identifier", "social_security_number"]);
    expect(ruleIdToConceptLeaf("email")).toBe("email_address");
    expect(ruleIdToConceptLeaf("password")).toBe("password");
    expect(ruleIdToConceptLeaf("ssn")).not.toBe("national_identifier");
  });

  it("assigns 15 distinct concept leaves", () => {
    const map = loadPersonalDataConceptMap();
    const leaves = map.entries.map((entry) => entry.conceptLeaf);
    expect(new Set(leaves).size).toBe(15);
  });

  describe("validation rejects group-shaped and invalid maps", () => {
    it("rejects array-valued concept_leaf", () => {
      const doc = minimalValidDocument();
      (doc.personal_data_concept_map as unknown[])[0] = {
        rule_id: "ssn",
        concept_leaf: ["ssn", "national_id"],
        concept_ancestry: ["national_identifier", "social_security_number"],
      };
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow();
    });

    it("rejects duplicate concept leaves", () => {
      const doc = minimalValidDocument();
      const rows = doc.personal_data_concept_map as Array<Record<string, unknown>>;
      rows[1] = {
        rule_id: "last_name",
        concept_leaf: "first_name",
        concept_ancestry: ["person_name", "first_name"],
      };
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
        /duplicate concept_leaf/i,
      );
    });

    it("rejects category-as-leaf for ssn → national_identifier", () => {
      const doc = minimalValidDocument();
      const ssnRow = (doc.personal_data_concept_map as Array<Record<string, unknown>>).find(
        (row) => row.rule_id === "ssn",
      );
      expect(ssnRow).toBeDefined();
      ssnRow!.concept_leaf = "national_identifier";
      ssnRow!.concept_ancestry = ["national_identifier"];
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
        /forbidden gold category key/i,
      );
    });

    it("rejects every forbidden category leaf token", () => {
      for (const category of FORBIDDEN_CATEGORY_LEAVES) {
        const doc = minimalValidDocument();
        (doc.personal_data_concept_map as unknown[])[0] = {
          rule_id: "first_name",
          concept_leaf: category,
          concept_ancestry: [category],
        };
        expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
          /forbidden gold category key/i,
        );
      }
    });

    it("rejects missing rule ids from the patterns inventory", () => {
      const doc = minimalValidDocument();
      doc.personal_data_concept_map = (doc.personal_data_concept_map as unknown[]).filter(
        (row) => (row as { rule_id: string }).rule_id !== "password",
      );
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
        /missing rule_id 'password'/i,
      );
    });

    it("rejects orphan rule ids not present in patterns", () => {
      const doc = minimalValidDocument();
      (doc.personal_data_concept_map as unknown[]).push({
        rule_id: "made_up_rule",
        concept_leaf: "made_up_leaf",
        concept_ancestry: ["made_up_leaf"],
      });
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
        /orphan rule_id/i,
      );
    });

    it("rejects aliases: at document root", () => {
      expect(() =>
        validatePersonalDataConceptMapDocument(
          { ...minimalValidDocument(), aliases: ["email"] },
          expectedRuleIds(),
        ),
      ).toThrow(/forbidden key 'aliases'/i);
    });

    it("rejects equivalent_to: at document root", () => {
      expect(() =>
        validatePersonalDataConceptMapDocument(
          { ...minimalValidDocument(), equivalent_to: "email" },
          expectedRuleIds(),
        ),
      ).toThrow(/forbidden key 'equivalent_to'/i);
    });

    it("rejects group: at document root", () => {
      expect(() =>
        validatePersonalDataConceptMapDocument(
          { ...minimalValidDocument(), group: ["email", "mail"] },
          expectedRuleIds(),
        ),
      ).toThrow(/forbidden key 'group'/i);
    });

    it("rejects aliases: on a map entry", () => {
      const doc = minimalValidDocument();
      (doc.personal_data_concept_map as Array<Record<string, unknown>>)[0].aliases = ["mail"];
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow();
    });

    it("rejects ancestry whose terminal element does not equal concept_leaf", () => {
      const doc = minimalValidDocument();
      const ssnRow = (doc.personal_data_concept_map as Array<Record<string, unknown>>).find(
        (row) => row.rule_id === "ssn",
      );
      expect(ssnRow).toBeDefined();
      ssnRow!.concept_ancestry = ["national_identifier", "national_id"];
      expect(() => validatePersonalDataConceptMapDocument(doc, expectedRuleIds())).toThrow(
        /concept_ancestry terminal/i,
      );
    });
  });

  it("does not import from project/", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const canonicalDir = path.join(repoRoot, "tests", "eval", "canonical");
    const offenders: string[] = [];
    for (const fileName of fs.readdirSync(canonicalDir)) {
      if (!fileName.endsWith(".ts")) {
        continue;
      }
      const text = fs.readFileSync(path.join(canonicalDir, fileName), "utf8");
      if (text.includes("project/")) {
        offenders.push(fileName);
      }
    }
    expect(offenders).toEqual([]);
  });
});
