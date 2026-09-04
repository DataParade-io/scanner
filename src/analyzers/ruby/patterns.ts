import type { RawFinding } from "../../core/types/detection";
import { matchPatterns, type ImportLike } from "../../patterns/engine";
import type { RubySourceFileModel } from "./parser";

function importsForEngine(model: RubySourceFileModel): ImportLike[] {
  return model.requires.map((entry) => {
    const importPath = entry.path;
    const segments = importPath.split(/[/\\]/).filter(Boolean);
    const names = Array.from(
      new Set([importPath, ...segments, pathBasename(importPath)]),
    ).filter(Boolean);

    return { module: importPath, names };
  });
}

function pathBasename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}

export function detectRubyPatternsFromModel(
  model: RubySourceFileModel,
): RawFinding[] {
  return matchPatterns({
    language: "ruby",
    file: model.file,
    normalizedPath: model.normalizedPath,
    strippedContent: model.strippedContent,
    imports: importsForEngine(model),
    functions: model.methods.map((fn) => ({
      name: fn.name,
      decorators: [],
      location: fn.location,
    })),
    types: model.classes.map((type) => ({
      name: type.name,
      kind: type.kind,
      baseTypes: type.baseType ? [type.baseType] : [],
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
