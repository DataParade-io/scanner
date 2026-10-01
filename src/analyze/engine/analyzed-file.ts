import type { Node, Query, Tree } from "web-tree-sitter";
import type {
  DeclarationKind,
  CallSite,
  EnclosingRange,
  FunctionDefinition,
  LanguagePack,
  PackConfig,
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

function unquote(text: string): string {
  const m = /^[A-Za-z]{0,2}("""|'''|"|'|`)([\s\S]*)\1$/.exec(text);
  return m ? m[2] : text;
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
  private readonly callByNode = new Map<number, Node>();
  private readonly callSitesByRow = new Map<number, Array<CallSite & { argument: Node; receiver?: Node }>>();
  private readonly nodeToScopeName = new Map<number, string>();
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
      let position = 0;
      params.forEach((param, index) => {
        const names = this.bindings(param);
        if (index === 0 && names.length === 1 && skipFirst.includes(names[0].text)) return;
        if (names.length === 1) {
          parameters.push({ name: names[0].text, position, line: names[0].startPosition.row + 1 });
        }
        position += 1;
      });
      out.push({ name, line: (nameNode ?? scope.node).startPosition.row + 1, parameters });
    }
    return out.sort((a, b) => a.line - b.line);
  }

  // ---- class resolution ------------------------------------------------------------

  private isSelfNode(node: Node): boolean {
    return this.config.selfNodeTypes.includes(node.type) || this.config.selfNames.includes(node.text);
  }

  private receiverClass(node: Node, depth: number): string | undefined {
    if (depth > 4) return undefined;
    if (node.type === "identifier") {
      return this.classOfBinding(node.text, node, depth) ?? this.staticClass(node);
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
    const member = this.memberByNode.get(callee.id);
    let nameNode = member ? member.property : callee;
    // A deferred call (`send_email_task.delay(...)` in Celery) calls the function it is
    // made on: the callee is `send_email_task`, not `delay`.
    if (member && this.config.deferredCallMethods?.includes(unquote(member.property.text))) {
      const target = this.memberByNode.get(member.object.id)?.property ?? member.object;
      if (target.type === "identifier" || this.memberByNode.has(member.object.id)) nameNode = target;
    }
    if (!member && callee.type !== "identifier") return;
    const list = argument.parent;
    if (!list) return;
    const siblings = list.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
    const position = siblings.findIndex((c) => c.id === argument.id);
    if (position < 0) return;
    const keywordNode = argument.childForFieldName("name");
    const keyword = keywordNode && argument.childForFieldName("value") ? keywordNode.text : undefined;
    const row = argument.startPosition.row;
    const sites = this.callSitesByRow.get(row) ?? [];
    sites.push({
      callee: unquote(nameNode.text),
      position,
      ...(keyword ? { keyword } : {}),
      line: row + 1,
      argument,
      ...(member ? { receiver: member.object } : {}),
    });
    this.callSitesByRow.set(row, sites);
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
      // The name of a function or class belongs to the scope around it.
      const own = node.parent ? this.scopes.get(node.parent.id) : undefined;
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
