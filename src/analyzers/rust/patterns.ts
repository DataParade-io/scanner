import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { RustSourceFileModel } from "./parser";

/**
 * Represent a Rust `use` as a language-agnostic import.
 *
 * Paths keep `::` separators for prefix matching. Segments are also listed in
 * `names` so the shared third-party catalog can resolve crate/service tokens.
 */
function importsForEngine(model: RustSourceFileModel): ImportLike[] {
  return model.imports.map((entry) => {
    const importPath = entry.path;
    const segments = importPath.split("::").filter(Boolean);
    const names = Array.from(
      new Set([
        importPath,
        ...segments,
        ...(entry.alias ? [entry.alias] : []),
      ]),
    ).filter(Boolean);

    return { module: importPath, names };
  });
}

export function detectRustPatternsFromModel(
  model: RustSourceFileModel,
): RawFinding[] {
  return matchPatterns({
    language: "rust",
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: importsForEngine(model),
    functions: model.functions.map((fn) => ({
      name: fn.name,
      decorators: [],
      location: fn.location,
    })),
    types: model.types.map((type) => ({
      name: type.name,
      kind: type.kind,
      baseTypes: [],
      decorators: [],
      location: type.location,
    })),
    moduleLevelCalls: model.calls.map((call) => ({
      callee: call.callee,
      argumentsSnippet: call.argumentsSnippet,
      location: call.location,
    })),
  });
}
