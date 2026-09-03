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
  bundlerGemModule,
  parseGemfile,
  parseGemfileLock,
} from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface RubyManifestPackages {
  manifestRelativePath: string;
  gems: string[];
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
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) => {
      const base = path.basename(entryPath);
      return base === "Gemfile" || base === "Gemfile.lock";
    },
  });

  // Group Gemfile + Gemfile.lock by directory so one app yields one finding set.
  const byDir = new Map<string, { gemfile?: string; lock?: string }>();

  for (const abs of manifests) {
    const rel = toPosixPath(path.relative(rootDir, abs));
    const dir = path.posix.dirname(rel);
    const entry = byDir.get(dir) ?? {};
    if (path.basename(abs) === "Gemfile.lock") entry.lock = abs;
    else entry.gemfile = abs;
    byDir.set(dir, entry);
  }

  const byManifest: RubyManifestPackages[] = [];
  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const [dir, files] of byDir) {
    if (bytesRead >= maxBytes) break;

    const gems = new Set<string>();
    let primaryRel = dir === "." ? "Gemfile" : `${dir}/Gemfile`;

    for (const abs of [files.gemfile, files.lock]) {
      if (!abs) continue;
      if (bytesRead >= maxBytes) break;

      let raw: string;
      try {
        raw = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      bytesRead += raw.length;

      const base = path.basename(abs);
      const parsed =
        base === "Gemfile.lock" ? parseGemfileLock(raw) : parseGemfile(raw);
      for (const g of parsed.gems) gems.add(g);

      if (base === "Gemfile") {
        primaryRel = toPosixPath(path.relative(rootDir, abs));
      }
    }

    if (gems.size === 0) continue;

    byManifest.push({
      manifestRelativePath: primaryRel,
      gems: Array.from(gems),
    });
  }

  return byManifest;
}

export async function detectRubyPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const manifestPackages = await parseRubyDependencyManifests(rootPath, opts);
  if (manifestPackages.length === 0) return [];

  const findings: RawFinding[] = [];

  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.gems.map((gemName) => {
      const module = bundlerGemModule(gemName);
      return {
        module,
        names: Array.from(new Set([gemName, module])),
      };
    });

    findings.push(
      ...matchPatterns({
        language: "ruby",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  return findings;
}
