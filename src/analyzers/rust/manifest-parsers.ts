/**
 * Dependency extraction for Cargo manifests.
 *
 * Crate names in `Cargo.toml` (`axum`, `sea-orm`) are distinct from `use`
 * paths (`axum::Router`). Detectors match them via `crateNames` vs
 * `importPaths`. Manifest scanners feed crates as `crate:<name>` so the
 * two spaces stay disjoint.
 */

export interface CargoManifest {
  /** `[package].name`, e.g. `acme-api`. */
  name?: string;
  /** Dependency crate names from deps / dev-deps / build-deps / workspace.deps. */
  crates: string[];
}

const DEP_SECTION_REGEX =
  /^\[(?:(?:workspace\.)?dependencies|dev-dependencies|build-dependencies)\]\s*$/;
const PACKAGE_NAME_REGEX = /^name\s*=\s*"([^"]+)"/;
const DEP_KEY_REGEX = /^([A-Za-z0-9_-]+)\s*=/;
const PACKAGE_FIELD_REGEX = /package\s*=\s*"([^"]+)"/;

function isCrateName(token: string): boolean {
  if (!token) return false;
  // Skip non-crate keys occasionally seen under dependency tables.
  if (token === "version" || token === "features" || token === "default-features") {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(token);
}

export function parseCargoToml(content: string): CargoManifest {
  const crates = new Set<string>();
  let name: string | undefined;
  let inPackage = false;
  let inDeps = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    if (line.startsWith("[")) {
      inPackage = line === "[package]";
      inDeps = DEP_SECTION_REGEX.test(line);
      continue;
    }

    if (inPackage && !name) {
      const nameMatch = line.match(PACKAGE_NAME_REGEX);
      if (nameMatch) name = nameMatch[1];
    }

    if (!inDeps) continue;

    const keyMatch = line.match(DEP_KEY_REGEX);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const packageField = line.match(PACKAGE_FIELD_REGEX);
    const crateName = packageField?.[1] ?? key;
    if (isCrateName(crateName)) crates.add(crateName);
  }

  return { name, crates: Array.from(crates) };
}

/** Prefix used when feeding Cargo crate names into `matchPatterns` imports. */
export const CARGO_CRATE_PREFIX = "crate:";

export function cargoCrateModule(crateName: string): string {
  return `${CARGO_CRATE_PREFIX}${crateName}`;
}
