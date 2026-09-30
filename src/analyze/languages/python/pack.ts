import { packQueriesFile } from "../../engine/pack-paths";
import type { LanguagePack } from "../../engine/types";

export const pythonPack: LanguagePack = {
  id: "python",
  grammarWasm: "tree-sitter-wasms/out/tree-sitter-python.wasm",
  queriesFile: packQueriesFile("python"),
  config: {
    selfNodeTypes: [],
    selfNames: ["self", "cls"],
    bindingLeafTypes: ["identifier"],
    nonBindingNodeTypes: ["comment", "attribute", "subscript", "call", "type", "decorator"],
    nonBindingChildFields: {
      default_parameter: ["value"],
      typed_default_parameter: ["value", "type"],
      keyword_argument: ["value"],
    },
    hoistedDeclarationParents: [],
    implicitFirstParameters: ["self", "cls"],
    constructsByCall: true,
    managerAttributes: ["objects"],
    deferredCallMethods: ["delay"],
  },
};
