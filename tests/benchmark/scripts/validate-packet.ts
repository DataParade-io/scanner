#!/usr/bin/env node
/**
 * Validate agent-written labeling packets before review (KDATAP-8b2c8a).
 *
 *   node dist/tests/benchmark/scripts/validate-packet.js tests/benchmark/repos/ghost/annotations/packets/KDATAP-abc123.yaml
 *
 * The repo must be materialized at its pinned commit (`pnpm run benchmark:materialize <repo>`),
 * and `annotations/packets/<concept>-candidates.yaml` must exist next to the packet.
 * Exits 1 when any packet has errors.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import YAML from "yaml";

import { loadBenchmarkManifest } from "../manifest";
import { loadCandidateLines, validatePacket } from "../packet-validation";
import { resolveDefaultBenchmarkRoot } from "../paths";

const cacheRoot = path.join(resolveDefaultBenchmarkRoot(__dirname), ".cache", "repos");

function readHeadCommit(dir: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function packetConcept(packetPath: string): string | undefined {
  try {
    const parsed = YAML.parse(fs.readFileSync(packetPath, "utf8")) as {
      packet?: { concept?: unknown };
    };
    const concept = parsed?.packet?.concept;
    return typeof concept === "string" ? concept : undefined;
  } catch {
    return undefined;
  }
}

function validateOne(packetArg: string): boolean {
  const packetPath = path.resolve(packetArg);
  const packetsDir = path.dirname(packetPath);
  const repoDir = path.dirname(path.dirname(packetsDir));
  const repoKey = path.basename(repoDir);
  const manifest = loadBenchmarkManifest(repoDir);

  const concept = packetConcept(packetPath);
  const candidatesPath = concept
    ? path.join(packetsDir, `${concept}-candidates.yaml`)
    : undefined;
  const candidates =
    candidatesPath && fs.existsSync(candidatesPath)
      ? loadCandidateLines(candidatesPath)
      : undefined;

  const result = validatePacket(packetPath, candidates, {
    sourceRoot: path.join(cacheRoot, `${repoKey}@${manifest.commit}`),
    pinnedCommit: manifest.commit,
    readHeadCommit,
  });
  if (concept && !candidates) {
    result.warnings = result.warnings.filter((warning) => !warning.startsWith("No candidate file"));
    result.errors.push(
      `Missing ${concept}-candidates.yaml in ${packetsDir}; run the candidate inventory first`,
    );
  }

  console.log(`${packetArg}: ${result.recordCount} records, ${result.candidateCount} candidates`);
  for (const warning of result.warnings) {
    console.log(`  warning: ${warning}`);
  }
  for (const error of result.errors) {
    console.log(`  error: ${error}`);
  }
  console.log(result.errors.length === 0 ? "  OK" : `  FAILED (${result.errors.length} errors)`);
  return result.errors.length === 0;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: node dist/tests/benchmark/scripts/validate-packet.js <packet.yaml>...");
    process.exit(2);
  }
  const results = args.map(validateOne);
  process.exit(results.every(Boolean) ? 0 : 1);
}

main();
