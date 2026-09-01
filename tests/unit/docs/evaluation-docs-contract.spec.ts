import fs from "fs";
import path from "path";

import {
  COMPUTABILITY_STATES,
  DOCS_REQUIRING_DIAGNOSTIC_RAW_HITS,
  DOCS_REQUIRING_NO_CROSS_LAYER_SCALAR,
  DIAGNOSTIC_LAYERS,
  ELIGIBILITY_REASONS,
  EVALUATION_CONTRACT_VERSIONS,
  EVALUATION_DOC_PATHS,
  FORBIDDEN_DOC_SUBSTRINGS,
  HEADLINE_LAYERS,
} from "../../eval/docs-invariants";
import { findPackageRoot } from "../../benchmark/paths";

const PACKAGE_ROOT = findPackageRoot(__dirname);

function readDoc(relativePath: string): string {
  const absolutePath = path.join(PACKAGE_ROOT, relativePath);
  expect(fs.existsSync(absolutePath)).toBe(true);
  return fs.readFileSync(absolutePath, "utf8");
}

describe("evaluation documentation contract", () => {
  it.each(EVALUATION_DOC_PATHS)("forbids legacy vocabulary in %s", (relativePath) => {
    const content = readDoc(relativePath);
    for (const forbidden of FORBIDDEN_DOC_SUBSTRINGS) {
      expect(content).not.toContain(forbidden);
    }
  });

  it.each(EVALUATION_DOC_PATHS)("names every headline layer in %s", (relativePath) => {
    const content = readDoc(relativePath);
    if (
      relativePath === "CONTRIBUTING_AGENT.md" ||
      relativePath === "project/wiki/eval-flywheel.md"
    ) {
      return;
    }
    for (const layer of HEADLINE_LAYERS) {
      expect(content).toContain(layer);
    }
  });

  it.each(DOCS_REQUIRING_DIAGNOSTIC_RAW_HITS)(
    "states raw-hits is diagnostic in %s",
    (relativePath) => {
      const content = readDoc(relativePath);
      expect(content).toMatch(/diagnostic/i);
      for (const layer of DIAGNOSTIC_LAYERS) {
        expect(content).toContain(layer);
      }
    },
  );

  it.each(DOCS_REQUIRING_NO_CROSS_LAYER_SCALAR)(
    "states no cross-layer scalar in %s",
    (relativePath) => {
      const content = readDoc(relativePath);
      expect(content).toMatch(/cross-layer scalar/i);
    },
  );

  it("documents all eligibility reasons in ground-truth-schema.md", () => {
    const content = readDoc("tests/eval/ground-truth-schema.md");
    for (const reason of ELIGIBILITY_REASONS) {
      expect(content).toContain(reason);
    }
    expect(ELIGIBILITY_REASONS).toHaveLength(11);
  });

  it("documents all computability states in ground-truth-schema.md", () => {
    const content = readDoc("tests/eval/ground-truth-schema.md");
    for (const state of COMPUTABILITY_STATES) {
      expect(content).toContain(state);
    }
    expect(COMPUTABILITY_STATES).toHaveLength(6);
  });

  it("documents scorecard and baseline contract versions in benchmark README", () => {
    const content = readDoc("tests/benchmark/README.md");
    expect(content).toContain(EVALUATION_CONTRACT_VERSIONS.scorecardVector);
    expect(content).toContain(EVALUATION_CONTRACT_VERSIONS.baselineArtifact);
  });

  it("documents scorecard contract version in wiki", () => {
    const content = readDoc("project/wiki/four-layer-evaluation.md");
    expect(content).toContain(EVALUATION_CONTRACT_VERSIONS.scorecardVector);
  });

  it("documents ground-truth schema version in ground-truth-schema.md", () => {
    const content = readDoc("tests/eval/ground-truth-schema.md");
    expect(content).toContain(EVALUATION_CONTRACT_VERSIONS.groundTruthSchema);
  });
});
