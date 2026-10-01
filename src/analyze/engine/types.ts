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
 *   @invocation @invocation.callee          every call or construction, with or without arguments
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
  /** 1-based last line of the function. */
  endLine: number;
  /** The class whose body directly defines the function (a method), when there is one. */
  owner?: string;
  parameters: FunctionParameter[];
  /**
   * Object-pattern parameters (`{ email, password: pw }`), which have no single name:
   * the property key each destructured name reads, at the parameter's position
   * (KDATAP-059e1e).
   */
  destructured?: Array<{ position: number; keys: Array<{ key: string; name: string; line: number }> }>;
}

/** One argument of a call as written: its text, position and keyword. */
export interface InvocationArgument {
  /** 0-based position among the call's arguments. */
  position: number;
  keyword?: string;
  /** The argument's value text (the part after `name=` for a keyword argument). */
  text: string;
}

/**
 * A call or construction (`new C()`), whether or not it has arguments (KDATAP-059e1e).
 * A deferred call (`task.delay(...)`) is reported against the function it defers.
 */
export interface Invocation {
  /** Final name of the callee, as in `CallSite.callee`. */
  callee: string;
  /** 1-based line the call starts on, and 0-based column. */
  line: number;
  column: number;
  /** The call goes through a deferral method (`.delay`). */
  deferred: boolean;
  /** Class of the receiver of a method call, when the engine can tell. */
  receiverClass?: string;
  arguments: InvocationArgument[];
  /**
   * The calls this one sits inside the arguments of, innermost first, at most four
   * (`knex.schema.alterTable('users', (table) => { table.string('email') })`: the
   * `string` call has `alterTable` with first string `users`). A call is not enclosed by
   * the calls in its own callee chain.
   */
  ancestors?: Array<{ callee: string; firstString?: string }>;
  /** Pairs of object-literal and keyword arguments: the unquoted string, else the expression text. */
  options?: Record<string, string>;
}

/** A class or interface defined in a file. Lines are 1-based and inclusive. */
export interface ClassDefinition {
  name: string;
  line: number;
  endLine: number;
}

/** A field or key definition (`@definition.field` / `@definition.key`) in a file. */
export interface MemberDefinition {
  name: string;
  kind: "field" | "key";
  /** 1-based line and 0-based column of the name. */
  line: number;
  column: number;
  /** The class or enclosing key that owns it, when there is one. */
  owner?: string;
}

export interface LanguagePack {
  id: string;
  /** Module path of the grammar `.wasm`, resolvable with `require.resolve`. */
  grammarWasm: string;
  /** Absolute path of the pack's `queries.scm`. */
  queriesFile: string;
  config: PackConfig;
}

/** How a use of a binding relates to the value it reads. */
export type UseRole = "argument" | "assigned" | "returned" | "object_key" | "read";

/** The call a use is an argument of (directly, or as a value of an object-literal argument). */
export interface UseCall {
  /** Final name of the callee, as in `CallSite.callee`. */
  callee: string;
  /** 0-based position of the argument. */
  position: number;
  keyword?: string;
  receiverClass?: string;
  /** The object-literal key the use is the value of, when the argument is an object literal. */
  key?: string;
}

/** A later reference that resolves to the same binding (KDATAP-059e1e). Lines are 1-based. */
export interface BindingUse {
  line: number;
  column: number;
  role: UseRole;
  /** `assigned`: the member, key, keyword or bound names the value is stored in. */
  assignedTo?: string;
  /** `object_key`: the key the value sits under. */
  key?: string;
  call?: UseCall;
}

/** A property access `x.name`, `x["name"]` or `x.get("name")` (KDATAP-059e1e). */
export interface MemberAccess {
  name: string;
  line: number;
  column: number;
  /** Class of the object read from, when the engine can tell. */
  receiverClass?: string;
  /** The access is the target of an assignment. */
  write: boolean;
}

/** A decorator on a class or class member: `@Column({ type: 'varchar' })`. */
export interface DecoratorInfo {
  name: string;
  /** Unquoted string-literal arguments. */
  strings: string[];
  /** Pairs of an object-literal argument: the unquoted string, else the expression text. */
  options: Record<string, string>;
}

/**
 * A field declared in a class body, with what it is initialized to and decorated with
 * (KDATAP-33da4c). `initializer` is set when the value is a call (`models.EmailField(...)`).
 */
export interface FieldDeclaration {
  name: string;
  line: number;
  column: number;
  /** The class that owns the field. */
  owner?: string;
  /** Base classes of the owner (`Model`, `models.Model`), as written. */
  ownerBases: string[];
  ownerDecorators: DecoratorInfo[];
  decorators: DecoratorInfo[];
  /** The declared type annotation (`email: string`), without the colon. */
  typeAnnotation?: string;
  initializer?: {
    /** Final name of the callee (`EmailField`) and the callee as written (`models.EmailField`). */
    callee: string;
    calleeText: string;
    strings: string[];
    options: Record<string, string>;
  };
}

/** An object-literal key with its value, and the object it sits in (KDATAP-33da4c). */
export interface KeyDeclaration {
  name: string;
  line: number;
  column: number;
  /** Keys of the enclosing pairs, innermost first, up to a function boundary. */
  path: string[];
  /** String-valued pairs of the object that holds the innermost enclosing key (`info.name` for nested). */
  ownerSiblings: Record<string, string>;
  value: {
    kind: "object" | "name" | "call" | "string" | "other";
    text: string;
    /** `object`: its keys, and its string or name-valued pairs. */
    keys: string[];
    strings: Record<string, string>;
  };
  /** The call whose argument is the object this key sits directly in, if any. */
  container?: {
    callee: string;
    constructed: boolean;
    position: number;
    /** The call's string-literal arguments, in order. */
    strings: string[];
    /** String-valued pairs of the call's other object arguments (`{ tableName: 'users' }`). */
    options: Record<string, string>;
    receiver?: string;
    /** The variable the call's result is assigned to. */
    assignedTo?: string;
  };
}
