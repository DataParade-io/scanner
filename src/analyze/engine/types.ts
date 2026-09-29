/**
 * Shared vocabulary of the tree-sitter analysis engine (KDATAP-d1af5b).
 *
 * Every language pack maps its grammar onto these capture names in `queries.scm`:
 *
 *   @scope, @scope.function, @scope.class   nodes that open a scope
 *   @definition.function|class|parameter|variable|field|key   the name being defined
 *   @reference                              an identifier that reads a binding
 *   @import.name                            a name bound by an import
 *   @member @member.object @member.property   property access and subscripts
 *   @call @call.callee @call.argument       calls and their arguments
 *
 * `@definition.key` is an object or dict key, keyword argument, or interface member:
 * it is declared by its own line and never enters a scope's lexical table.
 * `@definition.field` is a class member and is attached to the nearest class scope.
 */

export type DeclarationKind =
  | "field"
  | "parameter"
  | "local"
  | "function"
  | "class"
  | "import";

/** A declaration found in the same file. `line` is 1-based. */
export interface SameFileDeclaration {
  line: number;
  kind: DeclarationKind;
}

/** A function or class enclosing a position. Lines are 1-based and inclusive. */
export interface EnclosingRange {
  name?: string;
  startLine: number;
  endLine: number;
}

export interface PackConfig {
  /** Node types that mean `this` / `self` as the base of a member chain. */
  selfNodeTypes: string[];
  /** Identifier names that mean `this` / `self`. */
  selfNames: string[];
  /** Node types that bind a name inside a pattern (destructuring, tuple targets). */
  bindingLeafTypes: string[];
  /** Node types never searched for bindings: types, decorators, member targets. */
  nonBindingNodeTypes: string[];
  /** Per node type, child fields that hold expressions, not bindings (defaults, keys). */
  nonBindingChildFields: Record<string, string[]>;
  /** Declaration parents whose variables hoist to the enclosing function scope (`var`). */
  hoistedDeclarationParents: string[];
}

export interface LanguagePack {
  id: string;
  /** Module path of the grammar `.wasm`, resolvable with `require.resolve`. */
  grammarWasm: string;
  /** Absolute path of the pack's `queries.scm`. */
  queriesFile: string;
  config: PackConfig;
}
