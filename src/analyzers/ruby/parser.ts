import type { FileInfo, SourceLocation } from "../../core/types/file";
import { stripCommentsPreservingLayout } from "../shared/strip-comments";

export interface RubyRequireEntry {
  path: string;
  location: SourceLocation;
}

export interface RubyClassEntry {
  name: string;
  kind: "class" | "module";
  baseType?: string;
  location: SourceLocation;
}

export interface RubyMethodEntry {
  name: string;
  className?: string;
  location: SourceLocation;
}

export interface RubyCallEntry {
  callee: string;
  argumentsSnippet: string;
  location: SourceLocation;
}

export interface RubySourceFileModel {
  file: FileInfo;
  normalizedPath: string;
  strippedContent: string;
  requires: RubyRequireEntry[];
  classes: RubyClassEntry[];
  methods: RubyMethodEntry[];
  calls: RubyCallEntry[];
  warnings: string[];
}

const REQUIRE_REGEX = /^\s*(?:require|require_relative)\s+['"]([^'"]+)['"]/;
const CLASS_REGEX =
  /^\s*class\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*(?:<\s*([A-Za-z_:][\w:]*))?/;
const MODULE_REGEX = /^\s*module\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)/;
const METHOD_DEF_REGEX = /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/;
const NEW_CALL_REGEX = /\bnew\s+([A-Za-z_:][\w:]*)\s*(?:\(|$)/g;
const METHOD_CALL_REGEX = /\b([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*)\s*(?:\(|\s|$)/g;

const RUBY_SKIP_PATH_SEGMENTS = [
  "/spec/",
  "/test/",
  "/vendor/",
  "/db/migrate/",
  "spec/",
  "test/",
];

function normalizePath(p: string): string {
  if (!p) return "";
  const normalized = p.split("\\").join("/");
  return normalized.replace(/^\.\/+/, "");
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
    requires: [],
    classes: [],
    methods: [],
    calls: [],
    warnings,
  };
}

function isSkippedRubyPath(normalizedPath: string): boolean {
  const lower = normalizedPath.toLowerCase();
  if (lower.startsWith("spec/") || lower.startsWith("test/")) return true;
  return RUBY_SKIP_PATH_SEGMENTS.some((segment) => lower.includes(segment));
}

function locationAt(
  filePath: string,
  lineNumber: number,
  code: string,
): SourceLocation {
  return {
    filePath,
    startLine: lineNumber,
    endLine: lineNumber,
    code,
  };
}

function extractCallsFromLine(
  line: string,
  filePath: string,
  lineNumber: number,
): RubyCallEntry[] {
  const calls: RubyCallEntry[] = [];
  const loc = locationAt(filePath, lineNumber, line.trim());

  for (const match of line.matchAll(NEW_CALL_REGEX)) {
    calls.push({
      callee: `new ${match[1]}`,
      argumentsSnippet: "",
      location: loc,
    });
  }

  if (/\bRedis\.new\b/.test(line)) {
    calls.push({ callee: "Redis.new", argumentsSnippet: "", location: loc });
  }

  return calls;
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

  if (isSkippedRubyPath(normalizedPath)) {
    return emptyModel(file, normalizedPath, warnings);
  }

  const strippedContent = stripCommentsPreservingLayout(file.content, {
    hashComments: true,
  });
  const lines = strippedContent.split(/\r?\n/);
  const requires: RubyRequireEntry[] = [];
  const classes: RubyClassEntry[] = [];
  const methods: RubyMethodEntry[] = [];
  const calls: RubyCallEntry[] = [];

  let currentClass: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lineNumber = i + 1;
    const loc = locationAt(file.path, lineNumber, trimmed);

    const requireMatch = REQUIRE_REGEX.exec(trimmed);
    if (requireMatch) {
      requires.push({ path: requireMatch[1], location: loc });
    }

    const classMatch = CLASS_REGEX.exec(trimmed);
    if (classMatch) {
      currentClass = classMatch[1];
      classes.push({
        name: classMatch[1],
        kind: "class",
        baseType: classMatch[2],
        location: loc,
      });
    }

    const moduleMatch = MODULE_REGEX.exec(trimmed);
    if (moduleMatch) {
      currentClass = moduleMatch[1];
      classes.push({
        name: moduleMatch[1],
        kind: "module",
        location: loc,
      });
    }

    if (/^\s*end\s*$/.test(trimmed)) {
      currentClass = undefined;
    }

    const methodMatch = METHOD_DEF_REGEX.exec(trimmed);
    if (methodMatch) {
      methods.push({
        name: methodMatch[1],
        className: currentClass,
        location: loc,
      });
    }

    calls.push(...extractCallsFromLine(line, file.path, lineNumber));
  }

  return {
    file,
    normalizedPath,
    strippedContent,
    requires,
    classes,
    methods,
    calls,
    warnings,
  };
}

export function isRailsDatabaseYmlPath(normalizedPath: string): boolean {
  return /(?:^|\/)config\/database\.ya?ml(?:\.example)?$/i.test(normalizedPath);
}

export function normalizeRubyPath(filePath: string): string {
  return normalizePath(filePath);
}

export { isSkippedRubyPath };
