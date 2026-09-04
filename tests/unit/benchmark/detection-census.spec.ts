import type { DetectedComponent } from "../../../src/core/types/component";
import fs from "fs";
import type { LayerFinding } from "../../eval/types";
import {
  buildComponentIdentitySet,
  buildDetectionCensusRow,
  componentFindingIdentityHybrid,
  componentFindingIdentityTypeName,
  componentFindingIdentityTypeSubType,
  componentIdentityHybrid,
  componentIdentityTypeName,
  componentIdentityTypeSubType,
  countMatchedGoldPositives,
  loadAcceptedComponentGoldPositives,
  preflightMaterializedRepos,
  assertAllMaterialized,
} from "../../benchmark/detection-census";
import type { AnnotationRecord } from "../../benchmark/schema";
import type { FixtureScanResult } from "../../eval/types";
import { createLayerLedger } from "../../eval/eligibility/types";
import { layerOutcome } from "../../../src/ingest/eligibility";
import { MaterializationMissingError, listBenchmarkRepoKeys, resolveMaterializedRepoPath } from "../../benchmark/run-benchmark";

function component(overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "name" | "type">): DetectedComponent {
  return {
    id: "c1",
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

function componentFinding(key: string, labels: string[]): LayerFinding {
  return {
    key,
    labels,
    layer: "components",
    sourceFilePaths: ["src/app.ts"],
    sourceLines: [{ file_path: "src/app.ts", start_line: 1, end_line: 1 }],
  };
}

function goldPositive(key: string): AnnotationRecord {
  return {
    id: "gold-1",
    layer: "components",
    subject: { key },
    evidence: { file_path: "src/app.ts", start_line: 1, end_line: 1 },
    rationale: "test",
    expected: { status: "positive", labels: ["database"] },
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-08-31",
      review_state: "accepted",
    },
  };
}

describe("detection census", () => {
  it("derives scheme A/B/C keys from DetectedComponent fixtures", () => {
    const asset = component({
      type: "asset",
      name: "Django ORM",
      subType: "database",
    });
    const vendor = component({
      type: "third_party",
      name: "Stripe",
      subType: "payment_processor",
    });

    expect(componentIdentityTypeName(asset)).toBe("asset:django orm");
    expect(componentIdentityTypeSubType(asset)).toBe("asset:database");
    expect(componentIdentityHybrid(asset)).toBe("asset:database");

    expect(componentIdentityTypeName(vendor)).toBe("third_party:stripe");
    expect(componentIdentityTypeSubType(vendor)).toBe("third_party:payment_processor");
    expect(componentIdentityHybrid(vendor)).toBe("third_party:stripe");
  });

  it("derives scheme keys from component findings", () => {
    const finding = componentFinding("asset:django orm", ["asset", "database"]);

    expect(componentFindingIdentityTypeName(finding)).toBe("asset:django orm");
    expect(componentFindingIdentityTypeSubType(finding)).toBe("asset:database");
    expect(componentFindingIdentityHybrid(finding)).toBe("asset:database");
  });

  it("counts identity-only gold matches via set membership", () => {
    const findings = [
      componentFinding("asset:django orm", ["asset", "database"]),
      componentFinding("third_party:stripe", ["third_party", "payment_processor"]),
      componentFinding("actor:user", ["actor", "customer"]),
    ];
    const gold = [
      goldPositive("asset:database"),
      goldPositive("third_party:stripe"),
      goldPositive("actor:customer"),
    ];

    expect(countMatchedGoldPositives(gold, buildComponentIdentitySet(findings, "type_name"))).toBe(1);
    expect(countMatchedGoldPositives(gold, buildComponentIdentitySet(findings, "type_subtype"))).toBe(2);
    expect(countMatchedGoldPositives(gold, buildComponentIdentitySet(findings, "hybrid"))).toBe(3);
  });

  it("builds census rows from scan results without scoring", () => {
    const scanResult: FixtureScanResult = {
      fixture: "easy-school",
      scannedFiles: ["students/models.py", "students/views.py"],
      eligibilityLedgers: {
        components: createLayerLedger("components", [
          layerOutcome("students/models.py", "successfully_processed"),
          layerOutcome("students/views.py", "successfully_processed"),
        ]),
      },
      findings: [
        componentFinding("asset:django orm", ["asset", "database"]),
        {
          key: "flow:a->b",
          labels: ["api_call"],
          layer: "data-flows",
          sourceFilePaths: ["students/views.py"],
          sourceLines: [{ file_path: "students/views.py", start_line: 2, end_line: 2 }],
        },
        {
          key: "mention:email",
          labels: ["email"],
          layer: "mentions",
          sourceFilePaths: ["students/models.py"],
          sourceLines: [{ file_path: "students/models.py", start_line: 3, end_line: 3 }],
        },
      ],
    };

    const row = buildDetectionCensusRow(
      "easy-school",
      scanResult,
      [goldPositive("asset:database"), goldPositive("actor:customer")],
      "a".repeat(40),
      ["students/"],
    );

    expect(row.filesIngested).toBe(2);
    expect(row.componentsEmitted).toBe(1);
    expect(row.dataFlowsEmitted).toBe(1);
    expect(row.componentGoldPositives).toBe(2);
    expect(row.matchedTypeName).toBe(0);
    expect(row.matchedTypeSubtype).toBe(1);
    expect(row.matchedHybrid).toBe(1);
    expect(row.zeroComponents).toBe(false);
  });

  it("preflight fails closed when materialization is missing", () => {
    const repoKey = "easy-school";
    const expectedPath = resolveMaterializedRepoPath(repoKey);
    const originalExistsSync = fs.existsSync.bind(fs);
    const existsSpy = jest.spyOn(fs, "existsSync").mockImplementation((target) => {
      if (target === expectedPath) {
        return false;
      }
      return originalExistsSync(target);
    });

    try {
      const { missing } = preflightMaterializedRepos([repoKey]);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toBeInstanceOf(MaterializationMissingError);
      expect(missing[0]?.repoKey).toBe(repoKey);

      expect(() => assertAllMaterialized([repoKey])).toThrow(
        /Detection census preflight failed/,
      );
    } finally {
      existsSpy.mockRestore();
    }
  });

  it("loads only accepted component positives for gold denominators", () => {
    const repoKey = listBenchmarkRepoKeys()[0];
    const positives = loadAcceptedComponentGoldPositives(repoKey);
    expect(positives.every((annotation) => annotation.expected.status === "positive")).toBe(true);
    expect(
      positives.every((annotation) => annotation.provenance.review_state === "accepted"),
    ).toBe(true);
  });
});
