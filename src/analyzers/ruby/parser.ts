import * as nodePath from "path";

import type { FileInfo, SourceLocation } from "../../core/types/file";
import {
  extractCFamilyCalls,
  type CFamilyCallEntry,
} from "../shared/c-family-calls";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface RubyImportEntry {
  /** Require path, e.g. `faraday` or `sidekiq/web`. */
  path: string;
  /** True for `require_relative`. */
  isRelative: boolean;
  location: SourceLocation;
}

export interface RubyFunctionEntry {
  name: string;
  /** Owning class/module when nested under `class` / `module`. */
  ownerName?: string;
  location: SourceLocation;
}

export interface RubyTypeEntry {
  name: string;
  kind: "class" | "module";
  location: SourceLocation;
}

export type RubyCallEntry = CFamilyCallEntry;

export interface RubySourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  strippedContent: string;
  imports: RubyImportEntry[];
  functions: RubyFunctionEntry[];
  types: RubyTypeEntry[];
  calls: RubyCallEntry[];
  warnings: string[];
}

const REQUIRE_REGEX =
  /^(?:Kernel\.)?(require(?:_relative)?|load)\s*\(?\s*["']([^"']+)["']/;
const TYPE_REGEX =
  /^(?:class|module)\s+([A-Za-z_][\w:]*)/;
const FUNCTION_REGEX =
  /^def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/;

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
): RubySourceFileModel {
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
  // Ruby uses `end` rather than braces; approximate with indent of `def`/`class`.
  const start = (lines[startIndex] ?? "").match(/^(\s*)/);
  const baseIndent = start?.[1]?.length ?? 0;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = (line.match(/^(\s*)/)?.[1]?.length ?? 0);
    if (indent <= baseIndent && /^end\b/.test(trimmed)) {
      return i + 1;
    }
  }
  return startIndex + 1;
}

export function parseRubySourceFile(file: FileInfo): RubySourceFileModel {
  const warnings: string[] = [];
  const normalizedPath = normalizePath(file.path);

  if (file.language !== "ruby") {
    warnings.push(
      `Unsupported language '${file.language}' for Ruby parser in file '${file.path}'.`,
    );
    return emptyModel(file, normalizedPath, warnings);
  }

  const content = file.content ?? "";
  if (content.includes("\u0000")) {
    warnings.push(
      `File '${file.path}' appears unreadable (contains null bytes); parser will continue with best-effort analysis.`,
    );
  }

  const strippedContent = stripCommentsPreservingLayout(content, {
    hashComments: true,
  });
  const lines = strippedContent.split(/\r?\n/);

  const imports: RubyImportEntry[] = [];
  const functions: RubyFunctionEntry[] = [];
  const types: RubyTypeEntry[] = [];
  const typeStack: string[] = [];

  const toLocation = (startLine: number, endLine: number): SourceLocation => ({
    filePath: file.path,
    startLine,
    endLine,
  });

  for (let i = 0; i < lines.length; i += 1) {
    const text = (lines[i] ?? "").trim();
    const lineNumber = i + 1;
    if (!text) continue;

    if (/^end\b/.test(text) && typeStack.length > 0) {
      // Heuristic: closing a class/module/def — pop type only when at type level.
      // Best-effort: pop on any end when we opened a type recently.
      typeStack.pop();
    }

    const requireMatch = text.match(REQUIRE_REGEX);
    if (requireMatch) {
      imports.push({
        path: requireMatch[2],
        isRelative: requireMatch[1] === "require_relative",
        location: toLocation(lineNumber, lineNumber),
      });
      continue;
    }

    const typeMatch = text.match(TYPE_REGEX);
    if (typeMatch) {
      const kind = text.startsWith("module") ? "module" : "class";
      const name = typeMatch[1].split("::").pop() ?? typeMatch[1];
      types.push({
        name,
        kind,
        location: toLocation(lineNumber, findBlockEndLine(lines, i)),
      });
      typeStack.push(name);
      continue;
    }

    const functionMatch = text.match(FUNCTION_REGEX);
    if (functionMatch) {
      functions.push({
        name: functionMatch[1],
        ownerName: typeStack[typeStack.length - 1],
        location: toLocation(lineNumber, findBlockEndLine(lines, i)),
      });
    }
  }

  const calls = extractCFamilyCalls(lines, { filePath: file.path });

  return {
    file,
    normalizedPath,
    strippedContent,
    imports,
    functions,
    types,
    calls,
    warnings,
  };
}
