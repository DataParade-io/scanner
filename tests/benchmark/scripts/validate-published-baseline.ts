#!/usr/bin/env node
/**
 * Validate a committed baseline artifact JSON (schema, optional digest/materialization gates).
 * Does not require a series-1 artifact to exist in the repository.
 */
import {
  PublishedBaselineValidationError,
  validatePublishedBaseline,
} from "../baseline/validate-published";

function usage(): void {
  console.log(
    "Usage: node dist/tests/benchmark/scripts/validate-published-baseline.js <baseline.json> [options]",
  );
  console.log("");
  console.log("Options:");
  console.log("  --require-valid-materializations  Fail unless every packet is materialized");
  console.log("  --require-readiness-pass            Fail unless readiness.status=pass");
  console.log("  --verify-digests                  Recompute corpus/taxonomy/concept-map/adapter digests");
  console.log("  --verify-markdown                 Require sibling .md and verify deterministic render");
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const jsonPath = args[0];
  const options = {
    jsonPath,
    requireValidMaterializations: args.includes("--require-valid-materializations"),
    requireReadinessPass: args.includes("--require-readiness-pass"),
    verifyDigests: args.includes("--verify-digests"),
    verifyMarkdown: args.includes("--verify-markdown"),
  };

  try {
    const result = validatePublishedBaseline(options);
    console.log(`Validated baseline artifact: ${jsonPath}`);
    console.log(`  schemaVersion: ${result.artifact.schemaVersion}`);
    console.log(`  readiness.status: ${result.artifact.readiness.status}`);
    if (result.markdownPath) {
      console.log(`  markdown: ${result.markdownPath}`);
    }
  } catch (error) {
    if (error instanceof PublishedBaselineValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

main();
