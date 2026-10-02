import { packQueriesFile } from "../../engine/pack-paths";
import type { LanguagePack } from "../../engine/types";

export const rubyPack: LanguagePack = {
  id: "ruby",
  grammarWasm: "tree-sitter-wasms/out/tree-sitter-ruby.wasm",
  queriesFile: packQueriesFile("ruby"),
  config: {
    selfNodeTypes: ["self"],
    selfNames: ["self"],
    bindingLeafTypes: ["identifier"],
    nonBindingNodeTypes: ["call", "element_reference", "constant", "instance_variable"],
    nonBindingChildFields: {
      keyword_parameter: ["value"],
      optional_parameter: ["value"],
    },
    hoistedDeclarationParents: [],
    deferredCallMethods: ["deliver_later", "perform_later"],
    implicitSelf: true,
  },
};
