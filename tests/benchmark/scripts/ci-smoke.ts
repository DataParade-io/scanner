#!/usr/bin/env node
/**
 * PR smoke validation — contract fixtures, baseline rendering, scorecard-vector,
 * computability, and pinned digest checks. Does not clone upstream benchmark packets.
 */
import { execSync } from "child_process";
import path from "path";

import { findPackageRoot } from "../paths";

const SMOKE_SPEC_FILES = [
  "tests/eval/contract/contract.spec.ts",
  "tests/unit/benchmark/baseline-artifact.spec.ts",
  "tests/unit/benchmark/baseline-fingerprint.spec.ts",
  "tests/unit/benchmark/scorecard-vector.spec.ts",
  "tests/unit/benchmark/run-four-layer-scorecard.spec.ts",
  "tests/unit/eval/canonical-computability.spec.ts",
  "tests/unit/benchmark/ci-smoke-digests.spec.ts",
  "tests/unit/benchmark/validate-materializations.spec.ts",
  "tests/unit/benchmark/validate-published-baseline.spec.ts",
  "tests/unit/docs/evaluation-docs-contract.spec.ts",
];

function main(): void {
  const packageRoot = findPackageRoot(__dirname);
  const jestArgs = SMOKE_SPEC_FILES.map((specFile) =>
    path.join(packageRoot, specFile),
  );

  console.log("CI smoke validation (no upstream packet clones):");
  for (const specFile of SMOKE_SPEC_FILES) {
    console.log(`  - ${specFile}`);
  }
  console.log("");

  execSync(`pnpm exec jest ${jestArgs.map((entry) => JSON.stringify(entry)).join(" ")}`, {
    cwd: packageRoot,
    stdio: "inherit",
  });
}

main();
