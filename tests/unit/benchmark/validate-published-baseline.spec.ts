import fs from "fs";
import os from "os";
import path from "path";

import {
  PublishedBaselineValidationError,
  validatePublishedBaseline,
} from "../../benchmark/baseline/validate-published";

const MINIMAL_FIXTURE_JSON = path.join(
  __dirname,
  "../../fixtures/baseline/minimal-baseline-artifact.json",
);

describe("validatePublishedBaseline", () => {
  it("parses the committed minimal smoke fixture without optional gates", () => {
    const result = validatePublishedBaseline({ jsonPath: MINIMAL_FIXTURE_JSON });
    expect(result.artifact.schemaVersion).toBe("baseline-artifact/1");
    expect(result.artifact.readiness.status).toBe("not_evaluated");
    expect(result.markdownPath).toBe(
      path.join(__dirname, "../../fixtures/baseline/minimal-baseline-artifact.md"),
    );
  });

  it("refuses published baselines with missing materializations when required", () => {
    expect(() =>
      validatePublishedBaseline({
        jsonPath: MINIMAL_FIXTURE_JSON,
        requireValidMaterializations: true,
      }),
    ).toThrow(PublishedBaselineValidationError);
  });

  it("refuses digest drift when verifyDigests is enabled", () => {
    expect(() =>
      validatePublishedBaseline({
        jsonPath: MINIMAL_FIXTURE_JSON,
        verifyDigests: true,
      }),
    ).toThrow(/fingerprint digests do not match/i);
  });

  it("verifies deterministic Markdown rendering for the smoke fixture", () => {
    expect(() =>
      validatePublishedBaseline({
        jsonPath: MINIMAL_FIXTURE_JSON,
        verifyMarkdown: true,
      }),
    ).not.toThrow();
  });

  it("accepts a baseline with all-valid materializations when publishing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "published-baseline-"));
    const jsonPath = path.join(tempDir, "published.json");
    const artifact = JSON.parse(fs.readFileSync(MINIMAL_FIXTURE_JSON, "utf8"));
    artifact.fingerprint.materializedSources = [
      {
        repoKey: "fixture-packet",
        manifestCommit: "a".repeat(40),
        validatedHeadSha: "a".repeat(40),
        validationStatus: "valid",
      },
    ];
    fs.writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

    expect(() =>
      validatePublishedBaseline({
        jsonPath,
        requireValidMaterializations: true,
      }),
    ).not.toThrow();
  });
});
