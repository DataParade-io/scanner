import {
  pushManifestSpan,
  type ManifestPackageSpan,
} from "../shared/manifest-span";

function normalizePackageNameToken(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const beforeMarker = s.split(";")[0]!.trim();
  const beforeAt = beforeMarker.includes(" @ ")
    ? beforeMarker.split(" @ ")[0]!.trim()
    : beforeMarker;
  const beforeExtras = beforeAt.split("[")[0]!.trim();

  const nameMatch = beforeExtras.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\b/);
  if (!nameMatch) return null;

  const token = nameMatch[1]!.toLowerCase();
  if (!token || token === "python") return null;
  return token;
}

function stripInlineComment(line: string): string {
  const idx = line.indexOf("#");
  if (idx === -1) return line;
  return line.slice(0, idx).trim();
}

function parseRequirementLineToPackageToken(line: string): string | null {
  const trimmed = stripInlineComment(line).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("-") || trimmed.startsWith("--")) {
    return null;
  }
  return normalizePackageNameToken(trimmed);
}

export function extractPackagesFromRequirementsTxt(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const token = parseRequirementLineToPackageToken(lines[i] ?? "");
    if (token) pushManifestSpan(spans, token, i + 1);
  }

  return spans;
}

function parseTomlArrayOfStrings(raw: string): string[] {
  const matches = raw.match(/["']([^"']+)["']/g);
  if (!matches) return [];
  return matches
    .map((m) => m.trim())
    .map((m) => m.replace(/^["']/, "").replace(/["']$/, ""));
}

export function extractPackagesFromPyprojectToml(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];
  const lines = content.split(/\r?\n/);

  let currentSection: string = "";

  const pushTokenFromSpec = (spec: string, lineNumber: number) => {
    const token = normalizePackageNameToken(spec);
    if (token) pushManifestSpan(spans, token, lineNumber);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      continue;
    }

    if (currentSection === "project" && line.startsWith("dependencies")) {
      const arrayMatch = line.match(/^dependencies\s*=\s*\[(.*)$/);
      if (!arrayMatch) continue;

      const firstPart = arrayMatch[1] ?? "";
      let arrayBody = firstPart;
      while (!arrayBody.includes("]") && i + 1 < lines.length) {
        i += 1;
        arrayBody += `\n${lines[i]}`;
      }

      const strings = parseTomlArrayOfStrings(arrayBody);
      const arrayStart = i - (arrayBody.split(/\r?\n/).length - 1);
      for (const spec of strings) {
        const relative = arrayBody
          .split(/\r?\n/)
          .findIndex((part) => part.includes(spec));
        pushTokenFromSpec(
          spec,
          relative === -1 ? i + 1 : arrayStart + relative + 1,
        );
      }
      continue;
    }

    const poetryDepsSections = [
      "tool.poetry.dependencies",
      "tool.poetry.dev-dependencies",
    ];
    const isGroupDeps =
      currentSection.startsWith("tool.poetry.group.") &&
      currentSection.endsWith(".dependencies");

    if (poetryDepsSections.includes(currentSection) || isGroupDeps) {
      const kv = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1]!.trim();
      pushTokenFromSpec(key, i + 1);
    }
  }

  return spans;
}

export function extractPackagesFromPipfile(
  content: string,
): ManifestPackageSpan[] {
  const spans: ManifestPackageSpan[] = [];
  const lines = content.split(/\r?\n/);

  let currentSection: string | null = null;
  const pushKey = (key: string, lineNumber: number) => {
    const token = normalizePackageNameToken(key);
    if (token) pushManifestSpan(spans, token, lineNumber);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1] ?? null;
      continue;
    }

    if (!currentSection) continue;

    const isPkgSection =
      currentSection === "packages" || currentSection === "dev-packages";
    if (!isPkgSection) continue;

    const kv = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=/);
    if (!kv) continue;
    pushKey(kv[1]!.trim(), i + 1);
  }

  return spans;
}

