/**
 * One declared dependency, pinned to the line it appears on.
 * The same name on two lines stays two spans.
 */
export interface ManifestPackageSpan {
  name: string;
  startLine: number;
  endLine: number;
}

export function manifestSpanNames(
  spans: readonly { name: string }[],
): string[] {
  return spans.map((span) => span.name);
}

export function lineNumberAt(content: string, index: number): number {
  let line = 1;
  const end = Math.max(0, Math.min(index, content.length));
  for (let i = 0; i < end; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function pushManifestSpan(
  spans: ManifestPackageSpan[],
  name: string,
  startLine: number,
  endLine = startLine,
): void {
  if (
    spans.some(
      (span) =>
        span.name === name &&
        span.startLine === startLine &&
        span.endLine === endLine,
    )
  ) {
    return;
  }
  spans.push({ name, startLine, endLine });
}

const JSON_KEY_REGEX = /"((?:[^"\\]|\\.)*)"\s*:/g;

function braceDepthBefore(content: string, index: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < index; i += 1) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}

function matchingBraceEnd(content: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return content.length;
}

/**
 * Keys of JSON objects whose property name is in `sectionNames`.
 * `"dependencies"` and `"devDependencies"` each contribute their own spans,
 * including when the manifest is minified onto one line.
 */
export function jsonObjectKeySpans(
  content: string,
  sectionNames: readonly string[],
  acceptKey: (key: string) => string | null,
): ManifestPackageSpan[] {
  const sections = new Set(sectionNames);
  const ranges: { start: number; end: number; depth: number }[] = [];

  JSON_KEY_REGEX.lastIndex = 0;
  for (const match of content.matchAll(JSON_KEY_REGEX)) {
    const key = match[1];
    if (!key || !sections.has(key)) continue;
    const after = match.index + match[0].length;
    const openOffset = content.slice(after).search(/\{/);
    if (openOffset === -1) continue;
    const open = after + openOffset;
    if (content.slice(after, open).trim() !== "") continue;
    ranges.push({
      start: open,
      end: matchingBraceEnd(content, open),
      depth: braceDepthBefore(content, open) + 1,
    });
  }

  const spans: ManifestPackageSpan[] = [];
  JSON_KEY_REGEX.lastIndex = 0;
  for (const match of content.matchAll(JSON_KEY_REGEX)) {
    const key = match[1];
    if (!key || sections.has(key)) continue;
    const depth = braceDepthBefore(content, match.index);
    const inside = ranges.some(
      (range) =>
        match.index > range.start &&
        match.index < range.end &&
        depth === range.depth,
    );
    if (!inside) continue;
    const name = acceptKey(key);
    if (name) pushManifestSpan(spans, name, lineNumberAt(content, match.index));
  }

  return spans;
}
