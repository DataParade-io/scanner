import {
  jsonObjectKeySpans,
  type ManifestPackageSpan,
} from "../shared/manifest-span";

function normalizePackageName(name: string): string | null {
  const s = name.trim();
  if (!s) return null;
  const beforeAt = s.includes("@") && !s.startsWith("@") ? s.split("@")[0] : s;
  const token = beforeAt.toLowerCase();
  return token || null;
}

export function extractPackageSpansFromPackageJson(
  content: string,
): ManifestPackageSpan[] {
  try {
    JSON.parse(content);
  } catch {
    return [];
  }

  return jsonObjectKeySpans(
    content,
    ["dependencies", "devDependencies", "optionalDependencies"],
    normalizePackageName,
  );
}

