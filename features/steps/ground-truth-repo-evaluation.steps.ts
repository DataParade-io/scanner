import assert from "node:assert";
import { join } from "node:path";

import { Given, setDefaultTimeout, Then, When } from "@cucumber/cucumber";

import { loadAnnotations, loadBenchmarkManifest } from "../../tests/benchmark/manifest";
import {
  assertMaterialized,
  MaterializationMissingError,
} from "../../tests/benchmark/run-benchmark";
import { MaterializationInvalidError } from "../../tests/benchmark/validate-materialization";
import { scanRepoByManifestLayers } from "../../tests/benchmark/scan-repo";
import { annotationsToEvalCases } from "../../tests/benchmark/to-eval-cases";
import { scoreEvalCases } from "../../tests/eval/score";
import type { EvalCaseResult, FixtureScanResult, LayerFinding } from "../../tests/eval/types";

setDefaultTimeout(180_000);

const repoRoot = join(__dirname, "..", "..");
const reposRoot = join(repoRoot, "tests", "benchmark", "repos");

const SSN_DATA_ITEM_KEYS = new Set(["data_item:ssn", "data_item:social_security_number"]);
const SSN_LABELS = new Set(["ssn", "social_security_number"]);

interface GroundTruthWorld {
  repoKey?: string;
  repoDir?: string;
  materializedPath?: string;
  scanResult?: FixtureScanResult;
  goldCaseId?: string;
  goldCaseResult?: EvalCaseResult;
}

function getWorld(context: unknown): GroundTruthWorld {
  return context as GroundTruthWorld;
}

function packetDir(repoKey: string): string {
  return join(reposRoot, repoKey);
}

function isSsnDataItem(finding: LayerFinding): boolean {
  if (finding.layer !== undefined && finding.layer !== "data-items") {
    return false;
  }
  if (SSN_DATA_ITEM_KEYS.has(finding.key.trim().toLowerCase())) {
    return true;
  }
  return finding.labels.some((label) => SSN_LABELS.has(label.trim().toLowerCase()));
}

function tryMaterializePath(repoKey: string): string | undefined {
  try {
    return assertMaterialized(repoKey);
  } catch (error) {
    if (
      error instanceof MaterializationMissingError ||
      error instanceof MaterializationInvalidError
    ) {
      return undefined;
    }
    throw error;
  }
}

Given("the {string} benchmark packet", function (repoKey: string) {
  const w = getWorld(this);
  w.repoKey = repoKey;
  w.repoDir = packetDir(repoKey);
  loadBenchmarkManifest(w.repoDir);
});

Given(
  "the pinned {string} repository known to track SSNs",
  function (repoKey: string) {
    const materializedPath = tryMaterializePath(repoKey);
    if (!materializedPath) {
      return "skipped";
    }

    const w = getWorld(this);
    w.repoKey = repoKey;
    w.repoDir = packetDir(repoKey);
    w.materializedPath = materializedPath;
  },
);

Given("accepted gold for easy-school-guardian-ssn", function () {
  const w = getWorld(this);
  assert.strictEqual(w.repoKey, "easy-school", "SSN gold case is on easy-school");
  assert.ok(w.repoDir, "benchmark packet must be loaded");

  const annotations = loadAnnotations(w.repoDir, "data_items");
  const gold = annotations.find((annotation) => annotation.id === "easy-school-guardian-ssn");
  assert.ok(gold, "expected accepted gold easy-school-guardian-ssn");
  assert.strictEqual(gold.provenance.review_state, "accepted");
  assert.strictEqual(gold.expected.status, "positive");
  w.goldCaseId = gold.id;
});

When("I run the scanner data-items evaluation layer", async function () {
  const w = getWorld(this);
  assert.ok(w.repoKey, "repo key must be set");
  assert.ok(w.materializedPath, "materialized path must be set");

  w.scanResult = await scanRepoByManifestLayers(w.repoKey, w.materializedPath, [
    "data_items",
  ]);
});

When("I score the data-items layer against the scan", async function () {
  const w = getWorld(this);
  assert.ok(w.repoKey, "repo key must be set");
  assert.ok(w.repoDir, "benchmark packet must be loaded");
  assert.ok(w.materializedPath, "materialized path must be set");
  assert.ok(w.goldCaseId, "gold case id must be set");

  if (!w.scanResult) {
    w.scanResult = await scanRepoByManifestLayers(w.repoKey, w.materializedPath, [
      "data_items",
    ]);
  }

  const cases = annotationsToEvalCases(
    loadAnnotations(w.repoDir, "data_items"),
    w.repoKey,
  ).filter((evalCase) => evalCase.id === w.goldCaseId);
  assert.strictEqual(cases.length, 1, `expected one eval case for ${w.goldCaseId}`);

  const report = scoreEvalCases(cases, [w.scanResult]);
  w.goldCaseResult = report.caseResults.find((result) => result.caseId === w.goldCaseId);
});

Then("its manifest pins {string}", function (github: string) {
  const w = getWorld(this);
  assert.ok(w.repoDir, "benchmark packet must be loaded");
  const manifest = loadBenchmarkManifest(w.repoDir);
  assert.strictEqual(manifest.repository, github);
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
});

Then("accepted gold includes a social_security_number data item", function () {
  const w = getWorld(this);
  assert.ok(w.repoDir, "benchmark packet must be loaded");

  const accepted = loadAnnotations(w.repoDir, "data_items").filter(
    (annotation) =>
      annotation.provenance.review_state === "accepted" &&
      annotation.expected.status === "positive",
  );
  const ssn = accepted.find((annotation) => {
    const labels = annotation.expected.labels.map((label) => label.toLowerCase());
    const key = annotation.subject.key.toLowerCase();
    const proposed = annotation.candidate?.kind === "data_item"
      ? annotation.candidate.proposed_identity_key.toLowerCase()
      : "";
    return (
      labels.includes("social_security_number") ||
      key === "data_item:social_security_number" ||
      key === "data_item:ssn" ||
      proposed === "data_item:ssn"
    );
  });

  assert.ok(
    ssn,
    "expected an accepted social_security_number data-item annotation",
  );
});

Then("I should get an SSN data item", function () {
  const w = getWorld(this);
  assert.ok(w.scanResult, "scan result must be present");
  const ssn = w.scanResult.findings.find(isSsnDataItem);
  assert.ok(
    ssn,
    `expected a data-items SSN finding among: ${w.scanResult.findings
      .map((finding) => finding.key)
      .join(", ")}`,
  );
});

Then("the SSN case is a match", function () {
  const w = getWorld(this);
  assert.ok(w.goldCaseResult, "gold case result must be present");
  assert.strictEqual(w.goldCaseResult.unread, false, "SSN evidence must have been ingested");
  assert.strictEqual(w.goldCaseResult.matched, true, "accepted SSN gold must match a finding");
});
