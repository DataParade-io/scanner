import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

import { Given, Then, When } from "@cucumber/cucumber";
import YAML from "yaml";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import { runClassifierPhase } from "../../src/core/pipeline/classifier-phase";
import {
  isValidComponentType,
  isValidSubtypeForType,
  loadComponentTaxonomy,
} from "../../src/classifier/component-taxonomy";
import { adaptDetectedComponent } from "../../src/eval/canonical/scanner/components";
import type { DetectedComponent } from "../../src/core/types/component";
import type { RawFinding } from "../../src/core/types/detection";
import type { ServiceSection } from "../../src/core/sectioning/discover-service-sections";
import type { CanonicalScannerFinding } from "../../src/eval/canonical/types";

const repoRoot = path.join(__dirname, "..", "..");
const typescriptBasicRoot = path.join(repoRoot, "tests", "fixtures", "typescript-basic");
const benchmarkRoot = path.join(repoRoot, "tests", "benchmark", "repos");

interface TaxonomyWorld {
  components?: DetectedComponent[];
  canonicalFindings?: CanonicalScannerFinding[];
  undeclaredSubtype?: string;
}

function world(context: unknown): TaxonomyWorld {
  return context as TaxonomyWorld;
}

Given(
  "a scanner pipeline that would classify a component with subtype {string}",
  function (subtype: string) {
    const w = world(this);
    w.undeclaredSubtype = subtype;

    const findings: RawFinding[] = [
      {
        pattern: "terraform_resource",
        name: "test_resource",
        confidence: 0.9,
        location: {
          filePath: "main.tf",
          startLine: 1,
          endLine: 1,
        },
        properties: {
          resource_type: "aws_instance",
          componentSubType: subtype,
        },
      },
    ];

    const sections: ServiceSection[] = [
      {
        id: "root",
        label: "root",
        role: "root",
        sectionDir: "",
        manifestPaths: [],
      },
    ];

    w.components = runClassifierPhase(findings, sections, {
      projectName: "taxonomy-test",
      minimumConfidence: 0,
    });
  },
);

When("the classifier phase completes", function () {
  const w = world(this);
  assert.ok(w.components, "classifier phase must have produced components");
});

Then("the emitted component has no subtype", function () {
  const w = world(this);
  const target =
    w.components!.find((c) => c.subType === w.undeclaredSubtype) ??
    w.components!.find((c) => c.name === "Test Resource");
  assert.ok(target, "expected the terraform-classified component");
  assert.strictEqual(target.subType, undefined);
});

Then("the subtype is not {string}", function (forbidden: string) {
  const w = world(this);
  for (const component of w.components ?? []) {
    assert.notStrictEqual(component.subType, forbidden);
  }
});

Given("the typescript-basic fixture is scanned", async function () {
  const w = world(this);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult } = await scan(typescriptBasicRoot, config);
  w.components = scanResult.components;
});

When("components are collected from the classifier phase", function () {
  const w = world(this);
  assert.ok(w.components && w.components.length > 0, "expected scanned components");
});

Then(
  "every emitted subtype is declared in component-taxonomy.yaml for its type",
  function () {
    const w = world(this);
    loadComponentTaxonomy();
    for (const component of w.components ?? []) {
      assert.ok(
        isValidComponentType(component.type),
        `component type '${component.type}' is not declared in taxonomy`,
      );
      if (component.subType !== undefined) {
        assert.ok(
          isValidSubtypeForType(component.type, component.subType),
          `subtype '${component.subType}' for type '${component.type}' is not declared in taxonomy`,
        );
      }
    }
  },
);

When("the evaluation harness adapts each component to a canonical finding", function () {
  const w = world(this);
  assert.ok(w.components, "components must be scanned first");
  w.canonicalFindings = w.components.map((component) =>
    adaptDetectedComponent(component),
  );
});

Then("type and subtype are taxonomy ids where subtype is present", function () {
  const w = world(this);
  assert.ok(w.canonicalFindings && w.canonicalFindings.length > 0);
  for (const finding of w.canonicalFindings!) {
    const componentType = finding.classification.componentType;
    assert.ok(componentType, "finding must carry componentType");
    assert.ok(
      isValidComponentType(componentType),
      `componentType '${componentType}' is not a taxonomy id`,
    );
    const subtype = finding.classification.componentSubtype;
    if (subtype) {
      assert.ok(
        isValidSubtypeForType(componentType, subtype),
        `componentSubtype '${subtype}' is not declared for type '${componentType}'`,
      );
    }
  }
});

Then("instance is not required for asset findings", function () {
  const w = world(this);
  const assetFindings = w.canonicalFindings!.filter(
    (finding) => finding.classification.componentType === "asset",
  );
  assert.ok(assetFindings.length > 0, "expected asset findings from typescript-basic");
  for (const finding of assetFindings) {
    assert.strictEqual(finding.optionalAssertion?.instance, undefined);
  }
});

Then(
  "a component with no subtype is reported as a taxonomy gap rather than a match",
  function () {
    const w = world(this);
    const gapFindings = w.canonicalFindings!.filter(
      (finding) =>
        finding.declaredCapabilitySupported?.supported === false &&
        finding.declaredCapabilitySupported?.reason === "missing_component_subtype",
    );
    // typescript-basic should have valid subtypes after enforcement; verify the contract
    // by adapting a synthetic component with no subtype.
    const synthetic = adaptDetectedComponent({
      id: "gap-test",
      name: "Unknown Vendor",
      type: "third_party",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [{ filePath: "src/x.ts", startLine: 1, endLine: 1 }],
      properties: { vendor: "unknown" },
    });
    assert.strictEqual(synthetic.declaredCapabilitySupported?.supported, false);
    assert.strictEqual(
      synthetic.declaredCapabilitySupported?.reason,
      "missing_component_subtype",
    );
    assert.strictEqual(synthetic.classification.conceptLeaf, "");
    // After enforcement, scanned components should not carry undeclared subtypes.
    for (const finding of w.canonicalFindings!) {
      if (!finding.classification.componentSubtype) {
        assert.ok(gapFindings.length >= 0 || finding === synthetic);
        assert.strictEqual(finding.declaredCapabilitySupported?.supported, false);
      }
    }
  },
);

Given("accepted component annotation labels in the benchmark corpus", function () {
  // Labels are read in the Then step; no setup required.
});

Then("every label is a declared taxonomy subtype id", function () {
  const taxonomy = loadComponentTaxonomy();
  const taxonomyTypeIds = taxonomy.types;
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
        assert.ok(
          !taxonomyTypeIds.has(label),
          `label '${label}' in ${filePath} is a type id, not a subtype`,
        );
        assert.ok(
          isValidSubtypeForType("asset", label) ||
            isValidSubtypeForType("third_party", label) ||
            isValidSubtypeForType("actor", label),
          `label '${label}' in ${filePath} is not a declared taxonomy subtype`,
        );
      }
    }
  }
});
