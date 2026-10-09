import * as path from "path";

import type { FileInfo } from "../../core/types/file";
import type { ImportLike } from "../../patterns/engine";
import { parseCSharpCompilationUnit } from "./parser";
import { usingEntryToImport } from "./patterns";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isUnder(filePath: string, root: string): boolean {
  const normalized = normalizePath(filePath);
  if (root === ".") return true;
  return normalized === root || normalized.startsWith(`${root}/`);
}

export interface CSharpGlobalUsingScope {
  /** Directory of the file that declares the global usings. */
  root: string;
  imports: ImportLike[];
}

/**
 * `global using` applies to every C# file in the same project. Project files
 * are not part of the scanned source list, so the declaring file's directory
 * stands in for the project: usings in `src/WebApi/GlobalUsings.cs` cover
 * `src/WebApi/**`. Static usings name types, so they are not namespaces.
 */
export function collectCSharpGlobalUsingScopes(
  files: FileInfo[],
): CSharpGlobalUsingScope[] {
  const byRoot = new Map<string, ImportLike[]>();

  for (const file of files) {
    if (file.language !== "csharp") continue;
    const model = parseCSharpCompilationUnit(file);
    const globals = model.usings.filter(
      (entry) => entry.isGlobal && !entry.isStatic,
    );
    if (globals.length === 0) continue;

    const root = path.posix.dirname(normalizePath(file.path));
    const list = byRoot.get(root) ?? [];
    for (const entry of globals) {
      const imported = usingEntryToImport(entry);
      if (!list.some((imp) => imp.module === imported.module)) {
        list.push(imported);
      }
    }
    byRoot.set(root, list);
  }

  return [...byRoot.entries()].map(([root, imports]) => ({ root, imports }));
}

export function globalImportsForCSharpFile(
  filePath: string,
  scopes: readonly CSharpGlobalUsingScope[],
): ImportLike[] {
  const imports: ImportLike[] = [];
  const matching = scopes
    .filter((scope) => isUnder(filePath, scope.root))
    .sort((a, b) => a.root.length - b.root.length);
  for (const scope of matching) {
    for (const imported of scope.imports) {
      if (!imports.some((imp) => imp.module === imported.module)) {
        imports.push(imported);
      }
    }
  }
  return imports;
}
