import fs from "fs/promises";
import * as path from "path";

import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { matchPatterns } from "../../patterns/engine";
import {
  type ManifestScanBudgetOptions,
  budgetStateFromOptions,
} from "../shared/manifest-budgets";
import { walkForManifests } from "../shared/manifest-fs";
import {
  parseGemfile,
  parseGemfileLockVersions,
} from "./manifest-parsers";

export interface RubyManifestDependency {
  name: string;
  version?: string;
}

export interface RubyManifestPackages {
  manifestRelativePath: string;
  dependencies: RubyManifestDependency[];
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "ruby",
    size: 0,
  };
}

export async function parseRubyDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RubyManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifestPaths: string[] = [];
  const state = budgetStateFromOptions(opts);

  await walkForManifests(rootDir, manifestPaths, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) => {
      const name = path.basename(entryPath).toLowerCase();
      return name === "gemfile" || name === "gemfile.lock";
    },
  });

  const pathsByDirectory = new Map<
    string,
    { gemfile?: string; lockfile?: string }
  >();
  for (const manifestPath of manifestPaths) {
    const directory = path.dirname(manifestPath);
    const entry = pathsByDirectory.get(directory) ?? {};
    if (path.basename(manifestPath).toLowerCase() === "gemfile") {
      entry.gemfile = manifestPath;
    } else {
      entry.lockfile = manifestPath;
    }
    pathsByDirectory.set(directory, entry);
  }

  const manifests: RubyManifestPackages[] = [];
  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const pair of pathsByDirectory.values()) {
    if (!pair.gemfile || bytesRead >= maxBytes) continue;

    const gemfileRaw = await fs.readFile(pair.gemfile, "utf8").catch(() => "");
    bytesRead += gemfileRaw.length;
    if (!gemfileRaw) continue;

    let lockedVersions = new Map<string, string>();
    if (pair.lockfile && bytesRead < maxBytes) {
      const lockRaw = await fs.readFile(pair.lockfile, "utf8").catch(() => "");
      bytesRead += lockRaw.length;
      lockedVersions = parseGemfileLockVersions(lockRaw);
    }

    const dependencies = parseGemfile(gemfileRaw).map(({ name }) => ({
      name,
      version: lockedVersions.get(name),
    }));
    if (dependencies.length === 0) continue;

    manifests.push({
      manifestRelativePath: toPosixPath(
        path.relative(rootDir, pair.gemfile),
      ),
      dependencies,
    });
  }

  return manifests;
}

export async function detectRubyPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifests = await parseRubyDependencyManifests(rootPath, opts);
  const findings: RawFinding[] = [];

  for (const manifest of manifests) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    for (const dependency of manifest.dependencies) {
      const detected = matchPatterns({
        language: "ruby",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports: [
          {
            module: dependency.name,
            names: [dependency.name],
          },
        ],
      });

      findings.push(
        ...detected.map((finding) => ({
          ...finding,
          properties: {
            ...finding.properties,
            sourceContext: "dependency_manifest",
            packageName: dependency.name,
            ...(dependency.version
              ? { packageVersion: dependency.version }
              : {}),
          },
        })),
      );
    }
  }

  return findings;
}
