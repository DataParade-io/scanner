import fs from "fs";
import os from "os";
import path from "path";

import {
  digestCorpusGold,
  digestSortedFiles,
  digestStableJson,
} from "../../benchmark/baseline/digests";
import { buildBaselineFingerprint } from "../../benchmark/baseline/fingerprint";

describe("baseline fingerprint digests", () => {
  it("produces stable corpus digests regardless of walk order", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-corpus-"));
    const repoDir = path.join(tempDir, "repos", "alpha");
    const annotationsDir = path.join(repoDir, "annotations");
    fs.mkdirSync(annotationsDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, "manifest.yaml"), "repository: alpha\ncommit: b\n", "utf8");
    fs.writeFileSync(path.join(annotationsDir, "mentions.yaml"), "annotations: []\n", "utf8");

    const digestA = digestCorpusGold(tempDir);
    const digestB = digestCorpusGold(tempDir);
    expect(digestA).toBe(digestB);
    expect(digestA.startsWith("sha256:")).toBe(true);
  });

  it("produces stable corpus digests for absolute and relative benchmark roots", () => {
    const digestFromRelative = digestCorpusGold(path.join(__dirname, "../../benchmark"));
    const digestFromAbsolute = digestCorpusGold(
      path.resolve(path.join(__dirname, "../../benchmark")),
    );
    expect(digestFromRelative).toBe(digestFromAbsolute);
  });

  it("changes digest when corpus file content changes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-corpus-change-"));
    const repoDir = path.join(tempDir, "repos", "beta");
    const annotationsDir = path.join(repoDir, "annotations");
    fs.mkdirSync(annotationsDir, { recursive: true });
    const manifestPath = path.join(repoDir, "manifest.yaml");
    fs.writeFileSync(manifestPath, "repository: beta\ncommit: c\n", "utf8");
    fs.writeFileSync(path.join(annotationsDir, "mentions.yaml"), "annotations: []\n", "utf8");

    const before = digestCorpusGold(tempDir);
    fs.appendFileSync(manifestPath, "# changed\n", "utf8");
    const after = digestCorpusGold(tempDir);
    expect(before).not.toBe(after);
  });

  it("builds fingerprint with materialization status entries", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-fingerprint-"));
    const repoDir = path.join(tempDir, "repos", "gamma");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "manifest.yaml"),
      [
        "repository: gamma",
        `commit: ${"d".repeat(40)}`,
        "license: MIT",
        "scope:",
        "  include: []",
        "coverage:",
        "  layers: [mentions]",
        "  languages: [typescript]",
        "  domains: [fixture]",
        "selection_rationale: test",
        "annotation_version: 1",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(repoDir, "annotations"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "annotations", "mentions.yaml"), "annotations: []\n", "utf8");

    const fingerprint = buildBaselineFingerprint({
      benchmarkRoot: tempDir,
      scannerGitSha: "test-sha",
    });

    expect(fingerprint.scannerGitSha).toBe("test-sha");
    expect(fingerprint.deterministicConfiguration.enableAiInference).toBe(false);
    expect(fingerprint.materializedSources).toHaveLength(1);
    expect(fingerprint.materializedSources[0]?.validationStatus).toBe("missing");
    expect(fingerprint.fingerprintDigest).toBe(digestStableJson({
      scannerGitSha: fingerprint.scannerGitSha,
      corpusGoldDigest: fingerprint.corpusGoldDigest,
      evaluationContractVersion: fingerprint.evaluationContractVersion,
      scorecardVectorContractVersion: fingerprint.scorecardVectorContractVersion,
      taxonomyDigest: fingerprint.taxonomyDigest,
      conceptMapDigest: fingerprint.conceptMapDigest,
      adapterMapDigest: fingerprint.adapterMapDigest,
      dependencyLockDigest: fingerprint.dependencyLockDigest,
      materializedSources: fingerprint.materializedSources,
      reviewStateCounts: fingerprint.reviewStateCounts,
      annotationStatusCounts: fingerprint.annotationStatusCounts,
      deterministicConfiguration: fingerprint.deterministicConfiguration,
      deterministicConfigurationDigest: fingerprint.deterministicConfigurationDigest,
      eligibilityProfile: fingerprint.eligibilityProfile,
    }));
  });

  it("sorts digest inputs for stable file hashing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-sorted-"));
    const fileA = path.join(tempDir, "a.txt");
    const fileB = path.join(tempDir, "b.txt");
    fs.writeFileSync(fileA, "alpha", "utf8");
    fs.writeFileSync(fileB, "beta", "utf8");

    const digest = digestSortedFiles([fileB, fileA]);
    expect(digest).toBe(digestSortedFiles([fileA, fileB]));
    expect(digest.startsWith("sha256:")).toBe(true);
  });
});
