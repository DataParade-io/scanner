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
import { cargoCrateModule, parseCargoToml } from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface RustManifestPackages {
  manifestRelativePath: string;
  packageName?: string;
  crates: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "rust",
    size: 0,
  };
}

export async function parseRustDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RustManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      path.basename(entryPath).toLowerCase() === "cargo.toml",
  });

  const byManifest: RustManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;

    const manifestRelativePath = toPosixPath(
      path.relative(rootDir, manifestAbsPath),
    );

    let raw: string;
    try {
      raw = await fs.readFile(manifestAbsPath, "utf8");
    } catch {
      continue;
    }
    bytesRead += raw.length;

    const parsed = parseCargoToml(raw);
    if (parsed.crates.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packageName: parsed.name,
      crates: Array.from(new Set(parsed.crates)),
    });
  }

  return byManifest;
}

export async function detectRustPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parseRustDependencyManifests(rootPath, opts);
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.crates.map((crateName) => {
      const module = cargoCrateModule(crateName);
      return {
        module,
        names: Array.from(new Set([crateName, module])),
      };
    });

    findings.push(
      ...matchPatterns({
        language: "rust",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}
