import { packQueriesFile } from "../../engine/pack-paths";
import type { LanguagePack, PackConfig } from "../../engine/types";
import { ECMASCRIPT_CONFIG } from "../javascript/pack";

const config: PackConfig = {
  ...ECMASCRIPT_CONFIG,
  nonBindingNodeTypes: [...ECMASCRIPT_CONFIG.nonBindingNodeTypes, "type_annotation", "accessibility_modifier"],
};

/** TypeScript and TSX share queries; only the grammar differs. */
export const typescriptPack: LanguagePack = {
  id: "typescript",
  grammarWasm: "tree-sitter-wasms/out/tree-sitter-typescript.wasm",
  queriesFile: packQueriesFile("typescript"),
  config,
};

export const tsxPack: LanguagePack = {
  id: "tsx",
  grammarWasm: "tree-sitter-wasms/out/tree-sitter-tsx.wasm",
  queriesFile: packQueriesFile("typescript"),
  config,
};
