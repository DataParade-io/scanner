import { packQueriesFile } from "../../engine/pack-paths";
import type { LanguagePack, PackConfig } from "../../engine/types";

/** Pattern and scope rules shared by the JavaScript and TypeScript grammars. */
export const ECMASCRIPT_CONFIG: PackConfig = {
  selfNodeTypes: ["this"],
  selfNames: [],
  bindingLeafTypes: ["identifier", "shorthand_property_identifier_pattern"],
  nonBindingNodeTypes: ["comment", "member_expression", "subscript_expression", "call_expression", "decorator"],
  nonBindingChildFields: {
    assignment_pattern: ["right"],
    object_assignment_pattern: ["right"],
    pair_pattern: ["key"],
  },
  hoistedDeclarationParents: ["variable_declaration"],
};

export const javascriptPack: LanguagePack = {
  id: "javascript",
  grammarWasm: "tree-sitter-wasms/out/tree-sitter-javascript.wasm",
  queriesFile: packQueriesFile("javascript"),
  config: ECMASCRIPT_CONFIG,
};
