import path from "path";

import {
  evaluateLayerBucket,
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  withId,
  sampleEvidence,
} from "../../eval/canonical";

describe("published eval boundary", () => {
  it("evaluateLayerBucket scores a minimal positive match via canonical types", () => {
    const evidence = sampleEvidence("src/app.ts", 5, 5);
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: [evidence],
      }),
      "gold-1",
    );
    const finding = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: [evidence],
      }),
      "finding-1",
    );

    const report = evaluateLayerBucket({
      layer: "mentions",
      expectations: [expectation],
      findings: [finding],
      expectationMeta: [
        {
          id: "gold-1",
          unread: false,
          documentedGap: false,
          isNegative: false,
          isPositive: true,
          isRecallEvaluable: true,
          expectedLabels: [],
        },
      ],
    });

    expect(report.scores.recall).toBe(1);
    expect(report.perExpectation[0]?.matched).toBe(true);
  });

  it("loads built dist/src/eval/index.js after compile", () => {
    const distEntry = path.join(__dirname, "../../../dist/src/eval/index.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const published = require(distEntry) as typeof import("../../../src/eval");
    expect(typeof published.evaluateLayerBucket).toBe("function");
    expect(published.CANONICAL_CONTRACT_VERSION).toBeDefined();
  });
});
