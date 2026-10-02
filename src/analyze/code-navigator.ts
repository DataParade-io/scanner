import path from "path";
import type { FileInfo } from "../core/types/file";
import type { AnalyzedFile, Site } from "./engine/analyzed-file";
import { candidatesForFile, collapseColumns, schemaFileCandidates, type ColumnCandidate } from "./column-catalog";
import type { SchemaFile } from "../ingest/schema-files";
import { analyzeSource, isAnalysisEngineReady } from "./engine/engine";
import type { BindingUse, FunctionDefinition, InvocationArgument } from "./engine/types";
import { packForFile } from "./languages";

/**
 * Code navigator over the tree-sitter engine (KDATAP-059e1e): LSP-style answers
 * (outline, symbols on a line, definition, callers, key writers) for tools that trace a
 * occurrence to the data it reads. Deterministic, no model calls. The repository is indexed
 * once into plain data (the parse trees are freed); per-file questions parse the file again.
 * `uses` and `members` walk forward from a value: where a binding goes, and who reads or
 * writes a field.
 */

/** Results returned per request unless the request sets `limit`. */
export const DEFAULT_LIMIT = 8;
/** Columns returned per `columns` request unless it sets `limit`: a catalog is read whole. */
export const COLUMNS_DEFAULT_LIMIT = 200;
/** Longest function text an outline returns, in lines. */
export const OUTLINE_MAX_LINES = 60;
/** Longest code window of a definition, in lines. */
const DEFINITION_WINDOW_LINES = 12;
/** Lines of context a call site or writer window shows before and after its line. */
const SITE_LINES_BEFORE = 2;
const SITE_LINES_AFTER = 5;
/** Longest argument text a caller reports. */
const MAX_ARGUMENT_CHARS = 200;

export interface NavRequest {
  op: string;
  file?: string;
  line?: number;
  name?: string;
  /** `columns`: the concept whose stored columns are listed (`email`). */
  concept?: string;
  /** `columns`: `"configured"` adds configured address keys (settings, config, env). */
  include?: string;
  /** `members`: the class whose property is read or written. */
  owner?: string;
  limit?: number;
  /** Echoed back so a caller can match responses to requests. */
  id?: unknown;
}

export interface NavRange {
  name?: string;
  startLine: number;
  endLine: number;
}

export interface NavDeclaration {
  line: number;
  kind: string;
}

export interface NavDefinitionResult {
  file: string;
  line: number;
  /** `function`, `method`, `class`, `field`, or a same-file kind (`parameter`, `local`, `import`). */
  kind: string;
  /** Where the lookup found it: the requesting file's own scopes, or the repository. */
  scope: "file" | "repo";
  /** The class that owns a method or field. */
  owner?: string;
  /** Numbered code window starting at the definition. */
  code: string;
}

export interface NavCaller {
  file: string;
  line: number;
  callee: string;
  /** The function the call sits in. */
  caller?: string;
  receiverClass?: string;
  /** The call went through a deferral method such as `.delay`. */
  deferred?: boolean;
  arguments: InvocationArgument[];
  code: string;
}

export interface NavWriter {
  file: string;
  line: number;
  kind: "field" | "key";
  owner?: string;
  code: string;
}

/** One response line: `ok` plus the op's fields, or `{"ok":false,"error"}`. */
export type NavResponse = Record<string, unknown> & { ok: boolean; error?: string; id?: unknown };

interface FunctionRecord {
  file: string;
  line: number;
  endLine: number;
  owner?: string;
  parameters: FunctionDefinition["parameters"];
  destructured?: FunctionDefinition["destructured"];
}

interface AccessRecord {
  file: string;
  line: number;
  column: number;
  receiverClass?: string;
  write: boolean;
}

/** Where a value passed in a call lands: the callee's parameter. */
export interface NavTarget {
  file: string;
  line: number;
  name: string;
  kind: "parameter";
}

export interface NavPass {
  line: number;
  callee: string;
  position: number;
  keyword?: string;
  receiverClass?: string;
  /** The object-literal key the value sits under, when the argument is an object literal. */
  key?: string;
  /** The callee's parameter, when the callee resolves to exactly one function. */
  target?: NavTarget;
}

interface ClassRecord {
  file: string;
  line: number;
  endLine: number;
}

interface MemberRecord {
  file: string;
  line: number;
  kind: "field" | "key";
  owner?: string;
}

interface CallRecord {
  file: string;
  line: number;
  callee: string;
  caller?: string;
  callerOwner?: string;
  receiverClass?: string;
  /** A class named directly as the receiver (`WebsiteBrandingService.new`). */
  receiverConstant?: string;
  deferred: boolean;
  arguments: InvocationArgument[];
}

/** Files whose functions can call each other: one language family per extension. */
function languageFamily(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext)) return "js";
  return ext;
}

/** Position of the first non-blank character of a 1-based line, for scope lookups. */
function indentOf(lines: string[], line: number): number {
  const text = lines[line - 1] ?? "";
  return Math.max(0, text.length - text.trimStart().length);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Number of leading path segments two repository paths share, to rank nearby files first. */
function sharedDirectories(a: string, b: string): number {
  const left = path.posix.dirname(a).split("/");
  const right = path.posix.dirname(b).split("/");
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}

export class CodeNavigator {
  private readonly sources = new Map<string, FileInfo>();
  private readonly lineCache = new Map<string, string[]>();
  private readonly declaredClasses = new Set<string>();
  private readonly functionsByName = new Map<string, FunctionRecord[]>();
  private readonly classesByName = new Map<string, ClassRecord[]>();
  private readonly membersByName = new Map<string, MemberRecord[]>();
  private readonly callsByCallee = new Map<string, CallRecord[]>();
  private readonly columnCandidates: ColumnCandidate[] = [];
  private readonly accessesByName = new Map<string, AccessRecord[]>();

  /**
   * Index the files that have a language pack. The engine must be initialized
   * (`initAnalysisEngine`). Files the engine cannot parse are left out.
   */
  constructor(files: readonly FileInfo[], schemaFiles: readonly SchemaFile[] = []) {
    if (!isAnalysisEngineReady()) throw new Error("analysis engine is not initialized");
    // Prisma schemas and SQL DDL declare columns without being source (KDATAP-fded10).
    for (const file of schemaFiles) this.columnCandidates.push(...schemaFileCandidates(file));
    for (const file of files) {
      // Content-type `schema.json`, JPA entities and Go structs are read without a pack.
      if (file.language === "json" || file.language === "java" || file.language === "go") {
        this.columnCandidates.push(...candidatesForFile(file, undefined));
      }
      if (!packForFile(file.language, file.path)) continue;
      this.sources.set(file.path, file);
      // Every class declared anywhere, found by keyword so it is complete before the first parse.
      for (const match of file.content.matchAll(/\b(?:class|interface)\s+([A-Z][A-Za-z0-9_]*)/g)) {
        this.declaredClasses.add(match[1]);
      }
    }
    for (const file of this.sources.values()) this.indexFile(file);
  }

  /** Number of files indexed. */
  get fileCount(): number {
    return this.sources.size;
  }

  private analyze(file: FileInfo): AnalyzedFile | undefined {
    const pack = packForFile(file.language, file.path);
    const analyzed = pack ? analyzeSource(pack, file.content) : undefined;
    analyzed?.setKnownClass((name) => this.declaredClasses.has(name));
    return analyzed;
  }

  private indexFile(file: FileInfo): void {
    const analyzed = this.analyze(file);
    if (!analyzed) return;
    try {
      this.columnCandidates.push(...candidatesForFile(file, analyzed));
      for (const fn of analyzed.functionDefinitions()) {
        push(this.functionsByName, fn.name, {
          file: file.path,
          line: fn.line,
          endLine: fn.endLine,
          ...(fn.owner ? { owner: fn.owner } : {}),
          parameters: fn.parameters,
          ...(fn.destructured ? { destructured: fn.destructured } : {}),
        });
      }
      for (const access of analyzed.memberAccesses()) {
        push(this.accessesByName, access.name, {
          file: file.path,
          line: access.line,
          column: access.column,
          write: access.write,
          ...(access.receiverClass ? { receiverClass: access.receiverClass } : {}),
        });
      }
      for (const cls of analyzed.classDefinitions()) {
        push(this.classesByName, cls.name, { file: file.path, line: cls.line, endLine: cls.endLine });
      }
      for (const member of analyzed.memberDefinitions()) {
        push(this.membersByName, member.name, {
          file: file.path,
          line: member.line,
          kind: member.kind,
          ...(member.owner ? { owner: member.owner } : {}),
        });
      }
      for (const call of analyzed.invocations()) {
        const caller = analyzed.enclosingFunction(call.line, call.column)?.name;
        const callerOwner = caller ? analyzed.enclosingClass(call.line, call.column)?.name : undefined;
        push(this.callsByCallee, call.callee, {
          file: file.path,
          line: call.line,
          callee: call.callee,
          deferred: call.deferred,
          arguments: call.arguments.map((a) => ({ ...a, text: a.text.slice(0, MAX_ARGUMENT_CHARS) })),
          ...(caller ? { caller } : {}),
          ...(callerOwner ? { callerOwner } : {}),
          ...(call.receiverClass ? { receiverClass: call.receiverClass } : {}),
          ...(call.receiverConstant ? { receiverConstant: call.receiverConstant } : {}),
        });
      }
    } finally {
      analyzed.dispose();
    }
  }

  private linesOf(file: string): string[] {
    let lines = this.lineCache.get(file);
    if (!lines) {
      lines = (this.sources.get(file)?.content ?? "").split(/\r?\n/);
      this.lineCache.set(file, lines);
    }
    return lines;
  }

  /** Lines `start..end` (1-based, inclusive, clamped to the file) as `  42: text` rows. */
  window(file: string, start: number, end: number): string {
    const lines = this.linesOf(file);
    const from = Math.max(1, start);
    const to = Math.min(lines.length, end);
    const width = String(to).length;
    const rows: string[] = [];
    for (let n = from; n <= to; n += 1) rows.push(`${String(n).padStart(width)}: ${lines[n - 1]}`);
    return rows.join("\n");
  }

  /** Normalize a request path to the repository-relative form the index uses. */
  private resolveFile(file: string | undefined): string | undefined {
    if (!file) return undefined;
    const cleaned = file.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.sources.has(cleaned) ? cleaned : undefined;
  }

  /**
   * `{"op":"outline","file","line"}`: the function and class enclosing the line, and the
   * function's text (at most `OUTLINE_MAX_LINES` numbered lines).
   */
  outline(file: string, line: number): Record<string, unknown> {
    const info = this.sources.get(file);
    const analyzed = info ? this.analyze(info) : undefined;
    if (!analyzed) return { function: null, class: null };
    try {
      const column = indentOf(this.linesOf(file), line);
      const fn = analyzed.enclosingFunction(line, column);
      const cls = analyzed.enclosingClass(line, column);
      const shown = fn ? Math.min(fn.endLine, fn.startLine + OUTLINE_MAX_LINES - 1) : 0;
      return {
        function: fn ?? null,
        class: cls ?? null,
        ...(fn ? { code: this.window(file, fn.startLine, shown), truncated: shown < fn.endLine } : {}),
      };
    } finally {
      analyzed.dispose();
    }
  }

  /**
   * `{"op":"symbols","file","line"}`: the navigable names on the line. References carry
   * their same-file declaration, calls the receiver class when the engine knows it,
   * members the class of the object they are read from, and definitions their kind.
   */
  symbols(file: string, line: number): Record<string, unknown> {
    const info = this.sources.get(file);
    const analyzed = info ? this.analyze(info) : undefined;
    if (!analyzed) return { references: [], calls: [], members: [], definitions: [] };
    try {
      const references: Array<Record<string, unknown>> = [];
      const members: Array<Record<string, unknown>> = [];
      const definitions: Array<Record<string, unknown>> = [];
      for (const site of analyzed.sitesOnLine(line)) {
        if (site.role === "reference") {
          const declaration = analyzed.declarationOf(site.name, line, site.column);
          references.push({
            name: site.name,
            column: site.column,
            ...(site.inCallee ? { inCallee: true } : {}),
            ...(declaration ? { declaration } : {}),
          });
        } else if (site.role === "member") {
          const receiverClass = analyzed.classOfSiteReceiver(site);
          members.push({
            name: site.name,
            column: site.column,
            ...(site.inCallee ? { inCallee: true } : {}),
            ...(receiverClass ? { receiverClass } : {}),
          });
        } else {
          definitions.push({ name: site.name, kind: site.kind, column: site.column, ...ownerOf(analyzed, site) });
        }
      }
      const calls = analyzed
        .invocations()
        .filter((call) => call.line === line)
        .map((call) => ({
          callee: call.callee,
          column: call.column,
          ...(call.deferred ? { deferred: true } : {}),
          ...(call.receiverClass ? { receiverClass: call.receiverClass } : {}),
        }));
      return { references, calls, members, definitions };
    } finally {
      analyzed.dispose();
    }
  }

  /**
   * `{"op":"definition","file","line","name"}`: where `name`, as used on the line, is
   * defined. The file's own scopes answer first (a parameter or local ends the search);
   * then the repository: functions or methods of that name (narrowed to the receiver
   * class's methods when the class is known), classes, and class fields.
   */
  definition(file: string, line: number, name: string, limit: number): Record<string, unknown> {
    const results: NavDefinitionResult[] = [];
    let receiverClass: string | undefined;
    const info = this.sources.get(file);
    const analyzed = info ? this.analyze(info) : undefined;
    try {
      if (analyzed) {
        const column = indentOf(this.linesOf(file), line);
        const sites = analyzed.sitesOnLine(line).filter((site) => site.name === name);
        const asMember = sites.find((site): site is Extract<Site, { role: "member" }> => site.role === "member");
        if (asMember) receiverClass = analyzed.classOfSiteReceiver(asMember);
        const call = analyzed.invocations().find((c) => c.line === line && c.callee === name);
        receiverClass ??= call?.receiverClass;
        // A member (`order.email`) is not a lexical name: only a bare reference resolves in scope.
        const bare = sites.find((site) => site.role === "reference");
        const declaration = asMember && !bare ? undefined : analyzed.declarationOf(name, line, bare?.column ?? column);
        if (declaration) {
          results.push({
            file,
            line: declaration.line,
            kind: declaration.kind,
            scope: "file",
            code: this.window(file, declaration.line, declaration.line + 4),
          });
          if (declaration.kind === "local" || declaration.kind === "parameter") {
            return { name, ...(receiverClass ? { receiverClass } : {}), results, total: results.length, truncated: false };
          }
        }
      }
    } finally {
      analyzed?.dispose();
    }

    const repo: NavDefinitionResult[] = [];
    const functions = this.functionsByName.get(name) ?? [];
    const narrowed = receiverClass ? functions.filter((fn) => fn.owner === receiverClass) : [];
    const chosen = narrowed.length > 0 ? narrowed : functions;
    for (const fn of this.rankedByProximity(chosen, file)) {
      repo.push({
        file: fn.file,
        line: fn.line,
        kind: fn.owner ? "method" : "function",
        scope: "repo",
        ...(fn.owner ? { owner: fn.owner } : {}),
        code: this.window(fn.file, fn.line, Math.min(fn.endLine, fn.line + DEFINITION_WINDOW_LINES - 1)),
      });
    }
    for (const cls of this.rankedByProximity(this.classesByName.get(name) ?? [], file)) {
      repo.push({
        file: cls.file,
        line: cls.line,
        kind: "class",
        scope: "repo",
        code: this.window(cls.file, cls.line, Math.min(cls.endLine, cls.line + DEFINITION_WINDOW_LINES - 1)),
      });
    }
    const fields = (this.membersByName.get(name) ?? []).filter((member) => member.kind === "field");
    const fieldsOfClass = receiverClass ? fields.filter((member) => member.owner === receiverClass) : [];
    for (const member of this.rankedByProximity(fieldsOfClass.length > 0 ? fieldsOfClass : fields, file)) {
      repo.push({
        file: member.file,
        line: member.line,
        kind: "field",
        scope: "repo",
        ...(member.owner ? { owner: member.owner } : {}),
        code: this.window(member.file, member.line - 1, member.line + 3),
      });
    }
    for (const result of repo) {
      if (!results.some((known) => known.file === result.file && known.line === result.line)) results.push(result);
    }
    return {
      name,
      ...(receiverClass ? { receiverClass, narrowedToReceiver: narrowed.length > 0 } : {}),
      results: results.slice(0, limit),
      total: results.length,
      truncated: results.length > limit,
    };
  }

  /**
   * `{"op":"callers","name"}` or `{"op":"callers","file","line"}` (the enclosing function's
   * name): call sites of the callee across the repository, deferred calls included.
   * With a position inside a method, calls whose receiver is known to be another class
   * are left out; calls on an untyped receiver stay.
   */
  callers(request: { name?: string; file?: string; line?: number }, limit: number): Record<string, unknown> | string {
    let name = request.name;
    let ownerClass: string | undefined;
    if (!name) {
      const where = request.file && request.line ? this.outline(request.file, request.line) : undefined;
      const fn = where?.function as NavRange | null | undefined;
      if (!fn?.name) return "callers needs a name, or a file and line inside a named function";
      name = fn.name;
      const owned = this.functionsByName
        .get(name)
        ?.find((record) => record.file === request.file && record.line >= fn.startLine && record.line <= fn.endLine);
      ownerClass = owned?.owner;
    }
    // A Ruby constructor is called as `Class.new(...)` (KDATAP-e35652).
    const family = request.file ? languageFamily(request.file) : undefined;
    const rubyConstructor = family === "rb" && name === "initialize" && ownerClass !== undefined;
    const sameFamily = (call: CallRecord): boolean => family === undefined || languageFamily(call.file) === family;
    const all = (this.callsByCallee.get(rubyConstructor ? "new" : name) ?? []).filter(sameFamily);
    const kept = rubyConstructor
      ? all.filter((call) => [call.receiverConstant, call.receiverClass].some((k) => k !== undefined && (k === ownerClass || k.endsWith(ownerClass as string))))
      : ownerClass
        ? all.filter((call) => !call.receiverClass || call.receiverClass === ownerClass)
        : all;
    const ranked = [...kept].sort(
      (a, b) =>
        Number(b.receiverClass === ownerClass && ownerClass !== undefined) - Number(a.receiverClass === ownerClass && ownerClass !== undefined) ||
        sharedDirectories(b.file, request.file ?? "") - sharedDirectories(a.file, request.file ?? "") ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );
    const callers: NavCaller[] = ranked.slice(0, limit).map((call) => ({
      file: call.file,
      line: call.line,
      callee: call.callee,
      ...(call.caller ? { caller: call.caller } : {}),
      ...(call.receiverClass ? { receiverClass: call.receiverClass } : {}),
      ...(call.deferred ? { deferred: true } : {}),
      arguments: call.arguments,
      code: this.window(call.file, call.line - SITE_LINES_BEFORE, call.line + SITE_LINES_AFTER),
    }));
    return {
      name,
      ...(ownerClass ? { ownerClass } : {}),
      callers,
      total: kept.length,
      truncated: kept.length > limit,
    };
  }

  /**
   * `{"op":"writers","name"}`: sites that define a key, keyword argument or field named
   * `name` across the repository (`@definition.key` / `@definition.field`), in path order.
   * A `file` hint ranks that file first and then the nearest directories, so the sites
   * around a occurrence survive the cap.
   */
  writers(name: string, limit: number, from = ""): Record<string, unknown> {
    const all = this.rankedByProximity(this.membersByName.get(name) ?? [], from);
    const writers: NavWriter[] = all.slice(0, limit).map((member) => ({
      file: member.file,
      line: member.line,
      kind: member.kind,
      ...(member.owner ? { owner: member.owner } : {}),
      code: this.window(member.file, member.line - SITE_LINES_BEFORE, member.line + SITE_LINES_AFTER),
    }));
    return { name, writers, total: all.length, truncated: all.length > limit };
  }

  /**
   * `{"op":"uses","file","line","name"}`: where the binding `name` (visible at the line)
   * goes. `uses` are the later references to the same binding, in line order, each with
   * its role. `passes` are the uses that hand the value to a call, with the callee
   * resolved like `definition` and, when it is exactly one function, the parameter the
   * value lands in.
   */
  uses(file: string, line: number, name: string, limit: number): Record<string, unknown> | string {
    const info = this.sources.get(file);
    const analyzed = info ? this.analyze(info) : undefined;
    if (!analyzed) return `file could not be analyzed: ${file}`;
    let found: ReturnType<AnalyzedFile["bindingUses"]>;
    try {
      found = analyzed.bindingUses(name, line);
    } finally {
      analyzed.dispose();
    }
    if (!found) return `no binding named ${name} is visible at ${file}:${line}`;
    const lines = this.linesOf(file);
    const all = found.uses;
    const passes: NavPass[] = [];
    for (const use of all) {
      if (!use.call) continue;
      const target = this.passTarget(use.call);
      passes.push({
        line: use.line,
        callee: use.call.callee,
        position: use.call.position,
        ...(use.call.keyword ? { keyword: use.call.keyword } : {}),
        ...(use.call.receiverClass ? { receiverClass: use.call.receiverClass } : {}),
        ...(use.call.key ? { key: use.call.key } : {}),
        ...(target ? { target } : {}),
      });
    }
    return {
      name,
      binding: { line: found.line, kind: found.kind },
      uses: all.slice(0, limit).map((use: BindingUse) => ({
        line: use.line,
        column: use.column,
        code: (lines[use.line - 1] ?? "").trim(),
        role: use.role,
        ...(use.assignedTo ? { assignedTo: use.assignedTo } : {}),
        ...(use.key !== undefined && use.role === "object_key" ? { key: use.key } : {}),
      })),
      passes: passes.slice(0, limit),
      total: all.length,
      truncated: all.length > limit || passes.length > limit,
    };
  }

  /**
   * The parameter a call argument lands in, when the callee is exactly one function
   * (narrowed by the receiver class when known; a class resolves to its constructor).
   * An object-literal argument key maps to the destructured name that reads it.
   */
  private passTarget(call: NonNullable<BindingUse["call"]>): NavTarget | undefined {
    let functions = this.functionsByName.get(call.callee) ?? [];
    if (call.receiverClass) {
      const narrowed = functions.filter((fn) => fn.owner === call.receiverClass);
      if (narrowed.length > 0) functions = narrowed;
    }
    if (functions.length === 0 && this.classesByName.has(call.callee)) {
      functions = ["__init__", "constructor"].flatMap((init) =>
        (this.functionsByName.get(init) ?? []).filter((fn) => fn.owner === call.callee),
      );
    }
    if (functions.length !== 1) return undefined;
    const fn = functions[0];
    const parameter = fn.parameters.find((p) => (call.keyword !== undefined ? p.name === call.keyword : p.position === call.position));
    if (parameter) return { file: fn.file, line: parameter.line, name: parameter.name, kind: "parameter" };
    const key = fn.destructured?.find((d) => d.position === call.position)?.keys.find((k) => k.key === call.key);
    return key ? { file: fn.file, line: key.line, name: key.name, kind: "parameter" } : undefined;
  }

  /**
   * `{"op":"members","name","owner"?}`: property accesses `x.name` (and `x["name"]`,
   * `x.get("name")`) across the repository, each a read or an assignment target
   * (`write`). With `owner`, accesses whose receiver is typed as another class are left
   * out and untyped receivers stay; typed matches come first.
   */
  members(name: string, owner: string | undefined, limit: number): Record<string, unknown> {
    const all = (this.accessesByName.get(name) ?? []).filter(
      (access) => !owner || !access.receiverClass || access.receiverClass === owner,
    );
    const ranked = [...all].sort(
      (a, b) =>
        Number(owner !== undefined && b.receiverClass === owner) - Number(owner !== undefined && a.receiverClass === owner) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column,
    );
    return {
      name,
      ...(owner ? { owner } : {}),
      members: ranked.slice(0, limit).map((access) => ({
        file: access.file,
        line: access.line,
        ...(access.receiverClass ? { receiverClass: access.receiverClass } : {}),
        write: access.write,
        code: (this.linesOf(access.file)[access.line - 1] ?? "").trim(),
      })),
      total: all.length,
      truncated: all.length > limit,
    };
  }

  /**
   * `{"op":"columns","concept"}`: the stored columns the repository declares for a
   * concept, collapsed across migrations (KDATAP-33da4c); with `include: "configured"`,
   * also the configured address keys (KDATAP-6661dd). See `column-catalog.ts`.
   */
  columns(concept: string, limit: number, include?: "configured"): Record<string, unknown> {
    const all = collapseColumns(this.columnCandidates, concept, { include });
    return { concept, columns: all.slice(0, limit), total: all.length, truncated: all.length > limit };
  }

  private rankedByProximity<T extends { file: string; line: number }>(records: T[], from: string): T[] {
    return [...records].sort(
      (a, b) =>
        Number(b.file === from) - Number(a.file === from) ||
        sharedDirectories(b.file, from) - sharedDirectories(a.file, from) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    );
  }

  /** Answer one request. Never throws: a bad request gets `{"ok":false,"error"}`. */
  handle(request: NavRequest): NavResponse {
    const id = request.id === undefined ? {} : { id: request.id };
    const fail = (error: string): NavResponse => ({ ok: false, error, ...id });
    const limit = Number.isInteger(request.limit) && (request.limit ?? 0) > 0 ? (request.limit as number) : DEFAULT_LIMIT;
    const hasLine = Number.isInteger(request.line) && (request.line ?? 0) > 0;
    const file = this.resolveFile(request.file);
    const done = (op: string, body: Record<string, unknown>): NavResponse => ({ ok: true, op, ...(file ? { file } : {}), ...body, ...id });
    try {
      switch (request.op) {
        case "outline":
        case "symbols":
          if (!file || !hasLine) return fail(`${request.op} needs an indexed file and a 1-based line`);
          return done(request.op, { line: request.line, ...(request.op === "outline" ? this.outline(file, request.line as number) : this.symbols(file, request.line as number)) });
        case "definition":
          if (!file || !hasLine || !request.name) return fail("definition needs an indexed file, a 1-based line and a name");
          return done("definition", { line: request.line, ...this.definition(file, request.line as number, request.name, limit) });
        case "callers": {
          if (!request.name && request.file && !file) return fail(`file is not indexed: ${request.file}`);
          const found = this.callers({ name: request.name, file, line: request.line }, limit);
          return typeof found === "string" ? fail(found) : done("callers", found);
        }
        case "uses": {
          if (!file || !hasLine || !request.name) return fail("uses needs an indexed file, a 1-based line and a name");
          const found = this.uses(file, request.line as number, request.name, limit);
          return typeof found === "string" ? fail(found) : done("uses", { line: request.line, ...found });
        }
        case "members":
          if (!request.name) return fail("members needs a name");
          return done("members", this.members(request.name, request.owner, limit));
        case "columns":
          if (!request.concept) return fail("columns needs a concept");
          return done("columns", this.columns(request.concept, Number.isInteger(request.limit) && (request.limit ?? 0) > 0 ? (request.limit as number) : COLUMNS_DEFAULT_LIMIT, request.include === "configured" ? "configured" : undefined));
        case "writers":
          if (!request.name) return fail("writers needs a name");
          return done("writers", this.writers(request.name, limit, file ?? ""));
        default:
          return fail(`unknown op: ${String(request.op)}`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}

/** Owner of a field or key definition site, as a spreadable fragment. */
function ownerOf(analyzed: AnalyzedFile, site: Extract<Site, { role: "definition" }>): { owner?: string } {
  if (site.kind !== "field" && site.kind !== "key") return {};
  const owner = site.kind === "field" ? analyzed.enclosingClass(site.line, site.column)?.name : analyzed.definitionOwner(site.line, site.column);
  return owner ? { owner } : {};
}
