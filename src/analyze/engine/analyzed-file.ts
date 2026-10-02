import type { Node, Query, Tree } from "web-tree-sitter";
import type {
  DeclarationKind,
  BindingUse,
  CallSite,
  ClassDefinition,
  DecoratorInfo,
  FieldDeclaration,
  KeyDeclaration,
  KeyFlow,
  ParameterSink,
  EnclosingRange,
  FunctionDefinition,
  Invocation,
  MemberAccess,
  MemberDefinition,
  ModuleVariable,
  LanguagePack,
  PackConfig,
  RecordType,
  SameFileDeclaration,
} from "./types";

type ScopeKind = "module" | "function" | "class" | "block";
type DefinitionKind = "function" | "class" | "parameter" | "local" | "field" | "key" | "import";

/** Most specific wins when one node is captured as several kinds. */
const KIND_PRIORITY: DefinitionKind[] = ["field", "parameter", "function", "class", "import", "key", "local"];

interface Scope {
  node: Node;
  kind: ScopeKind;
  parent?: Scope;
  name?: string;
  /** Lexically visible names; for a class scope, its body members. */
  defs: Map<string, SiteDefinition[]>;
  /** Class scopes only: fields first assigned in methods (`this.x = ...`). */
  implicitFields: Map<string, SiteDefinition[]>;
}

interface SiteDefinition {
  kind: DefinitionKind;
  name: string;
  node: Node;
  line: number;
  column: number;
}

/** Receivers found for a occurrence: a resolved class, or binding names to look up by name. */
export interface ReceiverInfo {
  className?: string;
  names: string[];
}

/** A place where a name is defined, read, or reached through a member chain. */
export type Site =
  | {
      role: "definition";
      kind: DefinitionKind;
      name: string;
      node: Node;
      line: number;
      column: number;
      /** A field first assigned in a method (`this.x = ...`), not declared in the class body. */
      implicit?: boolean;
    }
  | {
      role: "reference";
      name: string;
      node: Node;
      line: number;
      column: number;
      /** The name is (part of) the callee of a call: `send_email(x)`, `this.emailService.send(x)`. */
      inCallee: boolean;
    }
  | {
      role: "member";
      /** The property name, or the string key of a subscript or `.get("key")` call. */
      name: string;
      node: Node;
      line: number;
      column: number;
      /** How the chain starts: a named binding, `this`/`self`, or something else. */
      root: MemberRoot;
      /** The expression the property is read from (`x` in `x.email`). */
      object: Node;
      /** The access is (part of) the callee of a call. */
      inCallee: boolean;
    };

export type MemberRoot =
  | { type: "identifier"; name: string; node: Node }
  | { type: "self"; firstMember?: string; node: Node }
  | { type: "other" };

export interface CompiledPack {
  pack: LanguagePack;
  query: Query;
}

/** ActiveRecord class methods that query or build a model's rows. */
const ACTIVE_RECORD_METHODS = new Set([
  "new", "create", "create!", "find", "find_by", "find_by!", "where", "find_or_create_by", "find_or_create_by!",
  "find_or_initialize_by", "find_each", "all", "first", "last", "exists?", "select", "pluck", "order", "joins",
  "includes", "update_all", "insert_all", "upsert_all", "unscoped", "build",
]);

/** Ruby classes that act on data rather than store it. */
const RUBY_SERVICE_CLASS = /(?:Service|Job|Builder|Worker|Helper|Controller|Mailer|Listener|Finder|Presenter|Policy|Action|Handler|Client|Api|Rails)$/;

function unquote(text: string): string {
  const m = /^[A-Za-z]{0,2}("""|'''|"|'|`)([\s\S]*)\1$/.exec(text);
  if (m) return m[2];
  // A Ruby symbol names a key the way a string does: `:email` -> email.
  const symbol = /^:([A-Za-z_]\w*[?!]?)$/.exec(text);
  return symbol ? symbol[1] : text;
}

/**
 * One parsed file and the indexes the engine builds from the pack's captures. Answers
 * are synchronous. Call `dispose()` when done: the parse tree lives in WASM memory.
 */
export class AnalyzedFile {
  readonly hasSyntaxError: boolean;
  private readonly config: PackConfig;
  private readonly scopes = new Map<number, Scope>();
  private readonly rootScope: Scope;
  private readonly sitesByLine = new Map<number, Site[]>();
  private readonly memberByNode = new Map<number, { object: Node; property: Node }>();
  /** The member access whose property is this node (a Ruby call's `method`). */
  private readonly memberByProperty = new Map<number, { object: Node; property: Node }>();
  private readonly callByNode = new Map<number, Node>();
  private readonly callSitesByRow = new Map<number, Array<CallSite & { argument: Node; receiver?: Node }>>();
  private readonly nodeToScopeName = new Map<number, string>();
  private readonly callSiteByArgument = new Map<number, CallSite & { argument: Node; receiver?: Node }>();
  private readonly invocationNodes: Array<{ call: Node; callee: Node }> = [];
  private factoryReturnTypes = true;
  private knownClass: ((name: string) => boolean) | undefined;

  constructor(
    private readonly tree: Tree,
    compiled: CompiledPack,
  ) {
    this.config = compiled.pack.config;
    const root = tree.rootNode;
    this.hasSyntaxError = root.hasError;
    this.rootScope = this.newScope(root, "module");
    this.index(compiled.query);
  }

  dispose(): void {
    this.tree.delete();
  }

  /** Node type of the smallest node at a 1-based line and 0-based column. */
  syntaxKindAt(line: number, column: number): string | undefined {
    return this.tree.rootNode.descendantForPosition({ row: line - 1, column })?.type;
  }

  enclosingFunction(line: number, column: number): EnclosingRange | undefined {
    return this.enclosing(line, column, "function");
  }

  enclosingClass(line: number, column: number): EnclosingRange | undefined {
    return this.enclosing(line, column, "class");
  }

  /**
   * The same-file declaration of `name` visible at a 1-based line and 0-based column
   * (innermost scope first), or undefined. Class scopes are skipped from inside their
   * methods, as in both JavaScript and Python.
   */
  declarationOf(name: string, line: number, column = 0): SameFileDeclaration | undefined {
    const node = this.tree.rootNode.descendantForPosition({ row: line - 1, column });
    return node ? this.lookup(name, node) : undefined;
  }

  /** Lexical lookup from a syntax node. */
  lookup(name: string, anchor: Node): SameFileDeclaration | undefined {
    const found = pick(this.definitionsOf(name, anchor));
    return found ? toDeclaration(found) : undefined;
  }

  private definitionsOf(name: string, anchor: Node): SiteDefinition[] | undefined {
    let scope: Scope | undefined = this.scopeAround(anchor);
    let first = true;
    while (scope) {
      if (scope.kind !== "class" || first) {
        const found = scope.defs.get(name);
        if (found?.length) return found;
      }
      first = false;
      scope = scope.parent;
    }
    return undefined;
  }

  /** The class-level declaration of a `this.x` / `self.x` member for code at `anchor`. */
  lookupMember(name: string, anchor: Node): SameFileDeclaration | undefined {
    let scope: Scope | undefined = this.scopeAround(anchor);
    while (scope && scope.kind !== "class") scope = scope.parent;
    if (!scope) return undefined;
    const found = scope.defs.get(name)?.[0] ?? scope.implicitFields.get(name)?.[0];
    return found ? toDeclaration(found) : undefined;
  }

  /**
   * The class a named binding holds at a 1-based line and 0-based column (KDATAP-c8a46a):
   * `const x = new C()`, `x = C()`, a parameter or variable annotated `x: C`, or a field
   * assigned or typed in the class (`this.x = new C()` read as `this.x`, pass `member`).
   * Undefined when the class cannot be told.
   */
  classOfName(name: string, line: number, column = 0, member = false): string | undefined {
    const node = this.tree.rootNode.descendantForPosition({ row: line - 1, column });
    if (!node) return undefined;
    return member ? this.classOfField(name, node, 0) : this.classOfBinding(name, node, 0);
  }

  /**
   * The class of an expression used as a receiver: a typed variable, `this.x` /
   * `self.x`, or a class named directly (`User.objects`, `models.User`).
   */
  classOfReceiver(node: Node): string | undefined {
    return this.receiverClass(node, 0);
  }

  /** The class reached by a member site's object (`x` in `x.email`). */
  /**
   * The receiver of the nearest call enclosing a position, within the same function:
   * `usersService.readOne(id, { fields: ['email'] })` for the `'email'` string. Returns its
   * class when known and its binding name (KDATAP-c8a46a).
   */
  enclosingCallReceiver(line: number, column: number): { className?: string; name?: string } | undefined {
    const start = this.tree.rootNode.descendantForPosition({ row: line - 1, column });
    for (let current: Node | null = start ?? null; current; current = current.parent) {
      if (this.scopes.get(current.id)?.kind === "function") return undefined;
      if (current.type !== "call_expression" && current.type !== "call") continue;
      const callee = current.childForFieldName("function");
      const member = callee ? this.memberByNode.get(callee.id) : undefined;
      if (!member) continue;
      const className = this.classOfReceiver(member.object);
      const name = this.receiverBindingName(member.object);
      return { ...(className ? { className } : {}), ...(name ? { name } : {}) };
    }
    return undefined;
  }

  classOfSiteReceiver(site: Site): string | undefined {
    return site.role === "member" ? this.receiverClass(site.object, 0) : undefined;
  }

  /**
   * The entity that owns a field or key defined at a 1-based line and 0-based column:
   * the key of the object that contains it (`members: { email: ... }` -> `members`),
   * else the enclosing class name (KDATAP-c8a46a). Stops at a function boundary: a key
   * in an object built inside a function is data being passed, not a field. Uses the
   * grammar's `key` child field and the scopes, so it needs no per-language code.
   */
  definitionOwner(line: number, column: number): string | undefined {
    const node = this.tree.rootNode.descendantForPosition({ row: line - 1, column });
    // A key in an object built inside a function is data being passed (`findOne({ where:
    // { email } })`), not a field, whichever key or boundary is met first.
    for (let current = node?.parent ?? null; current; current = current.parent) {
      if (this.scopes.get(current.id)?.kind === "function") return undefined;
    }
    let passedOwnKey = false;
    for (let current = node?.parent ?? null; current; current = current.parent) {
      const key = current.childForFieldName("key");
      if (key) {
        if (!passedOwnKey) {
          passedOwnKey = true;
          continue;
        }
        return unquote(key.text);
      }
      const scope = this.scopes.get(current.id);
      if (scope?.kind === "class") return scope.name;
      if (scope?.kind === "function") return undefined;
    }
    return undefined;
  }

  sitesOnLine(line: number): readonly Site[] {
    return this.sitesByLine.get(line - 1) ?? [];
  }

  /**
   * Arguments of calls that start on a 1-based line, with the callee's final name,
   * the argument's position, and its keyword (KDATAP-c8a46a). `argument` is the node.
   */
  callSitesOnLine(line: number): ReadonlyArray<CallSite & { argument: Node; receiver?: Node }> {
    return this.callSitesByRow.get(line - 1) ?? [];
  }

  /**
   * Whether `node` is (part of) the value an argument passes: it may sit in member
   * chains, subscripts, and the callee of a call (`order.get_email()`), but not in the
   * arguments of a nested call, whose result is a different value.
   */
  isPassedBy(node: Node, argument: Node): boolean {
    if (node.startIndex < argument.startIndex || node.endIndex > argument.endIndex) return false;
    let current: Node = node;
    while (current.id !== argument.id) {
      const parent = current.parent;
      if (!parent) return false;
      const callee = this.callByNode.get(parent.id);
      if (callee && callee.id !== current.id) return false;
      current = parent;
    }
    return true;
  }

  /**
   * Named functions and methods defined in the file, with their parameters. A
   * parameter that destructures a pattern is left out, since it has no single name.
   */
  functionDefinitions(): FunctionDefinition[] {
    const out: FunctionDefinition[] = [];
    for (const scope of this.scopes.values()) {
      if (scope.kind !== "function") continue;
      const nameNode = scope.node.childForFieldName("name");
      const parent = scope.node.parent;
      const name = scope.name ?? (nameNode ? nameNode.text : parent?.childForFieldName("name")?.text);
      const list = scope.node.childForFieldName("parameters") ?? scope.node.childForFieldName("parameter");
      if (!name || !list) continue;
      const params = list.type === "identifier" ? [list] : list.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
      const skipFirst = scope.parent?.kind === "class" ? this.config.implicitFirstParameters ?? [] : [];
      const parameters: FunctionDefinition["parameters"] = [];
      const destructured: NonNullable<FunctionDefinition["destructured"]> = [];
      let position = 0;
      params.forEach((param, index) => {
        const names = this.bindings(param);
        if (index === 0 && names.length === 1 && skipFirst.includes(names[0].text)) return;
        if (names.length === 1) {
          parameters.push({ name: names[0].text, position, line: names[0].startPosition.row + 1 });
        } else {
          const keys = this.patternKeys(param);
          if (keys.length > 0) destructured.push({ position, keys });
        }
        position += 1;
      });
      const owner = scope.parent?.kind === "class" ? scope.parent.name : undefined;
      out.push({
        name,
        line: (nameNode ?? scope.node).startPosition.row + 1,
        endLine: scope.node.endPosition.row + 1,
        ...(owner ? { owner } : {}),
        parameters,
        ...(destructured.length > 0 ? { destructured } : {}),
      });
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /** The property keys an object-pattern parameter reads, with the name each binds. */
  private patternKeys(param: Node): Array<{ key: string; name: string; line: number }> {
    const pattern = param.type === "object_pattern" ? param : param.childForFieldName("pattern");
    if (!pattern || pattern.type !== "object_pattern") return [];
    const out: Array<{ key: string; name: string; line: number }> = [];
    for (const child of pattern.namedChildren) {
      if (!child) continue;
      const target =
        child.type === "object_assignment_pattern" ? (child.childForFieldName("left") ?? child) : child;
      if (target.type === "shorthand_property_identifier_pattern") {
        out.push({ key: target.text, name: target.text, line: target.startPosition.row + 1 });
      } else if (target.type === "pair_pattern") {
        const key = target.childForFieldName("key");
        const names = this.bindings(target.childForFieldName("value") ?? target);
        if (key && names.length === 1) {
          out.push({ key: unquote(key.text), name: names[0].text, line: names[0].startPosition.row + 1 });
        }
      }
    }
    return out;
  }

  /**
   * Every later reference to the binding that `name` resolves to at a 1-based line
   * (KDATAP-059e1e), with what each use does with the value. The name may be defined on
   * the line (a parameter, an assignment target, a destructured name) or only referenced
   * there; a definition on the line wins. Uses are the references that resolve to the same
   * first declaration (so shadowing is respected), after it and within its scope, in
   * source order. A reassignment is a new definition, not a use. Undefined when no
   * binding of that name is visible.
   */
  bindingUses(name: string, line: number): { line: number; kind: SameFileDeclaration["kind"]; uses: BindingUse[] } | undefined {
    const sites = this.sitesOnLine(line).filter((site) => site.name === name);
    const lexical = sites.find((site) => site.role === "definition" && site.kind !== "key" && site.kind !== "field");
    const referenced = sites.find((site) => site.role === "reference");
    const anchor =
      lexical?.node ??
      referenced?.node ??
      this.tree.rootNode.descendantForPosition({ row: line - 1, column: 0 });
    const def = anchor ? this.definitionsOf(name, anchor)?.[0] : undefined;
    if (!def) return undefined;
    const scope = this.scopeAround(def.node);
    const uses: BindingUse[] = [];
    for (let row = def.node.startPosition.row; row <= scope.node.endPosition.row; row += 1) {
      for (const site of this.sitesByLine.get(row) ?? []) {
        if (site.role !== "reference" || site.name !== name || site.node.startIndex <= def.node.startIndex) continue;
        if (site.node.type === "shorthand_property_identifier_pattern") continue;
        if (this.definitionsOf(name, site.node)?.[0] !== def) continue;
        uses.push(this.classifyUse(site.node));
      }
    }
    return { ...toDeclaration(def), uses };
  }

  /** Wrappers a value passes through unchanged for the purpose of where it goes next. */
  private static readonly TRANSPARENT = new Set([
    "parenthesized_expression", "await_expression", "await", "as_expression", "non_null_expression",
    "satisfies_expression", "spread_element", "list_splat", "dictionary_splat", "array", "list", "tuple",
  ]);

  private classifyUse(node: Node): BindingUse {
    const base = { line: node.startPosition.row + 1, column: node.startPosition.column };
    if (node.type === "shorthand_property_identifier") {
      return this.objectKeyUse(base, node.parent, node.text);
    }
    // Climb to the whole expression the value is part of: through member reads, the
    // callee of a call (`req.body.email.trim()`), and default-value operators.
    let top: Node = node;
    for (let guard = 0; guard < 24; guard += 1) {
      const parent: Node | null = top.parent;
      if (!parent) break;
      const member = this.memberByNode.get(parent.id);
      const isCall = parent.type === "call_expression" || parent.type === "call";
      const operator = parent.childForFieldName("operator")?.text;
      if (
        AnalyzedFile.TRANSPARENT.has(parent.type) ||
        (member && member.object.id === top.id) ||
        (isCall && parent.childForFieldName("function")?.id === top.id) ||
        ((parent.type === "binary_expression" || parent.type === "boolean_operator") &&
          ["??", "||", "&&", "or", "and"].includes(operator ?? ""))
      ) {
        top = parent;
        continue;
      }
      break;
    }
    const parent = top.parent;
    const keywordHolder =
      parent && this.callSiteByArgument.has(parent.id) && parent.childForFieldName("value")?.id === top.id ? parent : undefined;
    const argument = this.callSiteByArgument.get(top.id) ?? (keywordHolder && this.callSiteByArgument.get(keywordHolder.id));
    if (argument) {
      const call = this.useCall(argument);
      if (argument.keyword) return { ...base, role: "assigned", assignedTo: argument.keyword, call };
      return { ...base, role: "argument", call };
    }
    if (!parent) return { ...base, role: "read" };
    if (parent.type === "return_statement") return { ...base, role: "returned" };
    if ((parent.type === "arrow_function" || parent.type === "lambda") && parent.childForFieldName("body")?.id === top.id) {
      return { ...base, role: "returned" };
    }
    if (parent.type === "pair" && parent.childForFieldName("value")?.id === top.id) {
      const key = parent.childForFieldName("key");
      return this.objectKeyUse(base, parent.parent, key ? unquote(key.text) : "");
    }
    const value = parent.childForFieldName("value") ?? parent.childForFieldName("right");
    const target = parent.childForFieldName("name") ?? parent.childForFieldName("left");
    if (value?.id === top.id && target) {
      const property = this.memberByNode.get(target.id)?.property;
      const names = property ? [] : this.bindings(target);
      const assignedTo = property ? unquote(property.text) : names.length > 0 ? names.map((n) => n.text).join(", ") : target.text.slice(0, 80);
      return { ...base, role: "assigned", assignedTo };
    }
    return { ...base, role: "read" };
  }

  private useCall(site: CallSite & { receiver?: Node }, key?: string): NonNullable<BindingUse["call"]> {
    const receiverClass = site.receiver ? this.classOfReceiver(site.receiver) : undefined;
    return {
      callee: site.callee,
      position: site.position,
      ...(site.keyword ? { keyword: site.keyword } : {}),
      ...(receiverClass ? { receiverClass } : {}),
      ...(key ? { key } : {}),
    };
  }

  /** A value under an object-literal key, with the call the literal is an argument of, if any. */
  private objectKeyUse(base: { line: number; column: number }, object: Node | null, key: string): BindingUse {
    let holder: Node | null = object;
    while (holder?.parent && AnalyzedFile.TRANSPARENT.has(holder.parent.type)) holder = holder.parent;
    const site = holder ? this.callSiteByArgument.get(holder.id) : undefined;
    return { ...base, role: "object_key", key, ...(site ? { call: this.useCall(site, key) } : {}) };
  }

  /**
   * Every property access in the file: `x.name`, `x["name"]` and `x.get("name")`
   * (KDATAP-059e1e). `write` marks the target of an assignment (`x.name = ...`).
   */
  memberAccesses(): MemberAccess[] {
    const out: MemberAccess[] = [];
    for (const sites of this.sitesByLine.values()) {
      for (const site of sites) {
        if (site.role !== "member") continue;
        const holder = site.node.parent;
        const access = holder && this.memberByNode.get(holder.id)?.property.id === site.node.id ? holder : undefined;
        const className = this.classOfSiteReceiver(site);
        const write =
          access?.parent !== undefined &&
          access.parent !== null &&
          /^(assignment|assignment_expression|augmented_assignment|augmented_assignment_expression)$/.test(access.parent.type) &&
          access.parent.childForFieldName("left")?.id === access.id;
        const receiverName = this.chainName(site.object);
        out.push({
          name: site.name,
          line: site.line,
          column: site.column,
          ...(className ? { receiverClass: className } : {}),
          ...(receiverName ? { receiverName } : {}),
          called:
            access?.parent != null &&
            (access.parent.type === "call_expression" || access.parent.type === "call") &&
            access.parent.childForFieldName("function")?.id === access.id,
          write,
        });
      }
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  /** The name an expression is known by: identifier, last property of a chain, or called function. */
  private chainName(node: Node): string | undefined {
    if (node.type === "identifier") return node.text;
    const member = this.memberByNode.get(node.id);
    if (member) return unquote(member.property.text);
    const callee = node.type === "call_expression" || node.type === "call" ? node.childForFieldName("function") : undefined;
    return callee ? this.chainName(callee) : undefined;
  }

  /** Variables assigned at module level (`DEFAULT_FROM_EMAIL = ...` in a settings module). */
  moduleVariables(): ModuleVariable[] {
    const out: ModuleVariable[] = [];
    for (const defs of this.rootScope.defs.values()) {
      for (const def of defs) if (def.kind === "local") out.push({ name: def.name, line: def.line });
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /**
   * Every call and construction in the file, with or without arguments, in source order
   * (KDATAP-059e1e). The callee name follows `callSitesOnLine`, including the deferred
   * `task.delay(...)` rule. `receiverClass` is set for a method call whose receiver the
   * engine can type.
   */
  invocations(): Invocation[] {
    const out: Invocation[] = [];
    for (const { call, callee } of this.invocationNodes) {
      const member = this.memberByNode.get(callee.id) ?? this.memberByProperty.get(callee.id);
      if (!member && callee.type !== "identifier") continue;
      const { nameNode, deferred } = this.calleeNameNode(callee, member);
      const list = call.childForFieldName("arguments");
      const nodes = !list
        ? []
        : /^(argument_list|arguments)$/.test(list.type)
          ? list.namedChildren.filter((c): c is Node => !!c && c.type !== "comment")
          : [list];
      const className = member ? this.classOfReceiver(member.object) : undefined;
      const constant =
        member && (member.object.type === "constant" || member.object.type === "scope_resolution")
          ? member.object.text.replace(/^::/, "").split("::").join("")
          : member && member.object.type === "identifier" && isClassName(member.object.text)
            ? member.object.text
            : undefined;
      // An association the call is made on (`inbox.contact_inboxes.where(...)` -> contact_inboxes).
      const receiverMember = member ? (this.memberByNode.get(member.object.id) ?? this.memberByProperty.get(member.object.id)) : undefined;
      const association = receiverMember && /^[a-z][a-z0-9_]*s$/.test(unquote(receiverMember.property.text)) ? unquote(receiverMember.property.text) : undefined;
      out.push({
        callee: unquote(nameNode.text),
        line: call.startPosition.row + 1,
        column: call.startPosition.column,
        deferred,
        ...(className ? { receiverClass: className } : {}),
        ...(constant ? { receiverConstant: constant } : {}),
        ...(association ? { receiverAssociation: association } : {}),
        ancestors: this.enclosingCalls(call),
        ...(Object.keys(argumentLiterals(list).options).length > 0 ? { options: argumentLiterals(list).options } : {}),
        arguments: nodes.map((node, position) => {
          // A keyword argument: `name=value` (Python), or a hash pair `key: value` (Ruby).
          const keywordNode = node.childForFieldName("name") ?? (node.type === "pair" ? node.childForFieldName("key") : null);
          const value = keywordNode ? node.childForFieldName("value") : null;
          return {
            position,
            ...(keywordNode && value ? { keyword: unquote(keywordNode.text.replace(/:$/, "")) } : {}),
            text: (value ?? node).text,
          };
        }),
      });
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  /** The calls whose arguments contain `node`, innermost first (KDATAP-33da4c). */
  private enclosingCalls(node: Node): Array<{ callee: string; firstString?: string }> {
    const out: Array<{ callee: string; firstString?: string }> = [];
    let child: Node = node;
    for (let parent = node.parent; parent && out.length < 4; child = parent, parent = parent.parent) {
      if (parent.type !== "call_expression" && parent.type !== "call" && parent.type !== "new_expression") continue;
      const callee = parent.childForFieldName("function") ?? parent.childForFieldName("constructor");
      if (!callee || callee.id === child.id) continue;
      const member = this.memberByNode.get(callee.id);
      const name = member ? member.property : callee.type === "identifier" ? callee : undefined;
      if (!name) continue;
      const first = parent.childForFieldName("arguments")?.namedChildren.find((c): c is Node => !!c && c.type !== "comment");
      out.push({ callee: unquote(name.text), ...(first && isStringLiteral(first) ? { firstString: unquote(first.text) } : {}) });
    }
    return out;
  }

  /**
   * Fields declared directly in class bodies, with their initializer call, decorators and
   * the owner's bases and decorators (KDATAP-33da4c): Django `email = models.EmailField()`,
   * TypeORM `@Column() email: string`. Fields first assigned in methods are left out.
   */
  fieldDeclarations(): FieldDeclaration[] {
    const out: FieldDeclaration[] = [];
    for (const sites of this.sitesByLine.values()) {
      for (const site of sites) {
        if (site.role !== "definition" || site.kind !== "field" || site.implicit) continue;
        const declaration = site.node.parent;
        if (!declaration) continue;
        const classScope = this.nearestScope(declaration, (s) => s.kind === "class");
        const value = declaration.childForFieldName("value") ?? declaration.childForFieldName("right");
        const callee = value && (value.type === "call" || value.type === "call_expression") ? value.childForFieldName("function") : undefined;
        const typeNode = declaration.childForFieldName("type");
        const bases = classScope?.node.childForFieldName("superclasses");
        out.push({
          name: site.name,
          line: site.line,
          column: site.column,
          ...(classScope?.name ? { owner: classScope.name } : {}),
          ownerBases: bases ? bases.namedChildren.filter((c): c is Node => !!c && c.type !== "keyword_argument").map((c) => c.text) : [],
          ownerDecorators: classScope ? this.decoratorsOf(classScope.node) : [],
          decorators: this.decoratorsOf(declaration),
          ...(typeNode ? { typeAnnotation: typeNode.text.replace(/^:\s*/, "") } : {}),
          ...(callee && value
            ? {
                initializer: {
                  callee: callee.text.split(".").pop() ?? callee.text,
                  calleeText: callee.text,
                  ...argumentLiterals(value.childForFieldName("arguments")),
                },
              }
            : {}),
        });
      }
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  /** Decorators written on a class or member node, including those before `export`. */
  private decoratorsOf(node: Node): DecoratorInfo[] {
    const holders = [node, ...(node.parent?.type === "export_statement" ? [node.parent] : [])];
    const out: DecoratorInfo[] = [];
    for (const holder of holders) {
      for (const child of holder.namedChildren) {
        if (!child || child.type !== "decorator") continue;
        const expression = child.namedChildren[0];
        if (!expression) continue;
        const callee = expression.type === "call_expression" ? expression.childForFieldName("function") : expression;
        if (!callee) continue;
        out.push({
          name: callee.text.split(".").pop() ?? callee.text,
          ...argumentLiterals(expression.type === "call_expression" ? expression.childForFieldName("arguments") : null),
        });
      }
    }
    return out;
  }

  /**
   * Object-literal keys whose value is another expression, with the keys above them and
   * the call the object is an argument of (KDATAP-33da4c): ghost-style schema objects
   * (`members: { email: { type: 'string' } }`), Sequelize `define('User', { email: ... })`,
   * Mongoose `new Schema({ email: String })`, content types (`collectionName` +
   * `attributes`). Only `pair` keys; interface members and keyword arguments are left out.
   */
  keyDeclarations(): KeyDeclaration[] {
    const out: KeyDeclaration[] = [];
    for (const sites of this.sitesByLine.values()) {
      for (const site of sites) {
        if (site.role !== "definition" || site.kind !== "key") continue;
        const pair = site.node.parent;
        const value = pair?.type === "pair" ? pair.childForFieldName("value") : undefined;
        if (!pair || !value) continue;
        const path: string[] = [];
        let ownerPair: Node | undefined;
        for (let current = pair.parent; current; current = current.parent) {
          if (this.scopes.get(current.id)?.kind === "function") break;
          if (current.type === "pair") {
            const key = current.childForFieldName("key");
            if (key) path.push(unquote(key.text));
            ownerPair ??= current;
          }
        }
        const isObject = value.type === "object" || value.type === "dictionary";
        const kind = isObject
          ? "object"
          : isStringLiteral(value)
            ? "string"
            : value.type === "identifier" || this.memberByNode.has(value.id)
              ? "name"
              : value.type === "call_expression" || value.type === "call" || value.type === "new_expression"
                ? "call"
                : "other";
        out.push({
          name: site.name,
          line: site.line,
          column: site.column,
          path,
          ownerSiblings: ownerPair?.parent ? objectStrings(ownerPair.parent, 2) : {},
          value: {
            kind,
            text: value.text.slice(0, 60),
            ...(isObject ? { keys: pairKeys(value), strings: objectStrings(value, 1) } : { keys: [], strings: {} }),
            ...(kind === "call" ? this.callRoot(value) : {}),
          },
          ...this.keyContainer(pair),
          ...this.keyFlow(pair),
        });
      }
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  /** Where a method chain starts: `model.text().nullable()` -> `model` and `text`. */
  private callRoot(call: Node): { callRoot?: { receiver?: string; method: string } } {
    let node: Node = call;
    for (let guard = 0; guard < 16; guard += 1) {
      const callee = node.childForFieldName("function") ?? node.childForFieldName("constructor");
      if (!callee) return {};
      const member = this.memberByNode.get(callee.id);
      if (!member) return callee.type === "identifier" ? { callRoot: { method: callee.text } } : {};
      if (member.object.type === "call_expression" || member.object.type === "call") {
        node = member.object;
        continue;
      }
      return { callRoot: { receiver: member.object.text.slice(0, 60), method: unquote(member.property.text) } };
    }
    return {};
  }

  /**
   * Where a key's object literal goes: an argument or keyword argument of a call, or a
   * local variable it is assigned to that is later passed to one (KDATAP-fb8019).
   */
  private keyFlow(pair: Node): { flow?: KeyFlow } {
    let object: Node | null = pair.parent;
    if (!object) return {};
    while (object.parent && /^(parenthesized_expression|as_expression|satisfies_expression)$/.test(object.parent.type)) object = object.parent;
    const holder = object.parent;
    if (!holder) return {};
    // A keyword argument holds the object as its value.
    const argument = holder.type === "keyword_argument" && holder.childForFieldName("value")?.id === object.id ? holder : object;
    const found = this.callSiteByArgument.get(argument.id);
    if (found) return { flow: { ...this.useCall(found), hops: 1 } as KeyFlow };
    // A variable: `parameters = {...}` then `create(parameters=parameters)`.
    const target = holder.childForFieldName("name") ?? holder.childForFieldName("left");
    const value = holder.childForFieldName("value") ?? holder.childForFieldName("right");
    if (target?.type === "identifier" && value?.id === object.id) {
      const used = this.bindingUses(target.text, target.startPosition.row + 1)?.uses.find((use) => use.call);
      if (used?.call) return { flow: { ...used.call, hops: 2 } as KeyFlow };
    }
    return {};
  }

  /**
   * For each parameter of each named function, the calls inside it that the parameter is
   * passed to as a keyword or positional argument (KDATAP-fb8019): `def event(parameters):
   * Model.objects.create(parameters=parameters)`.
   */
  parameterSinks(): ParameterSink[] {
    const out: ParameterSink[] = [];
    for (const definition of this.functionDefinitions()) {
      for (const parameter of definition.parameters) {
        const uses = this.bindingUses(parameter.name, parameter.line)?.uses ?? [];
        for (const use of uses) {
          if (!use.call) continue;
          out.push({
            function: definition.name,
            ...(definition.owner ? { owner: definition.owner } : {}),
            param: parameter.name,
            position: parameter.position,
            callee: use.call.callee,
            ...(use.call.receiverClass ? { receiverClass: use.call.receiverClass } : {}),
            position0: use.call.position,
            ...(use.call.keyword ? { keyword: use.call.keyword } : {}),
          });
        }
      }
    }
    return out;
  }

  /** The call a key's object literal is an argument of. */
  private keyContainer(pair: Node): { container?: NonNullable<KeyDeclaration["container"]> } {
    let object: Node | null = pair.parent;
    if (!object) return {};
    while (object.parent && /^(parenthesized_expression|as_expression|satisfies_expression)$/.test(object.parent.type)) object = object.parent;
    const list = object.parent;
    const call = list?.parent;
    if (!list || !call || !/^(arguments|argument_list)$/.test(list.type)) return {};
    if (call.type !== "call_expression" && call.type !== "call" && call.type !== "new_expression") return {};
    const callee = call.childForFieldName("function") ?? call.childForFieldName("constructor");
    if (!callee) return {};
    const member = this.memberByNode.get(callee.id);
    const args = list.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
    const options: Record<string, string> = {};
    for (const arg of args) if (arg.type === "object" && arg.id !== object.id) Object.assign(options, objectStrings(arg, 1));
    const holder = call.parent;
    const target = holder?.childForFieldName("name") ?? holder?.childForFieldName("left");
    return {
      container: {
        callee: unquote((member ? member.property : callee).text),
        constructed: call.type === "new_expression",
        position: args.findIndex((a) => a.id === object.id),
        strings: args.filter(isStringLiteral).map((a) => unquote(a.text)),
        options,
        ...(member ? { receiver: member.object.text.slice(0, 60) } : {}),
        ...(target && target.type === "identifier" && (holder?.childForFieldName("value")?.id === call.id || holder?.childForFieldName("right")?.id === call.id)
          ? { assignedTo: target.text }
          : {}),
      },
    };
  }

  /** Classes and interfaces defined in the file, with their extent. */
  classDefinitions(): ClassDefinition[] {
    const out: ClassDefinition[] = [];
    for (const scope of this.scopes.values()) {
      if (scope.kind === "class" && scope.name) {
        out.push({ name: scope.name, line: scope.node.startPosition.row + 1, endLine: scope.node.endPosition.row + 1 });
      }
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /**
   * Named object types (KDATAP-e3ff3c): `interface X { ... }` and `type X = { ... }` with
   * their property signatures. Grammars without these nodes yield none.
   */
  recordTypes(): RecordType[] {
    const out: RecordType[] = [];
    for (const node of this.tree.rootNode.descendantsOfType(["interface_declaration", "type_alias_declaration"])) {
      if (!node) continue;
      const name = node.childForFieldName("name")?.text;
      const body = node.type === "interface_declaration" ? node.childForFieldName("body") : node.childForFieldName("value");
      if (!name || !body || (body.type !== "interface_body" && body.type !== "object_type")) continue;
      const members: RecordType["members"] = [];
      for (const member of body.namedChildren) {
        if (!member || member.type !== "property_signature") continue;
        const key = member.childForFieldName("name");
        if (!key) continue;
        const type = member.childForFieldName("type")?.text.replace(/^:\s*/, "");
        members.push({
          name: key.text.replace(/^['"]|['"]$/g, ""),
          line: key.startPosition.row + 1,
          optional: member.children.some((c) => c?.type === "?"),
          ...(type ? { type } : {}),
        });
      }
      out.push({ name, line: node.startPosition.row + 1, members });
    }
    return out.sort((a, b) => a.line - b.line);
  }

  /**
   * Every `@definition.field` and `@definition.key` in the file, the places a data field
   * or key gets its name (KDATAP-059e1e). A field's owner is its class; a key's owner is
   * `definitionOwner`'s (the object key or class that contains it).
   */
  memberDefinitions(): MemberDefinition[] {
    const out: MemberDefinition[] = [];
    for (const sites of this.sitesByLine.values()) {
      for (const site of sites) {
        if (site.role !== "definition" || (site.kind !== "field" && site.kind !== "key")) continue;
        const owner =
          site.kind === "field"
            ? this.enclosingClass(site.line, site.column)?.name
            : this.definitionOwner(site.line, site.column);
        out.push({
          name: site.name,
          kind: site.kind,
          line: site.line,
          column: site.column,
          ...(owner ? { owner } : {}),
        });
      }
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
  }

  // ---- class resolution ------------------------------------------------------------

  /** The name of the class whose body contains a node. */
  private enclosingClassOf(node: Node): string | undefined {
    return this.enclosing(node.startPosition.row + 1, node.startPosition.column, "class")?.name;
  }

  /**
   * The enclosing class when it is a stored model (`class User < ApplicationRecord`): only
   * a model's own attributes are its columns. In a service, job or controller, `self.x` and
   * a bare `x` are that object's helpers, not stored data.
   */
  private enclosingModelOf(node: Node): string | undefined {
    for (let current: Node | null = node.parent; current; current = current.parent) {
      if (this.scopes.get(current.id)?.kind !== "class") continue;
      const superclass = current.childForFieldName("superclass")?.text ?? "";
      if (!/(?:ApplicationRecord|ActiveRecord::Base|Record)\s*$/.test(superclass)) return undefined;
      return this.enclosingClassOf(node);
    }
    return undefined;
  }

  /**
   * Ruby implicit self (KDATAP-e35652): a concept site that is a receiverless method call
   * (`email` with no local binding inside a model method) or a symbol argument of a
   * receiverless call (`validates :email`) belongs to the enclosing class.
   */
  implicitSelfClass(line: number, isConcept: (token: string) => boolean): string | undefined {
    if (!this.config.implicitSelf) return undefined;
    for (const site of this.sitesOnLine(line)) {
      if (site.role !== "reference" || !isConcept(site.name)) continue;
      if (this.definitionsOf(site.name, site.node)?.length) continue;
      const cls = this.enclosingModelOf(site.node);
      if (cls) return cls;
    }
    for (const call of this.invocationNodes) {
      if (call.call.startPosition.row !== line - 1 || call.call.childForFieldName("receiver")) continue;
      const args = call.call.childForFieldName("arguments");
      const symbols = (args?.namedChildren ?? []).filter((arg): arg is Node => !!arg && arg.type === "simple_symbol");
      if (symbols.some((symbol) => isConcept(unquote(symbol.text)))) {
        const cls = this.enclosingModelOf(call.call);
        if (cls) return cls;
      }
    }
    return undefined;
  }

  private isSelfNode(node: Node): boolean {
    return this.config.selfNodeTypes.includes(node.type) || this.config.selfNames.includes(node.text);
  }

  private receiverClass(node: Node, depth: number): string | undefined {
    if (depth > 4) return undefined;
    if (node.type === "identifier") {
      return this.classOfBinding(node.text, node, depth) ?? this.staticClass(node);
    }
    if (this.config.implicitSelf) {
      if (this.isSelfNode(node)) return this.enclosingModelOf(node);
      if (node.type === "instance_variable") return this.classOfField(node.text, node, depth);
      if (node.type === "constant" || node.type === "scope_resolution") return this.staticClass(node);
    }
    const member = this.memberByNode.get(node.id);
    if (member) {
      if (this.isSelfNode(member.object)) return this.classOfField(unquote(member.property.text), node, depth);
      return this.staticClass(node);
    }
    return undefined;
  }

  /** A class named in the expression itself: `User`, `User.objects`, `models.User`. */
  private staticClass(node: Node): string | undefined {
    // Ruby constants: `User`; a namespaced model keeps its namespace, as its table does
    // (`Channel::Email` -> `ChannelEmail`, table channel_email).
    if (node.type === "constant" || node.type === "scope_resolution") {
      const name = node.text.replace(/^::/, "").split("::").join("");
      return isClassName(name) ? name : undefined;
    }
    if (node.type === "identifier") {
      if (!isClassName(node.text)) return undefined;
      const defs = this.definitionsOf(node.text, node);
      const kind = defs?.[0]?.kind;
      return defs === undefined || kind === "import" || kind === "class" ? node.text : undefined;
    }
    const member = this.memberByNode.get(node.id);
    if (member) {
      const property = unquote(member.property.text);
      if (isClassName(property) && !this.isSelfNode(member.object)) return property;
      // Ruby: a constant is a stored model only when queried or built through ActiveRecord
      // (`Contact.find_by(...)`, `User.new(...)`), and not a service-style class;
      // `Rails.logger`, `IdentifierSyncService.new(...).perform` are not data owners.
      if (this.config.implicitSelf && (member.object.type === "constant" || member.object.type === "scope_resolution")) {
        const model = this.staticClass(member.object);
        return model && ACTIVE_RECORD_METHODS.has(property) && !RUBY_SERVICE_CLASS.test(model) ? model : undefined;
      }
      return this.staticClass(member.object);
    }
    const callee = this.callByNode.get(node.id);
    return callee ? this.staticClass(callee) : undefined;
  }

  private classOfBinding(name: string, anchor: Node, depth: number): string | undefined {
    for (const def of this.definitionsOf(name, anchor) ?? []) {
      const found = this.classOfDefinition(def, depth);
      if (found) return found;
    }
    return undefined;
  }

  private classOfField(name: string, anchor: Node, depth: number): string | undefined {
    let scope: Scope | undefined = this.scopeAround(anchor);
    while (scope && scope.kind !== "class") scope = scope.parent;
    if (!scope) return undefined;
    for (const def of [...(scope.defs.get(name) ?? []), ...(scope.implicitFields.get(name) ?? [])]) {
      const found = this.classOfDefinition(def, depth);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * The class a definition holds: its type annotation (the grammar's `type` field), else
   * the value assigned to it (`new C()`, a call of a class in Python, another binding).
   */
  private classOfDefinition(def: SiteDefinition, depth: number): string | undefined {
    if (depth > 4) return undefined;
    let target = def.node;
    const outer = target.parent;
    if (outer && this.memberByNode.has(outer.id)) target = outer;
    const holder = target.parent;
    if (!holder) return undefined;
    const isTarget = (field: string): boolean => holder.childForFieldName(field)?.id === target.id;
    const declaresTarget =
      isTarget("name") || isTarget("left") || isTarget("pattern") || holder.type.includes("parameter");
    if (!declaresTarget) return undefined;
    const type = holder.childForFieldName("type");
    if (type && type.id !== target.id) {
      const annotated = classFromType(type.text);
      if (annotated) return annotated;
    }
    const value = holder.childForFieldName("value") ?? holder.childForFieldName("right");
    return value ? this.classOfValue(value, depth + 1) : undefined;
  }

  private classOfValue(node: Node, depth: number): string | undefined {
    let value: Node = node;
    while (["await_expression", "parenthesized_expression", "non_null_expression", "as_expression"].includes(value.type)) {
      const inner: Node | null = value.namedChildren[0] ?? null;
      if (!inner) return undefined;
      value = inner;
    }
    const constructed = value.childForFieldName("constructor");
    if (constructed) return lastSegment(constructed.text);
    if (this.config.constructsByCall && value.type === "call") {
      const callee = value.childForFieldName("function");
      const name = callee ? lastSegment(callee.text) : undefined;
      // A reference field (`models.ForeignKey(User, ...)`, `OneToOneField("account.User")`)
      // holds its target model; other ORM field classes (`models.EmailField()`) are not
      // entities.
      if (name && this.config.referenceFieldClasses?.includes(name)) {
        const args = value.childForFieldName("arguments");
        const first = args?.namedChildren.find((child): child is Node => !!child && child.type !== "comment");
        if (!first) return undefined;
        const target = unquote(first.text).split(".").pop()?.trim() ?? "";
        if (target === "self") return this.enclosing(first.startPosition.row + 1, first.startPosition.column, "class")?.name;
        return isClassName(target) ? target : undefined;
      }
      if (name && /Field$/.test(name) && this.config.referenceFieldClasses) return undefined;
      if (name && isClassName(name)) return name;
    }
    if (value.type === "identifier" || this.memberByNode.has(value.id)) {
      return this.receiverClass(value, depth);
    }
    if (this.factoryReturnTypes && (value.type === "call_expression" || value.type === "call")) {
      return this.returnClassOfCall(value) ?? this.staticFactoryClass(value);
    }
    return undefined;
  }

  /** Classes known repo-wide, for typing ORM static factories (`User.findOne`). */
  setKnownClass(known: ((name: string) => boolean) | undefined): void {
    this.knownClass = known;
  }

  /**
   * The model class a static factory call returns an instance of (KDATAP-c8a46a):
   * `this.models.User.getOwnerUser()`, `User.objects.get(pk=pk)`, `Member.findAll()`.
   * The receiver chain must start at a class, optionally through the pack's manager
   * attributes. The class must be reached through a `models.` chain, defined in this
   * file, or known to the repository; other callees are not typed.
   */
  private staticFactoryClass(call: Node): string | undefined {
    const callee = call.childForFieldName("function");
    const member = callee ? this.memberByNode.get(callee.id) : undefined;
    if (!member || this.isSelfNode(member.object)) return undefined;
    let node = member.object;
    const managers = this.config.managerAttributes ?? [];
    for (;;) {
      const inner = this.memberByNode.get(node.id);
      if (inner && managers.includes(unquote(inner.property.text))) node = inner.object;
      else break;
    }
    let name: string | undefined;
    let viaModels = false;
    if (node.type === "identifier") {
      if (!isClassName(node.text)) return undefined;
      name = node.text;
      const kind = this.definitionsOf(name, node)?.[0]?.kind;
      if (kind === "class") return name;
    } else {
      const inner = this.memberByNode.get(node.id);
      if (!inner) return undefined;
      const property = unquote(inner.property.text);
      if (!isClassName(property)) return undefined;
      name = property;
      viaModels = /(^|\.)models$/.test(inner.object.text.trim());
    }
    return viaModels || this.knownClass?.(name) ? name : undefined;
  }

  /**
   * The class a call returns when the called function or method is defined in this file
   * (or this file's class) with a declared return type: `this.getUsersService(schema)`
   * where `getUsersService(schema): UsersService` (KDATAP-c8a46a).
   */
  private returnClassOfCall(call: Node): string | undefined {
    // Not `callByNode`: a call without arguments has no entry there.
    const callee = call.childForFieldName("function");
    if (!callee) return undefined;
    let defs: SiteDefinition[] | undefined;
    const member = this.memberByNode.get(callee.id);
    if (member) {
      if (!this.isSelfNode(member.object)) return undefined;
      let scope: Scope | undefined = this.scopeAround(call);
      while (scope && scope.kind !== "class") scope = scope.parent;
      defs = scope?.defs.get(unquote(member.property.text));
    } else if (callee.type === "identifier") {
      defs = this.definitionsOf(callee.text, callee);
    }
    for (const def of defs ?? []) {
      if (def.kind !== "function") continue;
      const type = def.node.parent?.childForFieldName("return_type");
      const found = type ? classFromType(type.text) : undefined;
      if (found) return found;
    }
    return undefined;
  }

  /** Turn the factory return-type resolution off, to measure it (KDATAP-c8a46a). */
  setFactoryReturnTypes(enabled: boolean): void {
    this.factoryReturnTypes = enabled;
  }

  /** Names of the classes and interfaces defined in this file. */
  classNames(): string[] {
    const out = new Set<string>();
    for (const scope of this.scopes.values()) {
      for (const defs of scope.defs.values()) {
        for (const def of defs) if (def.kind === "class" && isClassName(def.name)) out.add(def.name);
      }
    }
    return [...out];
  }

  /**
   * How a receiver is named when its class is not known: `usersService` for
   * `usersService.x()` and `this.usersService.x()`. Undefined for other shapes.
   */
  receiverBindingName(node: Node): string | undefined {
    if (node.type === "identifier") return isClassName(node.text) ? undefined : node.text;
    const member = this.memberByNode.get(node.id);
    if (member && this.isSelfNode(member.object)) return unquote(member.property.text);
    return undefined;
  }

  /**
   * Receivers of the typed methods a payload object reaches (KDATAP-c8a46a). A concept
   * key or value inside an object literal assigned to a variable belongs to the receiver
   * when that variable, or one derived from it on a later line of the same function
   * (at most two hops), is passed to a method of a typed receiver.
   */
  payloadReceivers(line: number, concept: (name: string) => boolean): ReceiverInfo {
    const found: ReceiverInfo = { names: [] };
    for (const site of this.sitesOnLine(line)) {
      if (!concept(site.name) || site.role === "member") continue;
      const holder = this.payloadHolder(site.node);
      if (!holder) continue;
      this.traceVariable(holder.name, holder.node, 0, found, new Set());
      if (found.className) return found;
    }
    return found;
  }

  private isBoundary(node: Node): boolean {
    return this.scopes.get(node.id)?.kind === "function" || /(^|_)statement$|^block$|^statement_block$|_declaration$|^program$|^module$/.test(node.type);
  }

  /** The variable an object literal enclosing this node is assigned to. */
  private payloadHolder(start: Node): { name: string; node: Node } | undefined {
    let current: Node = start;
    let sawObject = false;
    for (let depth = 0; depth < 24; depth += 1) {
      const parent = current.parent;
      if (!parent || this.isBoundary(parent)) return undefined;
      const callee = this.callByNode.get(parent.id);
      if (callee && callee.id !== current.id) return undefined;
      if (["object", "dictionary"].includes(parent.type)) sawObject = true;
      const target = this.declaredTarget(parent, current);
      if (target) return sawObject ? { name: target.text, node: target } : undefined;
      current = parent;
    }
    return undefined;
  }

  /** The identifier a declaration or assignment binds when `child` is its value. */
  private declaredTarget(holder: Node, child: Node): Node | undefined {
    const value = holder.childForFieldName("value") ?? holder.childForFieldName("right");
    if (!value || value.id !== child.id) return undefined;
    const target = holder.childForFieldName("name") ?? holder.childForFieldName("left");
    return target && target.type === "identifier" ? target : undefined;
  }

  private traceVariable(name: string, declared: Node, hops: number, out: ReceiverInfo, seen: Set<string>): void {
    if (seen.has(name)) return;
    seen.add(name);
    let scope: Scope | undefined = this.scopeAround(declared);
    while (scope && scope.kind !== "function" && scope.kind !== "module") scope = scope.parent;
    const end = (scope ?? this.rootScope).node.endPosition.row;
    for (let row = declared.endPosition.row; row <= end; row += 1) {
      for (const site of this.sitesByLine.get(row) ?? []) {
        if (site.role !== "reference" || site.name !== name || site.node.startIndex <= declared.endIndex) continue;
        this.followUse(site.node, hops, out, seen);
        if (out.className) return;
      }
    }
  }

  private followUse(use: Node, hops: number, out: ReceiverInfo, seen: Set<string>): void {
    let current: Node = use;
    for (let depth = 0; depth < 24; depth += 1) {
      const parent = current.parent;
      if (!parent || this.isBoundary(parent)) return;
      const callee = this.callByNode.get(parent.id);
      if (callee && callee.id !== current.id) {
        const member = this.memberByNode.get(callee.id);
        const className = member ? this.receiverClass(member.object, 0) : undefined;
        if (className) {
          out.className = className;
          return;
        }
        const bindingName = member ? this.receiverBindingName(member.object) : undefined;
        if (bindingName && !this.derivesVariable(parent)) {
          out.names.push(bindingName);
          return;
        }
      }
      const target = this.declaredTarget(parent, current);
      if (target) {
        if (hops < 2) this.traceVariable(target.text, target, hops + 1, out, seen);
        return;
      }
      current = parent;
    }
  }

  /** Whether the expression's value is stored in a variable (through `await`, parentheses). */
  private derivesVariable(expression: Node): boolean {
    let current: Node = expression;
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = current.parent;
      if (!parent) return false;
      if (this.declaredTarget(parent, current)) return true;
      if (!["await_expression", "parenthesized_expression", "as_expression", "non_null_expression"].includes(parent.type)) return false;
      current = parent;
    }
    return false;
  }

  // ---- indexing ------------------------------------------------------------------

  private newScope(node: Node, kind: ScopeKind): Scope {
    const existing = this.scopes.get(node.id);
    if (existing) {
      // The same node may be captured as @scope and @scope.function; keep the specific kind.
      if (kind !== "block") existing.kind = kind;
      return existing;
    }
    const scope: Scope = { node, kind, defs: new Map(), implicitFields: new Map() };
    this.scopes.set(node.id, scope);
    return scope;
  }

  private scopeAround(node: Node): Scope {
    let current: Node | null = node;
    while (current) {
      const scope = this.scopes.get(current.id);
      if (scope) return scope;
      current = current.parent;
    }
    return this.rootScope;
  }

  private enclosing(line: number, column: number, kind: ScopeKind): EnclosingRange | undefined {
    const node = this.tree.rootNode.descendantForPosition({ row: line - 1, column });
    let scope: Scope | undefined = node ? this.scopeAround(node) : undefined;
    while (scope && scope.kind !== kind) scope = scope.parent;
    if (!scope) return undefined;
    return {
      ...(scope.name ? { name: scope.name } : {}),
      startLine: scope.node.startPosition.row + 1,
      endLine: scope.node.endPosition.row + 1,
    };
  }

  private index(query: Query): void {
    const matches = query.matches(this.tree.rootNode);
    const scopeNodes: Array<{ node: Node; kind: ScopeKind }> = [];
    const definitions = new Map<number, { kind: DefinitionKind; node: Node }>();
    const references: Node[] = [];
    const members: Array<{ node: Node; object: Node; property: Node }> = [];
    const callArguments: Array<{ callee: Node; argument: Node }> = [];

    for (const match of matches) {
      const byName = new Map<string, Node[]>();
      for (const capture of match.captures) {
        const list = byName.get(capture.name) ?? [];
        list.push(capture.node);
        byName.set(capture.name, list);
      }
      for (const [captureName, nodes] of byName) {
        if (captureName === "scope") for (const n of nodes) scopeNodes.push({ node: n, kind: "block" });
        else if (captureName === "scope.function") for (const n of nodes) scopeNodes.push({ node: n, kind: "function" });
        else if (captureName === "scope.class") for (const n of nodes) scopeNodes.push({ node: n, kind: "class" });
        else if (captureName === "reference") references.push(...nodes);
        else if (captureName === "import.name") for (const n of nodes) addDefinition(definitions, "import", n);
        else if (captureName.startsWith("definition.")) {
          const kind = captureName.slice("definition.".length) === "variable" ? "local" : (captureName.slice("definition.".length) as DefinitionKind);
          for (const n of nodes) {
            const targets = kind === "local" || kind === "parameter" ? this.bindings(n) : [n];
            for (const target of targets) addDefinition(definitions, kind, target);
          }
        }
      }
      const member = byName.get("member")?.[0];
      const object = byName.get("member.object")?.[0];
      const property = byName.get("member.property")?.[0];
      if (member && object && property) members.push({ node: member, object, property });
      const invocation = byName.get("invocation")?.[0];
      const invoked = byName.get("invocation.callee")?.[0];
      if (invocation && invoked) this.invocationNodes.push({ call: invocation, callee: invoked });
      const call = byName.get("call")?.[0];
      const callee = byName.get("call.callee")?.[0];
      if (call && callee) {
        this.callByNode.set(call.id, callee);
        const argument = byName.get("call.argument")?.[0];
        if (argument) {
          callArguments.push({ callee, argument });
        }
      }
    }

    // Scopes: nearest enclosing scope node becomes the parent.
    for (const { node, kind } of scopeNodes) this.newScope(node, kind);
    for (const scope of this.scopes.values()) {
      if (scope === this.rootScope) continue;
      let ancestor = scope.node.parent;
      while (ancestor && !this.scopes.has(ancestor.id)) ancestor = ancestor.parent;
      scope.parent = ancestor ? this.scopes.get(ancestor.id) : this.rootScope;
    }

    const sorted = [...definitions.values()].sort(
      (a, b) => a.node.startIndex - b.node.startIndex,
    );
    for (const { kind, node } of sorted) this.place(kind, node);

    for (const m of members) {
      this.memberByNode.set(m.node.id, { object: m.object, property: m.property });
      this.memberByProperty.set(m.property.id, { object: m.object, property: m.property });
    }
    for (const m of members) this.addMemberSite(m.property, m.object, m.property.text);
    for (const { callee, argument } of callArguments) this.addCallSite(callee, argument);
    // `x.get("key")`: the string argument is the property of a call on `x.get`.
    for (const { callee, argument } of callArguments) {
      const calleeMember = this.memberByNode.get(callee.id);
      if (!calleeMember || !/^[A-Za-z]{0,2}["'`]/.test(argument.text)) continue;
      this.addMemberSite(argument, calleeMember.object, calleeMember.property.text);
    }

    const memberProperties = new Set(members.map((m) => m.property.id));
    for (const node of references) {
      if (definitions.has(node.id) || memberProperties.has(node.id)) continue;
      this.addSite(node.startPosition.row, {
        role: "reference",
        name: node.text,
        node,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        inCallee: this.isWithinCallee(node),
      });
    }
  }

  private addCallSite(callee: Node, argument: Node): void {
    // In Ruby the callee is the call's method name; its member access is the call itself.
    const member = this.memberByNode.get(callee.id) ?? this.memberByProperty.get(callee.id);
    const { nameNode } = this.calleeNameNode(callee, member);
    if (!member && callee.type !== "identifier") return;
    const list = argument.parent;
    if (!list) return;
    const siblings = list.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
    const position = siblings.findIndex((c) => c.id === argument.id);
    if (position < 0) return;
    // A keyword argument: `name=value` (Python), or a hash pair `email: value` (Ruby).
    const keywordNode = argument.childForFieldName("name") ?? (argument.type === "pair" ? argument.childForFieldName("key") : null);
    const keyword = keywordNode && argument.childForFieldName("value") ? unquote(keywordNode.text.replace(/:$/, "")) : undefined;
    const row = argument.startPosition.row;
    const sites = this.callSitesByRow.get(row) ?? [];
    const site = {
      callee: unquote(nameNode.text),
      position,
      ...(keyword ? { keyword } : {}),
      line: row + 1,
      argument,
      ...(member ? { receiver: member.object } : {}),
    };
    sites.push(site);
    this.callSiteByArgument.set(argument.id, site);
    this.callSitesByRow.set(row, sites);
  }

  /**
   * The node naming the function a call calls. A deferred call (`send_email_task.delay(...)`
   * in Celery) calls the function it is made on: the callee is `send_email_task`, not `delay`.
   */
  private calleeNameNode(callee: Node, member: { object: Node; property: Node } | undefined): { nameNode: Node; deferred: boolean } {
    let nameNode = member ? member.property : callee;
    let deferred = false;
    if (member && this.config.deferredCallMethods?.includes(unquote(member.property.text))) {
      const target = this.memberByNode.get(member.object.id)?.property ?? member.object;
      if (target.type === "identifier" || this.memberByNode.has(member.object.id)) {
        nameNode = target;
        deferred = true;
      }
    }
    return { nameNode, deferred };
  }

  /** Bound names inside a pattern node: destructuring, tuple targets, parameter shapes. */
  private bindings(node: Node): Node[] {
    const out: Node[] = [];
    const visit = (n: Node): void => {
      if (this.config.nonBindingNodeTypes.includes(n.type)) return;
      if (this.config.bindingLeafTypes.includes(n.type)) {
        out.push(n);
        return;
      }
      const skipFields = this.config.nonBindingChildFields[n.type] ?? [];
      const children = n.children;
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (!child || !child.isNamed) continue;
        if (skipFields.length > 0 && skipFields.includes(n.fieldNameForChild(i) ?? "")) continue;
        visit(child);
      }
    };
    visit(node);
    return out;
  }

  private place(kind: DefinitionKind, node: Node): void {
    const name = kind === "key" ? unquote(node.text) : node.text;
    const def: SiteDefinition = {
      kind,
      name,
      node,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
    };
    if (kind === "key") {
      this.addSite(node.startPosition.row, { role: "definition", ...def });
      return;
    }
    if (kind === "field") {
      const cls = this.nearestScope(node.parent, (s) => s.kind === "class");
      const direct = cls !== undefined && this.scopeAround(node) === cls;
      this.addSite(node.startPosition.row, { role: "definition", ...def, ...(direct ? {} : { implicit: true }) });
      if (!cls) return;
      push(direct ? cls.defs : cls.implicitFields, name, def);
      return;
    }

    this.addSite(node.startPosition.row, { role: "definition", ...def });

    let scope: Scope;
    if (kind === "function" || kind === "class") {
      // The name of a function or class belongs to the scope around it; a namespaced Ruby
      // class (`class Account::SignUpService`) names it through the scope resolution.
      const holder = node.parent?.type === "scope_resolution" ? node.parent.parent : node.parent;
      const own = holder ? this.scopes.get(holder.id) : undefined;
      if (own) {
        if (own.name === undefined) own.name = name;
        scope = own.parent ?? this.rootScope;
      } else {
        scope = this.scopeAround(node);
      }
    } else if (kind === "local" && node.parent && this.hoistsToFunction(node)) {
      scope = this.nearestScope(node.parent, (s) => s.kind === "function" || s.kind === "module") ?? this.rootScope;
    } else {
      scope = this.scopeAround(node);
    }
    push(scope.defs, name, def);
  }

  private hoistsToFunction(node: Node): boolean {
    let current: Node | null = node.parent;
    for (let depth = 0; current && depth < 6; depth += 1) {
      if (this.config.hoistedDeclarationParents.includes(current.type)) return true;
      if (this.scopes.has(current.id)) return false;
      current = current.parent;
    }
    return false;
  }

  private nearestScope(from: Node | null, test: (scope: Scope) => boolean): Scope | undefined {
    let scope: Scope | undefined = from ? this.scopeAround(from) : undefined;
    while (scope && !test(scope)) scope = scope.parent;
    return scope;
  }

  private addSite(row: number, site: Site): void {
    const list = this.sitesByLine.get(row) ?? [];
    list.push(site);
    this.sitesByLine.set(row, list);
  }

  /**
   * `selfFallback` is the member a bare `this`/`self` chain points at when the chain
   * has no properties of its own: the accessed property, or the called method.
   */
  private addMemberSite(propertyNode: Node, objectNode: Node, selfFallback: string): void {
    let root = this.rootOf(objectNode);
    if (root.type === "self" && root.firstMember === undefined) {
      root = { ...root, firstMember: selfFallback };
    }
    this.addSite(propertyNode.startPosition.row, {
      role: "member",
      name: unquote(propertyNode.text),
      node: propertyNode,
      line: propertyNode.startPosition.row + 1,
      column: propertyNode.startPosition.column,
      root,
      object: objectNode,
      inCallee: this.isWithinCallee(propertyNode),
    });
  }

  private isWithinCallee(node: Node): boolean {
    let current: Node = node;
    for (let depth = 0; depth < 24; depth += 1) {
      const parent = current.parent;
      if (!parent) return false;
      const callee = this.callByNode.get(parent.id);
      if (callee) return callee.id === current.id;
      current = parent;
    }
    return false;
  }

  /** Follow property access and calls down to where a chain starts. */
  private rootOf(start: Node): MemberRoot {
    const props: string[] = [];
    let node: Node = start;
    for (let guard = 0; guard < 64; guard += 1) {
      const member = this.memberByNode.get(node.id);
      if (member) {
        props.push(unquote(member.property.text));
        node = member.object;
        continue;
      }
      const callee = this.callByNode.get(node.id);
      if (callee) {
        node = callee;
        continue;
      }
      break;
    }
    if (this.config.selfNodeTypes.includes(node.type) || this.config.selfNames.includes(node.text)) {
      return { type: "self", firstMember: props[props.length - 1], node };
    }
    if (node.type === "identifier" || this.config.bindingLeafTypes.includes(node.type)) {
      return { type: "identifier", name: node.text, node };
    }
    return { type: "other" };
  }
}

function isStringLiteral(node: Node): boolean {
  return /^(string|template_string|concatenated_string)$/.test(node.type);
}

/** String-literal arguments, and the pairs of object-literal or keyword arguments. */
function argumentLiterals(args: Node | null | undefined): { strings: string[]; options: Record<string, string> } {
  const strings: string[] = [];
  const options: Record<string, string> = {};
  for (const arg of args?.namedChildren ?? []) {
    if (!arg || arg.type === "comment") continue;
    if (isStringLiteral(arg)) strings.push(unquote(arg.text));
    else if (arg.type === "object") Object.assign(options, objectStrings(arg, 1));
    else if (arg.type === "keyword_argument") {
      const key = arg.childForFieldName("name");
      const value = arg.childForFieldName("value");
      if (key && value) options[key.text] = isStringLiteral(value) ? unquote(value.text) : value.text.slice(0, 60);
    }
  }
  return { strings, options };
}

function pairKeys(object: Node): string[] {
  return object.namedChildren
    .filter((c): c is Node => !!c && c.type === "pair")
    .map((pair) => unquote(pair.childForFieldName("key")?.text ?? ""));
}

/**
 * Pairs of an object literal whose value is a string (unquoted) or a plain name or member
 * (`type: DataTypes.STRING`); with `depth` 2, the string pairs of object values too, under
 * dotted keys (`info.name`).
 */
function objectStrings(object: Node, depth: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of object.namedChildren) {
    if (!pair || pair.type !== "pair") continue;
    const key = pair.childForFieldName("key");
    const value = pair.childForFieldName("value");
    if (!key || !value) continue;
    const name = unquote(key.text);
    if (isStringLiteral(value)) out[name] = unquote(value.text);
    else if (value.type === "identifier" || value.type === "member_expression") out[name] = value.text.slice(0, 60);
    else if (value.type === "object" && depth > 1) {
      for (const [inner, text] of Object.entries(objectStrings(value, depth - 1))) out[`${name}.${inner}`] = text;
    }
  }
  return out;
}

function addDefinition(
  map: Map<number, { kind: DefinitionKind; node: Node }>,
  kind: DefinitionKind,
  node: Node,
): void {
  const existing = map.get(node.id);
  if (!existing || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(existing.kind)) {
    map.set(node.id, { kind, node });
  }
}

function push(map: Map<string, SiteDefinition[]>, name: string, def: SiteDefinition): void {
  const list = map.get(name) ?? [];
  list.push(def);
  list.sort((a, b) => a.line - b.line || a.column - b.column);
  map.set(name, list);
}

/** The first declaration in the scope. */
function pick(defs: SiteDefinition[] | undefined): SiteDefinition | undefined {
  return defs?.[0];
}

const OUTPUT_KIND: Record<DefinitionKind, DeclarationKind> = {
  function: "function",
  class: "class",
  parameter: "parameter",
  local: "local",
  field: "field",
  key: "field",
  import: "import",
};

function toDeclaration(def: SiteDefinition): SameFileDeclaration {
  return { line: def.line, kind: OUTPUT_KIND[def.kind] };
}

const NOT_CLASSES = new Set([
  "Object", "Array", "JSON", "Math", "Promise", "String", "Number", "Date", "Buffer", "Error",
  "Set", "Map", "Symbol", "Reflect", "Boolean", "Response", "Request", "URL", "None", "True", "False",
]);

/** `UsersService`, `User`: starts uppercase and is not all capitals or a builtin. */
function isClassName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*$/.test(name) && !NOT_CLASSES.has(name);
}

function lastSegment(text: string): string | undefined {
  const name = text.split(".").pop()?.trim();
  return name && isClassName(name) ? name : undefined;
}

/** The class named by a type annotation: `: User`, `"User"`, `models.User | None`. */
function classFromType(text: string): string | undefined {
  let type = text.trim().replace(/^:\s*/, "");
  const optional = /^Optional\[(.+)\]$/.exec(type);
  if (optional) type = optional[1];
  type = type.replace(/\s*\|\s*(None|null|undefined)\b/g, "").replace(/\?$/, "").trim();
  const promised = /^Promise<(.+)>$/.exec(type);
  if (promised) type = promised[1].trim();
  type = unquote(type);
  return /^(?:[A-Za-z_]\w*\.)*[A-Z]\w*$/.test(type) ? lastSegment(type) : undefined;
}
