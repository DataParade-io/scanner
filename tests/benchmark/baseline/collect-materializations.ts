import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import type { BenchmarkManifest } from "../schema";
import { loadBenchmarkManifest } from "../manifest";
import {
  listBenchmarkRepoKeys,
  resolveMaterializedRepoPath,
} from "../run-benchmark";
import { isMaterializationComplete, readHeadSafely } from "../materialize-paths";
import { readSparseCheckoutContent } from "../materialize-orchestrator";
import type { MaterializedSourceFingerprint } from "./types";

function readHeadFromDir(targetDir: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: targetDir,
    encoding: "utf8",
  }).trim();
}

function isGitRepository(targetDir: string): boolean {
  const gitPath = path.join(targetDir, ".git");
  if (!fs.existsSync(gitPath)) {
    return false;
  }
  try {
    const stat = fs.statSync(gitPath);
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

function validateMaterializationStatus(
  repoKey: string,
  materializedPath: string,
  manifest: BenchmarkManifest,
): MaterializedSourceFingerprint {
  const base = {
    repoKey,
    manifestCommit: manifest.commit,
    validatedHeadSha: null as string | null,
    validationStatus: "missing" as const,
    reason: undefined as string | undefined,
  };

  if (!fs.existsSync(materializedPath)) {
    return { ...base, validationStatus: "missing", reason: "path does not exist" };
  }

  if (!isGitRepository(materializedPath)) {
    return { ...base, validationStatus: "invalid", reason: "not a git repository" };
  }

  const includePaths = manifest.scope.include;
  const headRead = readHeadSafely(() => readHeadFromDir(materializedPath));
  if (headRead.status !== "ok") {
    return {
      ...base,
      validationStatus: "invalid",
      reason: "repository head not available",
    };
  }

  const status = isMaterializationComplete({
    head: headRead.head,
    commit: manifest.commit,
    includePaths,
    exists: (relativePath) =>
      fs.existsSync(path.join(materializedPath, relativePath)),
    isDirectory: (relativePath) =>
      fs.statSync(path.join(materializedPath, relativePath)).isDirectory(),
    sparseCheckoutContent:
      includePaths.length > 0
        ? readSparseCheckoutContent(
            materializedPath,
            (filePath) => fs.existsSync(filePath),
            (filePath, encoding) => fs.readFileSync(filePath, encoding),
          )
        : null,
  });

  if (!status.complete) {
    return {
      repoKey,
      manifestCommit: manifest.commit,
      validatedHeadSha: headRead.head,
      validationStatus: "invalid",
      reason: status.reason ?? "incomplete materialization",
    };
  }

  return {
    repoKey,
    manifestCommit: manifest.commit,
    validatedHeadSha: headRead.head,
    validationStatus: "valid",
  };
}

export function collectMaterializedSources(
  benchmarkRoot: string,
): MaterializedSourceFingerprint[] {
  return listBenchmarkRepoKeys(benchmarkRoot).map((repoKey) => {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);
    const materializedPath = resolveMaterializedRepoPath(repoKey, benchmarkRoot);
    return validateMaterializationStatus(repoKey, materializedPath, manifest);
  });
}
