/**
 * Dependency extraction for C++ package manifests.
 *
 * C++ has no single package manager, so the scanner reads the three most
 * common declarations: vcpkg manifests, Conan recipes, and CMake
 * `find_package()` calls.
 */

import {
  lineNumberAt,
  pushManifestSpan,
  type ManifestPackageSpan,
} from "../shared/manifest-span";

function normalizePackageToken(raw: string): string | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  // Strip version constraints: `fmt/9.1.0`, `boost>=1.80`, `curl@7`.
  const withoutVersion = token.split(/[/@]/)[0]!.split(/[<>=!~^\s]/)[0]!;
  const cleaned = withoutVersion.replace(/^["']|["']$/g, "").trim();
  if (!cleaned) return null;
  if (!/^[a-z0-9][a-z0-9_.+-]*$/.test(cleaned)) return null;
  return cleaned;
}

/** vcpkg.json — `dependencies` may hold plain strings or `{ "name": ... }`. */
function lineOfToken(content: string, token: string, fromLine: number): number {
  const lines = content.split(/\r?\n/);
  const needle = token.toLowerCase();
  for (let i = Math.max(0, fromLine - 1); i < lines.length; i += 1) {
    if ((lines[i] ?? "").toLowerCase().includes(needle)) return i + 1;
  }
  return fromLine;
}

export function extractPackagesFromVcpkgJson(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  const dependencies = (parsed as { dependencies?: unknown }).dependencies;
  if (!Array.isArray(dependencies)) return [];

  let cursor = 1;
  for (const dependency of dependencies) {
    const rawName =
      typeof dependency === "string"
        ? dependency
        : dependency && typeof dependency === "object"
          ? (dependency as { name?: unknown }).name
          : undefined;
    if (typeof rawName !== "string") continue;
    const token = normalizePackageToken(rawName);
    if (!token) continue;
    const startLine = lineOfToken(content, token, cursor);
    cursor = startLine + 1;
    pushManifestSpan(spans, token, startLine);
  }

  return spans;
}

/** conanfile.txt `[requires]` section and conanfile.py `requires = (...)`. */
export function extractPackagesFromConanfile(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];
  const lines = content.split(/\r?\n/);

  let inRequiresSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1]!.trim().toLowerCase();
      inRequiresSection = section === "requires" || section === "tool_requires";
      continue;
    }

    if (inRequiresSection) {
      const token = normalizePackageToken(line);
      if (token) pushManifestSpan(spans, token, i + 1);
      continue;
    }

    // conanfile.py: `requires = "fmt/9.1.0"`, `self.requires("zlib/1.3")`.
    const pyRequires = line.match(
      /(?:^requires\s*=|self\.requires\s*\(|self\.tool_requires\s*\()\s*(.*)$/,
    );
    if (pyRequires) {
      const literals = pyRequires[1]!.match(/["']([^"']+)["']/g) ?? [];
      for (const literal of literals) {
        const token = normalizePackageToken(literal.slice(1, -1));
        if (token) pushManifestSpan(spans, token, i + 1);
      }
    }
  }

  return spans;
}

/** CMakeLists.txt — `find_package(<name> ...)` and `FetchContent_Declare(<name> ...)`. */
export function extractPackagesFromCMakeLists(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];
  const regex =
    /\b(?:find_package|FetchContent_Declare|CPMAddPackage)\s*\(\s*([A-Za-z0-9_.+-]+)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const token = normalizePackageToken(match[1]);
    if (!token) continue;
    const startLine = lineNumberAt(content, match.index);
    pushManifestSpan(spans, token, startLine);
  }

  return spans;
}
