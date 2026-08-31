#!/usr/bin/env node
/**
 * One-shot migration: union legacy per-positive exhaustive_scope_files into
 * layer-scopes.yaml, verify, then strip from annotations.
 *
 *   pnpm exec ts-node tests/benchmark/scripts/migrate-layer-scopes.ts
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

const REPOS_ROOT = path.join(__dirname, "..", "repos");
const PASS_ID = "KDATAP-f9bb0f";
const PROVENANCE = {
  proposed_by: `migration/${PASS_ID}`,
  proposed_at: "2026-08-31T00:00:00Z",
  reviewed_by: "rap@endymion.com",
  reviewed_at: "2026-08-31T00:00:00Z",
  review_state: "accepted",
};

function normalizeLayer(layer: string): string {
  return layer === "pii_signals" ? "mentions" : layer;
}

function listRepoDirs(): string[] {
  return fs
    .readdirSync(REPOS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(REPOS_ROOT, entry.name))
    .sort();
}

function unionLegacyScopes(repoDir: string): Map<string, Set<string>> {
  const annotationsDir = path.join(repoDir, "annotations");
  const unions = new Map<string, Set<string>>();

  for (const fileName of fs.readdirSync(annotationsDir)) {
    if (!fileName.endsWith(".yaml")) {
      continue;
    }
    const layer = normalizeLayer(fileName.replace(/\.yaml$/, ""));
    const filePath = path.join(annotationsDir, fileName);
    const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as {
      annotations?: { expected?: { exhaustive_scope_files?: string[] } }[];
    };
    for (const annotation of parsed.annotations ?? []) {
      const scope = annotation.expected?.exhaustive_scope_files;
      if (!scope || scope.length === 0) {
        continue;
      }
      const bucket = unions.get(layer) ?? new Set<string>();
      for (const filePathEntry of scope) {
        bucket.add(filePathEntry);
      }
      unions.set(layer, bucket);
    }
  }

  return unions;
}

function writeLayerScopes(repoDir: string, unions: Map<string, Set<string>>): void {
  const layerScopes: Record<string, unknown> = {};
  for (const [layer, files] of [...unions.entries()].sort()) {
    if (files.size === 0) {
      continue;
    }
    layerScopes[layer] = {
      exhaustive_scope_files: [...files].sort(),
      provenance: { ...PROVENANCE },
    };
  }

  const outputPath = path.join(repoDir, "layer-scopes.yaml");
  const doc = { layer_scopes: layerScopes };
  fs.writeFileSync(outputPath, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
}

function verifyUnion(repoDir: string, unions: Map<string, Set<string>>): void {
  const scopesPath = path.join(repoDir, "layer-scopes.yaml");
  const parsed = YAML.parse(fs.readFileSync(scopesPath, "utf8")) as {
    layer_scopes?: Record<string, { exhaustive_scope_files?: string[] }>;
  };
  const written = parsed.layer_scopes ?? {};
  const repoKey = path.basename(repoDir);

  for (const [layer, expected] of unions) {
    const actual = new Set(written[layer]?.exhaustive_scope_files ?? []);
    const expectedSorted = [...expected].sort();
    const actualSorted = [...actual].sort();
    if (expectedSorted.join("\0") !== actualSorted.join("\0")) {
      throw new Error(
        `Union mismatch for ${repoKey}/${layer}: expected ${expectedSorted.length}, got ${actualSorted.length}`,
      );
    }
  }

  for (const layer of Object.keys(written)) {
    if (!unions.has(layer)) {
      throw new Error(`Unexpected layer scope in ${repoKey}: ${layer}`);
    }
  }
}

function stripAnnotationScopes(repoDir: string): number {
  const annotationsDir = path.join(repoDir, "annotations");
  let stripped = 0;

  for (const fileName of fs.readdirSync(annotationsDir)) {
    if (!fileName.endsWith(".yaml")) {
      continue;
    }
    const filePath = path.join(annotationsDir, fileName);
    const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as {
      annotations?: { expected?: { exhaustive_scope_files?: string[] } }[];
    };
    let changed = false;
    for (const annotation of parsed.annotations ?? []) {
      if (annotation.expected?.exhaustive_scope_files !== undefined) {
        delete annotation.expected.exhaustive_scope_files;
        stripped += 1;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(filePath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
    }
  }

  return stripped;
}

function main(): void {
  const passPath = path.join(__dirname, "..", "..", "..", "annotations", PASS_ID, "pass.md");
  if (!fs.existsSync(passPath)) {
    throw new Error(`Missing labeling pass at ${passPath} — write pass.md before accepting scopes`);
  }

  let totalStripped = 0;
  let totalUnions = 0;

  for (const repoDir of listRepoDirs()) {
    const unions = unionLegacyScopes(repoDir);
    if (unions.size === 0) {
      continue;
    }
    writeLayerScopes(repoDir, unions);
    verifyUnion(repoDir, unions);
    totalStripped += stripAnnotationScopes(repoDir);
    totalUnions += unions.size;
    console.log(`Migrated ${path.basename(repoDir)}: ${unions.size} layer scope(s)`);
  }

  console.log(`Done. ${totalUnions} layer scopes across ${listRepoDirs().length} packets; stripped ${totalStripped} annotation fields.`);
}

main();
