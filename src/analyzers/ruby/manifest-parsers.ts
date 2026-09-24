export interface GemfileDependency {
  name: string;
}

const NON_RUNTIME_GROUPS = new Set(["development", "test"]);

function stripComment(line: string): string {
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === "'" || char === '"') && line[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    } else if (char === "#" && !quote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function extractGroups(raw: string): string[] {
  return Array.from(raw.matchAll(/:([A-Za-z_]\w*)/g), (match) =>
    match[1].toLowerCase(),
  );
}

function groupsAreExclusivelyNonRuntime(groups: string[]): boolean {
  return (
    groups.length > 0 &&
    groups.every((group) => NON_RUNTIME_GROUPS.has(group))
  );
}

function inlineGroupsFromGem(line: string): string[] {
  const option = /\bgroups?\s*:\s*(\[[^\]]*\]|:[A-Za-z_]\w*)/.exec(line);
  return option ? extractGroups(option[1]) : [];
}

/**
 * Extract direct Gemfile declarations without evaluating Ruby.
 *
 * Development/test gems are omitted only when their group membership is
 * explicit and exclusive. Mixed groups remain runtime dependencies.
 */
export function parseGemfile(content: string): GemfileDependency[] {
  const dependencies = new Map<string, GemfileDependency>();
  const blockExclusions: boolean[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const groupBlock = /^group\s*(?:\(\s*)?(.+?)(?:\s*\))?\s+do\s*$/.exec(
      line,
    );
    if (groupBlock) {
      blockExclusions.push(
        groupsAreExclusivelyNonRuntime(extractGroups(groupBlock[1])),
      );
      continue;
    }

    if (/^end\b/.test(line)) {
      blockExclusions.pop();
      continue;
    }

    if (
      /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line) ||
      /^(?:if|unless|case|begin|while|until|for|class|module|def)\b/.test(line)
    ) {
      blockExclusions.push(false);
      continue;
    }

    const gemMatch = /^gem\s*(?:\(\s*)?["']([^"']+)["']/.exec(line);
    if (!gemMatch) continue;

    const excludedByBlock = blockExclusions.some(Boolean);
    const excludedInline = groupsAreExclusivelyNonRuntime(
      inlineGroupsFromGem(line),
    );
    if (excludedByBlock || excludedInline) continue;

    const name = gemMatch[1].trim().toLowerCase();
    if (name) dependencies.set(name, { name });
  }

  return Array.from(dependencies.values());
}

/** Parse resolved gem versions from the `GEM` → `specs` lockfile section. */
export function parseGemfileLockVersions(content: string): Map<string, string> {
  const versions = new Map<string, string>();
  let inGemSection = false;
  let inSpecs = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^[A-Z][A-Z ]*$/.test(line)) {
      inGemSection = line === "GEM";
      inSpecs = false;
      continue;
    }
    if (!inGemSection) continue;
    if (/^\s{2}specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;

    const spec = /^\s{4}([A-Za-z0-9_.-]+)\s+\(([^)]+)\)\s*$/.exec(line);
    if (spec) versions.set(spec[1].toLowerCase(), spec[2].trim());
  }

  return versions;
}
