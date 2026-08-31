import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const featurePath = join(
  repoRoot,
  "features",
  "canonical-evaluation-representation.feature",
);
const canonicalDocPath = join(repoRoot, "tests", "eval", "canonical-representation.md");
const groundTruthSchemaPath = join(repoRoot, "tests", "eval", "ground-truth-schema.md");

const REQUIRED_SCENARIOS = [
  "Gold and scanner findings meet in one representation",
  "Legacy observed text cannot rescue a mismatch",
  "Strict correctness uses asserted fields only",
  "Same-subtype components retain cardinality",
  "An ancestor concept is not an exact match",
  "Mention legacy name is preserved as an observed token candidate",
  "Consolidated data item preserves every evidence-linked observed token",
  "Contradictory observed tokens require adjudication",
  "Asset display name is evidence not asserted instance",
  "Third-party legacy name is a vendor candidate validated against asserted vendor",
  "Flow legacy name is migration provenance only",
  "Strict success requires only fields gold asserts",
  "Subtype-only asset expectation does not require legacy display name",
  "Asserted third-party vendor is required for strict match",
  "Vendor-resolution metrics use a vendor-asserting denominator",
  "Optional instance is not used to distinguish same-subtype entities",
  "Gold entity id is migration bookkeeping not a scanner field",
  "Repository entities consolidate before one-to-one assignment",
  "Distinct same-subtype entities are not collapsed",
  "Evidence-location coverage is reported separately from entity recall",
  "Ambiguous same-subtype grouping is needs_adjudication",
  "Assignment does not guess between indistinguishable same-subtype entities",
  "Legacy accepted flow rows start as needs_adjudication",
  "Flow display text is not an endpoint identity field",
  "Declared capability unsupported is still a strict false negative",
  "Capability coverage does not change the recall denominator",
  "Source-token-only legacy rows are migration-incomplete not baseline false negatives",
] as const;

const RULING_ISSUE_IDS = [
  "KDATAP-b18135",
  "KDATAP-95cfe1",
  "KDATAP-00e64a",
  "KDATAP-471fdc",
  "KDATAP-32c089",
  "KDATAP-4d9b30",
] as const;

const REQUIRED_DOC_HEADINGS = [
  "## Contract envelope",
  "## Core field groups",
  "## Per-layer legacy `subject.name` treatment",
  "## Component entity model",
  "## Flow disposition",
  "## Capability coverage",
  "## Concept correctness",
  "## Adapter contract",
] as const;

function parseScenarioTitles(featureSource: string): string[] {
  const titles: string[] = [];
  const scenarioPattern = /^\s*Scenario:\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = scenarioPattern.exec(featureSource)) !== null) {
    titles.push(match[1].trim());
  }
  return titles;
}

describe("canonical representation behaviour spec", () => {
  const featureSource = readFileSync(featurePath, "utf8");
  const canonicalDoc = readFileSync(canonicalDocPath, "utf8");
  const groundTruthSchema = readFileSync(groundTruthSchemaPath, "utf8");

  it("declares Feature: Canonical evaluation representation", () => {
    expect(featureSource).toMatch(/^@canonical-ir-spec\s*\nFeature: Canonical evaluation representation/m);
  });

  it("tags the feature with @canonical-ir-spec", () => {
    expect(featureSource).toContain("@canonical-ir-spec");
  });

  it("lists all 27 required scenarios", () => {
    const titles = parseScenarioTitles(featureSource);
    expect(titles).toHaveLength(27);
    expect(titles).toEqual([...REQUIRED_SCENARIOS]);
  });

  it("annotates scenarios with source issue comments", () => {
    for (const issueId of RULING_ISSUE_IDS) {
      expect(featureSource).toContain(`# Source: ${issueId}`);
    }
  });

  it("documents required sections in canonical-representation.md", () => {
    for (const heading of REQUIRED_DOC_HEADINGS) {
      expect(canonicalDoc).toContain(heading);
    }
  });

  it("references every ruling issue in the canonical doc", () => {
    for (const issueId of RULING_ISSUE_IDS) {
      expect(canonicalDoc).toContain(issueId);
    }
  });

  it("links ground-truth-schema.md to the canonical representation doc", () => {
    expect(groundTruthSchema).toContain("canonical-representation.md");
    expect(groundTruthSchema).toMatch(/legacy/i);
  });
});
