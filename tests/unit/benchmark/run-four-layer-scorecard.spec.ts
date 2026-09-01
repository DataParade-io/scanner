import fs from "fs";
import os from "os";
import path from "path";

import { runFourLayerScorecard } from "../../benchmark/run-four-layer-scorecard";
import { SCORECARD_VECTOR_CONTRACT_VERSION } from "../../benchmark/scorecard-vector";
import type { EvalCase, EvalScoreReport, EvalScores, FixtureScanResult } from "../../eval/types";
import { computeMetricComputability } from "../../eval/canonical/computability";
import { createLayerLedger } from "../../eval/eligibility/types";
import { layerOutcome } from "../../../src/ingest/eligibility";

const FIXTURE = "scorecard-packet";

function withMetricComputability(
  scores: Omit<EvalScores, "metricComputability">,
  layer: EvalCase["layer"],
  options: {
    positiveCaseCount?: number;
    reviewedScopeFileCount?: number;
    processedScopeFileCount?: number;
  } = {},
): EvalScoreReport {
  const {
    positiveCaseCount = scores.denominators.evaluablePositives,
    reviewedScopeFileCount = scores.denominators.exhaustiveScopedFindings > 0 ? 1 : 0,
    processedScopeFileCount = scores.denominators.exhaustiveScopedFindings > 0 ? 1 : 0,
  } = options;

  return {
    scores: {
      ...scores,
      metricComputability: computeMetricComputability({
        layer,
        denominators: scores.denominators,
        scope: { reviewedScopeFileCount, processedScopeFileCount },
        recall: scores.recall,
        precision: scores.precision,
        negativeCasePassRate: scores.negativeCasePassRate,
        positiveCaseCount,
        unreadPositiveCount: 0,
        negativeCaseCount: scores.denominators.negativeCases,
        unreadNegativeCount: 0,
        locationlessFindingCount: 0,
      }),
    },
    caseResults: [],
  };
}

function evalCase(layer: EvalCase["layer"], id: string): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer,
    subject: { key: `${layer}:${id}` },
    evidence: { file_path: "src/app.ts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["label"] },
    rationale: "test",
  };
}

function scanResult(): FixtureScanResult {
  return {
    fixture: FIXTURE,
    findings: [],
    scannedFiles: ["src/app.ts"],
    eligibilityLedgers: {
      mentions: createLayerLedger("mentions", [
        layerOutcome("src/app.ts", "successfully_processed"),
      ]),
      "data-flows": createLayerLedger("data-flows", [
        layerOutcome("src/app.ts", "successfully_processed"),
      ]),
    },
  };
}

jest.mock("../../benchmark/run-benchmark", () => {
  const actual = jest.requireActual("../../benchmark/run-benchmark");
  return {
    ...actual,
    runBenchmark: jest.fn(),
  };
});

import { runBenchmark } from "../../benchmark/run-benchmark";

const mockedRunBenchmark = runBenchmark as jest.MockedFunction<typeof runBenchmark>;

describe("run-four-layer-scorecard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scorecard-run-"));
    mockedRunBenchmark.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a four-layer scorecard vector from benchmark packets", async () => {
    mockedRunBenchmark.mockResolvedValue([
      {
        repoKey: FIXTURE,
        materializedPath: "/tmp/materialized",
        evalCases: [evalCase("mentions", "m1"), evalCase("data-flows", "f1")],
        scanResult: scanResult(),
        layerScores: {
          mentions: withMetricComputability(
            {
              recall: 1,
              labelAccuracy: 1,
              correctLabelRecall: 1,
              precision: null,
              negativeCasePassRate: null,
              unreadCount: 0,
              denominators: {
                evaluablePositives: 1,
                matchedPositives: 1,
                matchedWithCorrectLabels: 1,
                negativeCases: 0,
                negativeCasesPassed: 0,
                exhaustiveScopedFindings: 0,
                exhaustiveScopedMatches: 0,
              },
            },
            "mentions",
          ),
          "data-flows": withMetricComputability(
            {
              recall: null,
              labelAccuracy: null,
              correctLabelRecall: null,
              precision: 0,
              negativeCasePassRate: null,
              unreadCount: 0,
              denominators: {
                evaluablePositives: 0,
                matchedPositives: 0,
                matchedWithCorrectLabels: 0,
                negativeCases: 0,
                negativeCasesPassed: 0,
                exhaustiveScopedFindings: 2,
                exhaustiveScopedMatches: 0,
              },
            },
            "data-flows",
            {
              positiveCaseCount: 1,
              reviewedScopeFileCount: 1,
              processedScopeFileCount: 1,
            },
          ),
        },
      },
    ]);

    const vector = await runFourLayerScorecard({ repoKeys: [FIXTURE] });

    expect(vector.contractVersion).toBe(SCORECARD_VECTOR_CONTRACT_VERSION);
    expect(vector.layers.mentions.gate.status).toBe("scorable");
    expect(vector.layers["data-flows"].gate.status).toBe("pending");
    expect(vector.layers["data-flows"].scores.recall).toBeNull();
    expect(vector.packets).toHaveLength(1);
    expect(vector.diagnostic["raw-hits"].scores.recall).toBeNull();
  });
});
