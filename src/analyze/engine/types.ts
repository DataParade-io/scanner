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
 * Parameter positions come from the grammar's `parameters` (or `parameter`) child
 * field of a function node; a keyword argument is an argument node with `name` and
 * `value` child fields.
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
  /**
   * Names of a method's first parameter that the caller does not pass (`self`, `cls`).
   * Skipped when counting parameter positions of a function defined in a class body.
   */
  implicitFirstParameters?: string[];
  /** A class is instantiated by calling it (`User(...)` in Python), not by `new`. */
  constructsByCall?: boolean;
  /** Attributes between a model class and its query methods (`User.objects.get(...)`). */
  managerAttributes?: string[];
  /** Methods that call the function they are made on later (`task.delay(...)`). */
  deferredCallMethods?: string[];
  /** ORM reference-field classes whose first argument names the target model. */
  referenceFieldClasses?: string[];
}

/** One argument of a call, as written at the call site. */
export interface CallSite {
  /** Final name of the callee: `getByEmail` for `models.User.getByEmail(...)`. */
  callee: string;
  /** 0-based position among the call's arguments. */
  position: number;
  /** The keyword of a keyword argument (`recipient_email=` in Python). */
  keyword?: string;
  /** 1-based line the argument starts on. */
  line: number;
}

export interface FunctionParameter {
  name: string;
  /** 0-based position, not counting an implicit `self` / `cls`. */
  position: number;
  /** 1-based line of the parameter. */
  line: number;
}

export interface FunctionDefinition {
  name: string;
  /** 1-based line of the function's name. */
  line: number;
  parameters: FunctionParameter[];
}

export interface LanguagePack {
  id: string;
  /** Module path of the grammar `.wasm`, resolvable with `require.resolve`. */
  grammarWasm: string;
  /** Absolute path of the pack's `queries.scm`. */
  queriesFile: string;
  config: PackConfig;
}
