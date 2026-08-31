/**
 * Dependency extraction for Bundler manifests.
 *
 * Gem names (`stripe`, `rails`) are distinct from `require` paths
 * (`stripe`, `sidekiq/web`). Detectors match via `gemNames` vs `requirePaths`.
 * Manifest scanners feed gems as `gem:<name>` so the spaces stay disjoint —
 * essential for Rails/Zeitwerk apps that rarely call `require` for gems.
 */

export interface BundlerManifest {
  /** Optional app name from a nearby .gemspec `name` — usually unset for apps. */
  name?: string;
  /** Gem names from Gemfile and/or Gemfile.lock. */
  gems: string[];
}

const GEM_LINE_REGEX =
  /^\s*gem\s+["']([a-zA-Z0-9_-]+)["']/;

/**
 * Parse `gem "name"` / `gem 'name'` declarations from a Gemfile.
 * Does not evaluate Ruby; groups and options after the name are ignored.
 */
export function parseGemfile(content: string): BundlerManifest {
  const gems = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const match = line.match(GEM_LINE_REGEX);
    if (match) gems.add(match[1]);
  }

  return { gems: Array.from(gems) };
}

/**
 * Parse top-level gem specs from Gemfile.lock `GEM` → `specs:` section.
 * Nested dependency lines (extra indent under a gem) are skipped.
 */
export function parseGemfileLock(content: string): BundlerManifest {
  const gems = new Set<string>();
  let inGem = false;
  let inSpecs = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    if (trimmed === "GEM") {
      inGem = true;
      inSpecs = false;
      continue;
    }

    if (
      trimmed === "PLATFORMS" ||
      trimmed === "DEPENDENCIES" ||
      trimmed === "BUNDLED WITH" ||
      trimmed === "RUBY VERSION" ||
      trimmed === "CHECKSUMS" ||
      trimmed === "GIT" ||
      trimmed === "PATH"
    ) {
      inGem = false;
      inSpecs = false;
      continue;
    }

    if (!inGem) continue;

    if (/^\s*specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }

    if (!inSpecs) continue;

    // Under `specs:`, Bundler indents gem names with four spaces and nested
    // dependencies with six+. Example:
    //   specs:
    //     rails (7.1.0)
    //       actionpack (= 7.1.0)
    const topLevel = line.match(/^ {4}([a-zA-Z0-9_-]+)(?:\s|\()/);
    if (topLevel) {
      gems.add(topLevel[1]);
    }
  }

  return { gems: Array.from(gems) };
}

export const BUNDLER_GEM_PREFIX = "gem:";

export function bundlerGemModule(gemName: string): string {
  return `${BUNDLER_GEM_PREFIX}${gemName}`;
}
