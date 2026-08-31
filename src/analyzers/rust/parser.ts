import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface RustImportEntry {
  /** Use path, e.g. `axum::routing::get` or `sqlx`. */
  path: string;
  /** Alias from `use foo as bar`. */
  alias?: string;
  location: SourceLocation;
}

export interface RustFunctionEntry {
  name: string;
  /** Impl type for methods: `impl Server { fn handle() }` → `Server`. */
  implType?: string;
  location: SourceLocation;
}

export interface RustTypeEntry {
  name: string;
  kind: "struct" | "enum" | "trait" | "type";
  location: SourceLocation;
}

export type RustCallEntry = CFamilyCallEntry;

export interface RustSourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  strippedContent: string;
  modName?: string;
  imports: RustImportEntry[];
  functions: RustFunctionEntry[];
  types: RustTypeEntry[];
  calls: RustCallEntry[];
  warnings: string[];
}

const USE_REGEX =
  /^use\s+((?:crate|super|self|[A-Za-z_][\w]*)(?:::[A-Za-z_][\w*]*)*(?:::\*)?)(?:\s+as\s+([A-Za-z_]\w*))?\s*;/;
const USE_GROUP_START_REGEX =
  /^use\s+((?:crate|super|self|[A-Za-z_][\w]*)(?:::[A-Za-z_][\w]*)*)::\{/;
const MOD_REGEX = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*[;{]/;
const TYPE_REGEX =
  /^(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|type)\s+([A-Za-z_]\w*)/;
const FUNCTION_REGEX =
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/;
const IMPL_REGEX =
  /^(?:unsafe\s+)?impl(?:\s*<[^>]*>)?\s+(?:(?:[A-Za-z_][\w:]*)\s+for\s+)?([A-Za-z_][\w:]*)/;

function normalizePath(p: string): string {
  if (!p) return "";
  const normalized = p.split("\\").join("/");
  return normalizedPathIsRelativeToCwd(normalized)
    ? normalized
    : normalized.replace(nodePath.resolve(), "").replace(/^\/+/, "");
}

function normalizedPathIsRelativeToCwd(p: string): boolean {
  return !p.startsWith("/") && !p.match(/^[A-Za-z]:\//);
}

function emptyModel(
  file: FileInfo,
  normalizedPath: string,
  warnings: string[],
): RustSourceFileModel {
  return {
    file,
    normalizedPath,
    strippedContent: "",
    imports: [],
    functions: [],
    types: [],
    calls: [],
    warnings,
  };
}

function findBlockEndLine(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenOpening = false;

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        seenOpening = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (seenOpening && depth <= 0) return i + 1;
  }

  return startIndex + 1;
}

/**
 * Expand `use foo::{bar, baz as qux}` into individual paths when possible.
 */
function expandUseGroup(prefix: string, body: string): string[] {
  return body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const asMatch = part.match(/^([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)(?:\s+as\s+[A-Za-z_]\w*)?$/);
      if (!asMatch) return `${prefix}::${part.split(/\s+as\s+/)[0]}`;
      return `${prefix}::${asMatch[1]}`;
    });
}

export function parseRustSourceFile(file: FileInfo): RustSourceFileModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "rust") {
    warnings.push(
      `Unsupported language '${file.language}' for Rust parser in file '${file.path}'.`,
    );
    return emptyModel(file, normalizedPath, warnings);
  }

  const content = file.content ?? "";
  if (content.includes("\u0000")) {
    warnings.push(
      `File '${file.path}' appears unreadable (contains null bytes); parser will continue with best-effort analysis.`,
    );
  }

  const strippedContent = stripCommentsPreservingLayout(content);
  const lines = strippedContent.split(/\r?\n/);

  const imports: RustImportEntry[] = [];
  const functions: RustFunctionEntry[] = [];
  const types: RustTypeEntry[] = [];
  let modName: string | undefined;
  let currentImpl: string | undefined;
  let implEndLine = 0;

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text) continue;

    if (currentImpl && lineNumber > implEndLine) {
      currentImpl = undefined;
    }

    if (!modName) {
      const modMatch = text.match(MOD_REGEX);
      if (modMatch) {
        modName = modMatch[1];
      }
    }

    const useGroup = text.match(USE_GROUP_START_REGEX);
    if (useGroup) {
      const prefix = useGroup[1];
      let body = text.slice(text.indexOf("{") + 1);
      let j = i;
      while (!body.includes("}") && j + 1 < lines.length) {
        j += 1;
        body += " " + (lines[j] ?? "").trim();
      }
      const inner = body.slice(0, body.indexOf("}"));
      for (const pathSeg of expandUseGroup(prefix, inner)) {
        imports.push({
          path: pathSeg.replace(/\s+as\s+[A-Za-z_]\w*$/, ""),
          location: toLocation(lineNumber, j + 1),
        });
      }
      i = j;
      continue;
    }

    const useMatch = text.match(USE_REGEX);
    if (useMatch) {
      imports.push({
        path: useMatch[1].replace(/::\*$/, ""),
        alias: useMatch[2],
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    const implMatch = text.match(IMPL_REGEX);
    if (implMatch && text.includes("{")) {
      currentImpl = implMatch[1].split("::").pop();
      implEndLine = findBlockEndLine(lines, i);
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      types.push({
        name: typeMatch[2],
        kind: typeMatch[1] as RustTypeEntry["kind"],
        location: toLocation(lineNumber, findBlockEndLine(lines, i)),
      });
      continue;
    }

    const functionMatch = text.match(FUNCTION_REGEX);
    if (functionMatch) {
      functions.push({
        name: functionMatch[1],
        implType: currentImpl,
        location: toLocation(lineNumber, findBlockEndLine(lines, i)),
      });
    }
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    modName,
    imports,
    functions,
    types,
    calls,
    warnings,
  };
}
