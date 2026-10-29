/**
 * Python outbound HTTP destinations (DATAP-818).
 *
 * Finds request calls made with a raw HTTP library (httpx, requests, aiohttp), with an
 * OpenAI-compatible client pointed at another provider, with an MCP-over-HTTP client, with
 * Phoenix tracing, or through an unresolved `(method, url)` helper, and resolves the URL the
 * call reaches in the same file. A known host names the third party; an unknown host gives an
 * outbound-HTTP finding with no vendor. The HTTP library is never the destination.
 */

import type { RawFinding } from "../../core/types/detection";
import type { SourceLocation } from "../../core/types/file";
import type { UnifiedPatternConfig } from "../config";
import type {
  LlmModelPrefix,
  ThirdPartyUrlRoute,
  ThirdPartyUrlRouteRule,
} from "../../config/third-party-detection-config";
import {
  defaultServiceNameFromLiteralPublicUrl,
  hostMatchesOrganizationDomains,
  shouldIgnoreExternalHttpUrl,
} from "../../classifier/external-url-third-party";
import { getActiveOrganizationDomains } from "../../classifier/organization-domains-scan-scope";
import {
  pythonModuleIndexSize,
  pythonModuleSource,
  pythonModuleIndexGeneration,
  resolvePythonModulePath,
} from "./source-module-index";
import {
  buildPySourceModel,
  dottedName,
  exprText,
  type PyCall,
  type PyExpr,
  type PyScope,
  type PySourceModel,
} from "./python-source";

/** Finding name for an outbound HTTP call whose destination host is not known. */
export const OUTBOUND_HTTP_UNKNOWN_FINDING_NAME = "outbound_http_call";

const MAX_VALUES = 8;
const MAX_DEPTH = 12;
const MAX_CALLER_HOPS = 3;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const REQUEST_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "request", "stream"]);
const METHOD_FIRST_VERBS = new Set(["request", "stream"]);
const STRING_METHODS = new Set(["rstrip", "strip", "lstrip", "lower", "format", "removesuffix", "removeprefix", "encode"]);
const OPENAI_CLIENTS = new Set(["OpenAI", "AsyncOpenAI"]);
const VALIDATOR_METHODS = new Set(["validate_python", "validate_strings", "validate_json", "parse_obj_as"]);
const LITELLM_CALLS = new Set(["completion", "acompletion", "text_completion", "atext_completion", "embedding", "aembedding", "responses", "aresponses"]);
const MCP_URL_CALLS = new Set(["streamablehttp_client", "streamable_http_client", "sse_client"]);
const MCP_URL_PARAMS = new Set(["StreamableHTTPServerParams", "SseServerParams", "StreamableHTTPConnectionParams", "SseConnectionParams"]);
/** Packages that are plumbing, never destinations, besides the configured HTTP clients. */
const EXTRA_LIBRARY_NAMES = ["httpx_retries", "urllib3", "tenacity"];

interface Site {
  startLine: number;
  endLine: number;
}

interface Val {
  text: string;
  sites: Site[];
  /** Class and module names the value came through (`ShopifyStore shopify_store.py`), for routing hints. */
  hint: string;
}

/** A class (or an instance of it) or a module a dotted name refers to. */
type Sym = { kind: "class"; scope: PyScope } | { kind: "module"; root: PyScope };

const MAX_SYMBOL_DEPTH = 8;

interface EvalCtx {
  scope: PyScope;
  line: number;
  bindings?: Map<string, { expr: PyExpr; ctx: EvalCtx }>;
  hops: number;
  depth: number;
}

export interface RawHttpLibrary {
  /** Library name (`httpx`); never reported as a destination. */
  name: string;
  importModules: string[];
  constructors: string[];
  patternId: RawFinding["pattern"];
  confidence: number;
}

export interface Destination {
  serviceName: string;
  subType?: string;
  url: string;
  sites: Site[];
  /**
   * Set for the scanned organization's own hosts: the call is kept as a first-party API
   * (an asset, not a third party) so cross-repo flows are not lost (DATAP-818).
   */
  firstPartyHost?: string;
}

// ── Value resolution ──────────────────────────────────────────────────────

class Resolver {
  private readonly active = new Set<string>();
  /** Module scope -> its model and repo-relative path (the scanned file and imported modules). */
  private readonly modules = new Map<PyScope, { model: PySourceModel; path: string; id: number }>();
  private readonly loaded = new Map<string, PyScope | undefined>();

  constructor(
    private readonly model: PySourceModel,
    filePath: string,
  ) {
    this.modules.set(model.module, { model, path: filePath, id: 0 });
    this.loaded.set(filePath, model.module);
  }

  private rootOf(scope: PyScope): PyScope {
    let current = scope;
    while (current.parent) current = current.parent;
    return current;
  }

  private moduleOf(scope: PyScope): { model: PySourceModel; path: string; id: number } {
    return this.modules.get(this.rootOf(scope)) ?? { model: this.model, path: "", id: 0 };
  }

  moduleModelOf(scope: PyScope): PySourceModel {
    return this.moduleOf(scope).model;
  }

  private text(scope: PyScope, expr: PyExpr): string {
    return exprText(this.moduleOf(scope).model, expr);
  }

  /** Module scope of a same-repo import seen from `fromScope`'s file, loaded on demand. */
  private loadModule(fromScope: PyScope, spec: string): PyScope | undefined {
    const from = this.moduleOf(fromScope).path;
    const path = resolvePythonModulePath(from, spec);
    if (!path) return undefined;
    if (this.loaded.has(path)) return this.loaded.get(path);
    const source = pythonModuleSource(path);
    let root: PyScope | undefined;
    if (source !== undefined) {
      const model = buildPySourceModel(source);
      root = model.module;
      this.modules.set(root, { model, path, id: this.modules.size });
    }
    this.loaded.set(path, root);
    return root;
  }

  eval(expr: PyExpr, ctx: EvalCtx): Val[] {
    if (ctx.depth > MAX_DEPTH) return [];
    const key = `${this.moduleOf(ctx.scope).id}:${expr.start}:${expr.end}:${ctx.hops}:${ctx.bindings ? [...ctx.bindings.keys()].join(",") : ""}`;
    if (this.active.has(key)) return [];
    this.active.add(key);
    try {
      return cap(this.evalInner(expr, { ...ctx, depth: ctx.depth + 1 }));
    } finally {
      this.active.delete(key);
    }
  }

  private evalInner(expr: PyExpr, ctx: EvalCtx): Val[] {
    switch (expr.kind) {
      case "str": {
        let acc: Val[] = [{ text: "", sites: [], hint: "" }];
        for (const part of expr.parts) {
          if (typeof part === "string") {
            acc = acc.map((v) => ({ ...v, text: v.text + part }));
            continue;
          }
          const values = this.eval(part, ctx);
          const pieces = values.length > 0 ? values : [placeholder(this.text(ctx.scope, part))];
          acc = product(acc, pieces);
        }
        return acc;
      }
      case "name":
        return this.resolveName(expr.id, ctx);
      case "attr": {
        const base = dottedName(expr.object);
        if (base === "self" || base === "cls") return this.resolveSelfAttr(expr.attr, ctx);
        // `settings.BASE_URL` where `settings` is a class, an instance or a module (DATAP-818).
        const sym = this.symbolOf(expr.object, ctx.scope, ctx.line, 0);
        if (sym?.kind === "class") return this.classAttr(sym.scope, expr.attr, ctx);
        if (sym?.kind === "module") return this.resolveName(expr.attr, { scope: sym.root, line: Number.MAX_SAFE_INTEGER, hops: 0, depth: ctx.depth });
        return [];
      }
      case "coll":
        return expr.elts.flatMap((e) => this.eval(e, ctx));
      case "subscript":
        // `MODELS[tier]`: every value the container can hold.
        return this.eval(expr.value, ctx);
      case "call":
        return this.evalCall(expr, ctx);
      case "binop": {
        if (expr.op === "%") return this.eval(expr.left, ctx);
        if (expr.op !== "+") return [];
        const left = this.eval(expr.left, ctx);
        const right = this.eval(expr.right, ctx);
        if (left.length === 0 && right.length === 0) return [];
        const l = left.length > 0 ? left : [placeholder(this.text(ctx.scope, expr.left))];
        const r = right.length > 0 ? right : [placeholder(this.text(ctx.scope, expr.right))];
        return product(l, r);
      }
      case "boolop":
        if (expr.op === "and") return this.eval(expr.values[expr.values.length - 1], ctx);
        return expr.values.flatMap((v) => this.eval(v, ctx));
      case "ifexp":
        return [...this.eval(expr.body, ctx), ...this.eval(expr.orelse, ctx)];
      case "tuple":
        return expr.elts.flatMap((e) => this.eval(e, ctx));
      default:
        return [];
    }
  }

  private evalCall(expr: Extract<PyExpr, { kind: "call" }>, ctx: EvalCtx): Val[] {
    const callee = dottedName(expr.func);
    // os.environ.get("X", default), os.getenv("X", default)
    if (callee && /(^|\.)(environ\.get|getenv)$/.test(callee)) {
      const fallback = expr.args[1] ?? expr.kwargs.find((k) => k.name === "default")?.value;
      // An empty default says nothing about the value: keep it as a placeholder.
      return fallback ? this.eval(fallback, ctx).filter((v) => v.text.length > 0) : [];
    }
    if (callee === "str" && expr.args[0]) return this.eval(expr.args[0], ctx);
    // Validator wrappers keep the value: cast(str, x), TypeAdapter(str).validate_python(x).
    if (callee && /(^|\.)cast$/.test(callee) && expr.args.length === 2) return this.eval(expr.args[1], ctx);
    if (expr.func.kind === "attr" && VALIDATOR_METHODS.has(expr.func.attr) && expr.args.length === 1) {
      return this.eval(expr.args[0], ctx);
    }
    if (callee && /(^|\.)urljoin$/.test(callee) && expr.args.length >= 2) {
      const base = this.eval(expr.args[0], ctx);
      const rel = this.eval(expr.args[1], ctx);
      return product(base, rel.length > 0 ? rel : [placeholder("…", "/")]);
    }
    if (expr.func.kind === "attr" && STRING_METHODS.has(expr.func.attr)) {
      const receiver = this.eval(expr.func.object, ctx);
      if (expr.func.attr === "rstrip" || expr.func.attr === "strip") {
        return receiver.map((v) => ({ ...v, text: v.text.replace(/\/+$/, "") }));
      }
      return receiver;
    }
    // Same-file function or method: evaluate its return values with the arguments bound.
    const target = this.callTarget(expr, ctx);
    if (!target) return [];
    const { fn, bindings, hint } = target;
    const lineOf = this.moduleOf(fn).model.lineOf;
    return fn.returns
      .flatMap((ret) => this.eval(ret, { scope: fn, line: lineOf(ret.start), bindings, hops: 0, depth: ctx.depth }))
      .map((v) => (hint ? { ...v, hint: `${v.hint} ${hint}` } : v));
  }

  /** The same-repo function a call runs, with its arguments bound. */
  callTarget(
    expr: Extract<PyExpr, { kind: "call" }>,
    ctx: EvalCtx,
  ): { fn: PyScope; bindings: Map<string, { expr: PyExpr; ctx: EvalCtx }>; hint: string } | undefined {
    const func = expr.func;
    let target: PyScope | undefined;
    let hint = "";
    if (func.kind === "name") target = this.lookupFunction(func.id, ctx.scope) ?? this.importedFunction(func.id, ctx.scope);
    else if (func.kind === "attr" && (dottedName(func.object) === "self" || dottedName(func.object) === "cls")) {
      target = this.enclosingClass(ctx.scope)?.children.find((c) => c.kind === "function" && c.name === func.attr);
    } else if (func.kind === "attr") {
      // `store.mcp_endpoint()` on a same-repo class, `module.helper()` on a same-repo module.
      const sym = this.symbolOf(func.object, ctx.scope, ctx.line, 0);
      if (sym?.kind === "class") {
        target = sym.scope.children.find((c) => c.kind === "function" && c.name === func.attr);
        hint = this.hintOf(sym.scope);
      } else if (sym?.kind === "module") {
        target = sym.root.children.find((c) => c.kind === "function" && c.name === func.attr);
      }
    }
    if (!target) return undefined;
    return { fn: target, bindings: this.bindArguments(target, expr, ctx), hint };
  }

  /**
   * Expressions a keyword reaches a call with: `name=...`, or the `name` entry of a `**mapping`
   * built from dict literals, `{**a, **b}` merges, assigned names and helper returns.
   */
  kwargExprs(call: Extract<PyExpr, { kind: "call" }>, name: string, ctx: EvalCtx): Array<{ expr: PyExpr; ctx: EvalCtx }> {
    const explicit = call.kwargs.find((k) => k.name === name);
    if (explicit) return [{ expr: explicit.value, ctx }];
    return call.starKwargs.flatMap((mapping) => this.dictEntryExprs(mapping, name, ctx, 0));
  }

  private dictEntryExprs(expr: PyExpr, key: string, ctx: EvalCtx, depth: number): Array<{ expr: PyExpr; ctx: EvalCtx }> {
    if (depth > MAX_SYMBOL_DEPTH) return [];
    const next = depth + 1;
    if (expr.kind === "coll" && expr.entries) {
      // Later entries override earlier ones; any of them may be the value at runtime.
      return [
        ...expr.entries.filter((e) => e.key === key).map((e) => ({ expr: e.value, ctx })),
        ...(expr.spreads ?? []).flatMap((spread) => this.dictEntryExprs(spread, key, ctx, next)),
      ];
    }
    if (expr.kind === "name") {
      const bound = ctx.bindings?.get(expr.id);
      if (bound) return this.dictEntryExprs(bound.expr, key, bound.ctx, next);
      let scope: PyScope | undefined = ctx.scope;
      let first = true;
      while (scope) {
        const assigned = scope.kind === "class" && !first ? [] : scope.assignments.filter((a) => a.target === expr.id);
        if (assigned.length > 0) {
          const before = first ? assigned.filter((a) => a.line <= ctx.line) : assigned;
          const chosen = (before.length > 0 ? before : assigned).slice(-1)[0];
          return this.dictEntryExprs(chosen.value, key, { scope: chosen.scope, line: chosen.line, hops: 0, depth: ctx.depth, bindings: first ? ctx.bindings : undefined }, next);
        }
        if (scope.kind === "function" && scope.params.some((p) => p.name === expr.id)) return [];
        scope = scope.parent;
        first = false;
      }
      return [];
    }
    if (expr.kind === "call") {
      if (dottedName(expr.func) === "dict") {
        return [
          ...expr.kwargs.filter((k) => k.name === key).map((k) => ({ expr: k.value, ctx })),
          ...[...expr.args, ...expr.starKwargs].flatMap((a) => this.dictEntryExprs(a, key, ctx, next)),
        ];
      }
      const target = this.callTarget(expr, ctx);
      if (!target) return [];
      const lineOf = this.moduleOf(target.fn).model.lineOf;
      return target.fn.returns.flatMap((ret) =>
        this.dictEntryExprs(ret, key, { scope: target.fn, line: lineOf(ret.start), bindings: target.bindings, hops: 0, depth: ctx.depth }, next),
      );
    }
    return [];
  }

  private bindArguments(fn: PyScope, call: Extract<PyExpr, { kind: "call" }>, ctx: EvalCtx): Map<string, { expr: PyExpr; ctx: EvalCtx }> {
    const bindings = new Map<string, { expr: PyExpr; ctx: EvalCtx }>();
    const params = positionalParams(fn);
    call.args.forEach((arg, index) => {
      const param = params[index];
      if (param) bindings.set(param, { expr: arg, ctx });
    });
    for (const kw of call.kwargs) bindings.set(kw.name, { expr: kw.value, ctx });
    return bindings;
  }

  resolveName(id: string, ctx: EvalCtx): Val[] {
    const bound = ctx.bindings?.get(id);
    if (bound) return this.eval(bound.expr, bound.ctx);
    let scope: PyScope | undefined = ctx.scope;
    let first = true;
    while (scope) {
      if (scope.kind === "class" && !first) {
        scope = scope.parent;
        continue;
      }
      if (scope.kind === "function") {
        const param = scope.params.find((p) => p.name === id);
        if (param) {
          if (first && ctx.hops > 0) {
            const viaCallers = this.resolveThroughCallers(scope, id, ctx);
            if (viaCallers.length > 0) return viaCallers;
          }
          return param.defaultExpr ? this.eval(param.defaultExpr, { ...ctx, scope: scope.parent ?? scope, hops: 0 }) : [];
        }
      }
      const assigned = scope.assignments.filter((a) => a.target === id);
      if (assigned.length > 0) {
        const before = first ? assigned.filter((a) => a.line <= ctx.line) : assigned;
        const chosen = before.length > 0 ? [before[before.length - 1]] : assigned;
        return chosen.flatMap((a) => this.eval(a.value, { scope: a.scope, line: a.line, hops: first ? ctx.hops : 0, depth: ctx.depth, bindings: first ? ctx.bindings : undefined }));
      }
      if (!scope.parent) return this.importedName(id, scope, ctx);
      scope = scope.parent;
      first = false;
    }
    return [];
  }

  /** A module-level name bound by `from M import name` in a same-repo module. */
  private importedName(id: string, root: PyScope, ctx: EvalCtx): Val[] {
    const imp = this.moduleOf(root).model.imports.find((i) => i.names.length > 0 && i.aliases.has(id));
    if (!imp) return [];
    const target = this.loadModule(root, imp.module);
    if (!target || target === root) return [];
    const name = imp.aliases.get(id)!;
    return this.resolveName(name, { scope: target, line: Number.MAX_SAFE_INTEGER, hops: 0, depth: ctx.depth + 1 });
  }

  private importedFunction(id: string, scope: PyScope): PyScope | undefined {
    const root = this.rootOf(scope);
    const imp = this.moduleOf(root).model.imports.find((i) => i.names.length > 0 && i.aliases.has(id));
    if (!imp) return undefined;
    const target = this.loadModule(root, imp.module);
    const name = imp.aliases.get(id)!;
    return target?.children.find((c) => c.kind === "function" && c.name === name);
  }

  /** Class, instance or module a name or dotted expression refers to, across same-repo imports. */
  symbolOf(expr: PyExpr, scope: PyScope, line: number, depth: number): Sym | undefined {
    if (depth > MAX_SYMBOL_DEPTH) return undefined;
    if (expr.kind === "call") {
      const sym = this.symbolOf(expr.func, scope, line, depth + 1);
      return sym?.kind === "class" ? sym : undefined;
    }
    if (expr.kind === "attr") {
      const base = this.symbolOf(expr.object, scope, line, depth + 1);
      if (base?.kind === "module") return this.symbolOfName(expr.attr, base.root, Number.MAX_SAFE_INTEGER, depth + 1);
      return undefined;
    }
    if (expr.kind === "name") return this.symbolOfName(expr.id, scope, line, depth + 1);
    return undefined;
  }

  private symbolOfName(id: string, start: PyScope, line: number, depth: number): Sym | undefined {
    if (depth > MAX_SYMBOL_DEPTH) return undefined;
    let scope: PyScope | undefined = start;
    let first = true;
    while (scope) {
      if (scope.kind !== "class" || first) {
        if (scope.kind === "function") {
          const param = scope.params.find((p) => p.name === id);
          if (param) return param.annotation ? this.symbolOfAnnotation(param.annotation, scope, depth + 1) : undefined;
        }
        const cls = scope.children.find((c) => c.kind === "class" && c.name === id);
        if (cls) return { kind: "class", scope: cls };
        const assigned = scope.assignments.filter((a) => a.target === id);
        if (assigned.length > 0) {
          const before = first ? assigned.filter((a) => a.line <= line) : assigned;
          const chosen = (before.length > 0 ? before : assigned).slice(-1)[0];
          return this.symbolOf(chosen.value, chosen.scope, chosen.line, depth + 1);
        }
      }
      if (!scope.parent) return this.importedSymbol(id, scope, depth + 1);
      scope = scope.parent;
      first = false;
    }
    return undefined;
  }

  private symbolOfAnnotation(annotation: string, scope: PyScope, depth: number): Sym | undefined {
    const name = /^["']?([A-Za-z_][\w.]*)/.exec(annotation.trim())?.[1];
    if (!name) return undefined;
    const [head, ...rest] = name.split(".");
    let sym = this.symbolOfName(head, scope, Number.MAX_SAFE_INTEGER, depth + 1);
    for (const part of rest) {
      if (sym?.kind !== "module") return undefined;
      sym = this.symbolOfName(part, sym.root, Number.MAX_SAFE_INTEGER, depth + 1);
    }
    return sym;
  }

  private importedSymbol(id: string, root: PyScope, depth: number): Sym | undefined {
    const imports = this.moduleOf(root).model.imports;
    for (const imp of imports) {
      const target = imp.aliases.get(id);
      if (target === undefined) continue;
      if (imp.names.length === 0) {
        const mod = this.loadModule(root, target);
        return mod ? { kind: "module", root: mod } : undefined;
      }
      const mod = this.loadModule(root, imp.module);
      if (mod && mod !== root) {
        const sym = this.symbolOfName(target, mod, Number.MAX_SAFE_INTEGER, depth + 1);
        if (sym) return sym;
      }
      // `from pkg import settings` where `settings` is itself a module.
      const sub = this.loadModule(root, `${imp.module}${imp.module.endsWith(".") ? "" : "."}${target}`);
      return sub ? { kind: "module", root: sub } : undefined;
    }
    return undefined;
  }

  private hintOf(cls: PyScope): string {
    return `${cls.name} ${this.moduleOf(cls).path}`.toLowerCase();
  }

  /** Values of `obj.attr` on a class or instance: class attributes, `self.attr = ...`, `@property`. */
  private classAttr(cls: PyScope, attr: string, ctx: EvalCtx): Val[] {
    const hint = this.hintOf(cls);
    return this.attrValues(cls, attr, ctx).map((v) => ({ ...v, hint: `${v.hint} ${hint}` }));
  }

  /** Values a parameter takes at same-file call sites of its function, with those sites. */
  private resolveThroughCallers(fn: PyScope, param: string, ctx: EvalCtx): Val[] {
    const params = positionalParams(fn);
    const index = params.indexOf(param);
    const isMethod = fn.parent?.kind === "class";
    const out: Val[] = [];
    for (const call of this.model.calls) {
      const callee = call.callee;
      if (!callee) continue;
      const matches = isMethod ? callee === `self.${fn.name}` || callee === `cls.${fn.name}` : callee === fn.name;
      if (!matches) continue;
      const arg = call.node.kwargs.find((k) => k.name === param)?.value ?? (index >= 0 ? call.node.args[index] : undefined);
      if (!arg) continue;
      const site = { startLine: call.startLine, endLine: call.endLine };
      const values = this.eval(arg, { scope: call.scope, line: call.startLine, hops: ctx.hops - 1, depth: ctx.depth });
      // The caller's class and function names count as routing hints (ShopifyCatalogTools).
      const callerNames: string[] = [];
      for (let s: PyScope | undefined = call.scope; s?.parent; s = s.parent) callerNames.push(s.name);
      const hint = callerNames.join(" ").toLowerCase();
      for (const v of values) out.push({ ...v, sites: [...v.sites, site], hint: `${v.hint} ${hint}`.trim() });
    }
    return out;
  }

  resolveSelfAttr(attr: string, ctx: EvalCtx): Val[] {
    const cls = this.enclosingClass(ctx.scope);
    if (!cls) return [];
    return this.attrValues(cls, attr, ctx);
  }

  private attrValues(cls: PyScope, attr: string, ctx: EvalCtx): Val[] {
    const lineOf = this.moduleOf(cls).model.lineOf;
    const out: Val[] = [];
    for (const member of cls.children) {
      if (member.kind !== "function") continue;
      if (member.name === attr && member.decorators.some((d) => /(^|\.)(property|cached_property)$/.test(d))) {
        for (const ret of member.returns) {
          out.push(...this.eval(ret, { scope: member, line: lineOf(ret.start), hops: 0, depth: ctx.depth }));
        }
      }
      for (const a of member.assignments) {
        if (a.target !== `self.${attr}`) continue;
        out.push(...this.eval(a.value, { scope: member, line: a.line, hops: 0, depth: ctx.depth }));
      }
    }
    for (const a of cls.assignments) {
      if (a.target === attr) out.push(...this.eval(a.value, { scope: cls, line: a.line, hops: 0, depth: ctx.depth }));
    }
    return out;
  }

  /** Assignment and `with ... as` values bound to a name or `self.attr` (for client receivers). */
  bindingsOf(receiver: string, scope: PyScope, line: number): Array<{ value: PyExpr; scope: PyScope; line: number }> {
    if (receiver.startsWith("self.")) {
      const cls = this.enclosingClass(scope);
      if (!cls) return [];
      const attr = receiver.slice("self.".length);
      const out: Array<{ value: PyExpr; scope: PyScope; line: number }> = [];
      for (const member of cls.children) {
        if (member.kind !== "function") continue;
        for (const a of member.assignments) if (a.target === receiver) out.push(a);
      }
      for (const a of cls.assignments) if (a.target === attr) out.push(a);
      return out;
    }
    let current: PyScope | undefined = scope;
    let first = true;
    while (current) {
      if (current.kind !== "class" || first) {
        const assigned = current.assignments.filter((a) => a.target === receiver);
        if (assigned.length > 0) {
          const before = first ? assigned.filter((a) => a.line <= line) : assigned;
          return before.length > 0 ? before : assigned;
        }
      }
      current = current.parent;
      first = false;
    }
    return [];
  }

  enclosingClass(scope: PyScope): PyScope | undefined {
    let current: PyScope | undefined = scope;
    while (current) {
      if (current.kind === "class") return current;
      current = current.parent;
    }
    return undefined;
  }

  lookupFunction(name: string, scope: PyScope): PyScope | undefined {
    let current: PyScope | undefined = scope;
    while (current) {
      const fn = current.children.find((c) => c.kind === "function" && c.name === name);
      if (fn && current.kind !== "class") return fn;
      current = current.parent;
    }
    return undefined;
  }
}

function positionalParams(fn: PyScope): string[] {
  const names = fn.params.map((p) => p.name);
  const isMethod = fn.parent?.kind === "class";
  const isStatic = fn.decorators.some((d) => d === "staticmethod");
  return isMethod && !isStatic && (names[0] === "self" || names[0] === "cls") ? names.slice(1) : names;
}

function product(left: Val[], right: Val[]): Val[] {
  const out: Val[] = [];
  for (const l of left) {
    for (const r of right) {
      out.push({ text: l.text + r.text, sites: [...l.sites, ...r.sites], hint: `${l.hint} ${r.hint}`.trim() });
      if (out.length >= MAX_VALUES) return out;
    }
  }
  return out;
}

function placeholder(text: string, prefix = ""): Val {
  return { text: `${prefix}{${text}}`, sites: [], hint: "" };
}

function cap(values: Val[]): Val[] {
  const seen = new Set<string>();
  const out: Val[] = [];
  for (const v of values) {
    const key = `${v.text}|${v.sites.map((s) => s.startLine).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_VALUES) break;
  }
  return out;
}

// ── Host routing ──────────────────────────────────────────────────────────

interface ParsedUrl {
  host: string;
  path: string;
}

const ABSOLUTE_URL = /^(?:https?|wss?):\/\/([^/?#\s]+)([^?#\s]*)/i;

function parseUrl(text: string): ParsedUrl | undefined {
  const m = ABSOLUTE_URL.exec(text.trim());
  if (!m) return undefined;
  let host = m[1].toLowerCase();
  host = host.slice(host.lastIndexOf("@") + 1).replace(/:\d+$/, "");
  if (!host || host.includes("{") || !host.includes(".")) return undefined;
  return { host, path: m[2] || "/" };
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase().replace(/^\./, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return host === p || host.endsWith(`.${p}`);
}

export class DestinationRouter {
  private readonly hostPatterns: Array<{ pattern: string; serviceName: string }>;
  private readonly routes: ThirdPartyUrlRoute[];
  private readonly pathRoutes: ThirdPartyUrlRouteRule[];
  private readonly modelPrefixes: LlmModelPrefix[];
  private readonly catalogSubTypes = new Map<string, string>();
  private readonly libraryNames: Set<string>;

  constructor(config: UnifiedPatternConfig, libraryNames: string[]) {
    this.hostPatterns = config.thirdParty.services.flatMap((svc) =>
      svc.urlHostPatterns.map((pattern) => ({ pattern, serviceName: svc.serviceName })),
    );
    this.routes = config.thirdParty.urlRoutes;
    this.pathRoutes = config.thirdParty.urlPathRoutes;
    this.modelPrefixes = config.thirdParty.llmModelPrefixes;
    for (const tp of config.classifier.thirdParties) {
      if (!this.catalogSubTypes.has(tp.serviceName.toLowerCase())) {
        this.catalogSubTypes.set(tp.serviceName.toLowerCase(), tp.subType);
      }
    }
    this.libraryNames = new Set([...libraryNames, ...EXTRA_LIBRARY_NAMES].map((n) => n.toLowerCase()));
  }

  /**
   * Service for a URL. `fallback` allows the registrable host (`acme.io`) for public hosts
   * the catalog does not know. Returns "unknown" for local, placeholder and dynamic hosts,
   * and `{ organizationHost }` for the scanned organization's own domains.
   */
  route(
    url: string,
    hint: string,
    fallback: boolean,
  ): { serviceName: string; subType?: string } | "unknown" | { organizationHost: string } {
    const parsed = parseUrl(url);
    if (!parsed) {
      // Host known only at runtime: a path route needs both its path and its hint.
      const runtimeHost = /^(?:https?|wss?):\/\/[^/?#\s]*\{[^}]*\}[^/?#\s]*([^?#\s]*)/i.exec(url.trim());
      if (!runtimeHost) return "unknown";
      const path = runtimeHost[1] || "/";
      const rule = this.pathRoutes.find((r) => r.path?.test(path) && r.hint?.test(hint));
      return rule ? this.named(rule.serviceName, rule.subType) : "unknown";
    }
    const organizationDomains = getActiveOrganizationDomains() ?? [];
    if (hostMatchesOrganizationDomains(parsed.host, organizationDomains)) return { organizationHost: parsed.host };
    const concrete = `https://${parsed.host}${parsed.path.replace(/\{[^}]*\}/g, "x")}`;
    if (shouldIgnoreExternalHttpUrl(concrete)) return "unknown";

    for (const route of this.routes) {
      if (!hostMatches(parsed.host, route.host)) continue;
      for (const rule of route.rules) {
        if (rule.path && !rule.path.test(parsed.path)) continue;
        if (rule.hint && !rule.hint.test(hint)) continue;
        return this.named(rule.serviceName, rule.subType);
      }
    }

    let best: { pattern: string; serviceName: string } | undefined;
    for (const candidate of this.hostPatterns) {
      if (!hostMatches(parsed.host, candidate.pattern)) continue;
      if (!best || candidate.pattern.length > best.pattern.length) best = candidate;
    }
    if (best) return this.named(best.serviceName);

    if (!fallback) return "unknown";
    const derived = defaultServiceNameFromLiteralPublicUrl(concrete);
    return derived ? this.named(derived) : "unknown";
  }

  /** Provider of an LLM gateway model id (`groq/llama-3.1-8b-instant` -> groq). */
  routeModel(model: string): { serviceName: string; subType?: string } | "unknown" {
    const prefix = model.trim().toLowerCase().split("/")[0];
    if (!prefix || prefix === model.trim().toLowerCase()) return "unknown";
    const entry = this.modelPrefixes.find((p) => p.prefix === prefix);
    return entry ? this.named(entry.serviceName) : "unknown";
  }

  isLibrary(name: string): boolean {
    return this.libraryNames.has(name.toLowerCase());
  }

  private named(serviceName: string, subType?: string): { serviceName: string; subType?: string } | "unknown" {
    if (this.isLibrary(serviceName)) return "unknown";
    const catalog = this.catalogSubTypes.get(serviceName.toLowerCase());
    return subType && subType !== catalog ? { serviceName, subType } : { serviceName };
  }
}

// ── Detection ─────────────────────────────────────────────────────────────

interface ClientInfo {
  library: RawHttpLibrary;
  baseUrl?: { expr: PyExpr; scope: PyScope; line: number };
}

export interface PythonOutboundHttpInput {
  filePath: string;
  content: string;
  libraries: RawHttpLibrary[];
  config: UnifiedPatternConfig;
}

export interface PythonOutboundHttpResult {
  findings: RawFinding[];
  /** True when the file builds OpenAI clients and every one points at a non-OpenAI host. */
  openAiClientsRedirected: boolean;
}

const resultCache = new Map<string, PythonOutboundHttpResult>();

export function detectPythonOutboundHttp(input: PythonOutboundHttpInput): PythonOutboundHttpResult {
  const key = `${pythonModuleIndexGeneration()}\u0000${input.filePath}\u0000${input.content}`;
  const cached = resultCache.get(key);
  if (cached) return cached;
  let result: PythonOutboundHttpResult;
  try {
    result = detectUncached(input);
  } catch {
    // Resolution is best effort: a construct the small parser cannot follow must not fail the scan.
    result = { findings: [], openAiClientsRedirected: false };
  }
  resultCache.clear();
  resultCache.set(key, result);
  return result;
}

interface ModuleInfo {
  importedLibraries: RawHttpLibrary[];
  moduleAliases: Map<string, RawHttpLibrary>;
  constructorLibrary(ctor: string): RawHttpLibrary | undefined;
  openAiImported: boolean;
  mcpImported: boolean;
  isPhoenixCall(callee: string): boolean;
  isLitellmCall(callee: string): boolean;
  isAdkLiteLlm(callee: string): boolean;
  /** `googleapiclient.discovery.build` (also imported inside a function body). */
  isGoogleBuild(callee: string): boolean;
}

const moduleInfoCache = new WeakMap<PySourceModel, ModuleInfo>();

/** What a module imports that marks outbound calls (HTTP libraries, SDKs). */
function moduleInfoFor(model: PySourceModel, libraries: RawHttpLibrary[]): ModuleInfo {
  const cached = moduleInfoCache.get(model);
  if (cached) return cached;
  const imported = (prefix: string): boolean =>
    model.imports.some((imp) => imp.module === prefix || imp.module.startsWith(`${prefix}.`));
  const importedLibraries = libraries.filter((lib) => lib.importModules.some((mod) => imported(mod)));

  const moduleAliases = new Map<string, RawHttpLibrary>();
  const constructorAliases = new Map<string, RawHttpLibrary>();
  for (const imp of model.imports) {
    const lib = importedLibraries.find((l) => l.importModules.some((m) => imp.module === m || imp.module.startsWith(`${m}.`)));
    if (!lib) continue;
    if (imp.names.length === 0) {
      for (const [alias, target] of imp.aliases) if (target === imp.module) moduleAliases.set(alias, lib);
    } else {
      for (const [alias, name] of imp.aliases) if (lib.constructors.includes(name)) constructorAliases.set(alias, lib);
    }
  }
  const constructorLibrary = (ctor: string): RawHttpLibrary | undefined => {
    const dot = ctor.lastIndexOf(".");
    if (dot === -1) return constructorAliases.get(ctor);
    const lib = moduleAliases.get(ctor.slice(0, dot));
    return lib && lib.constructors.includes(ctor.slice(dot + 1)) ? lib : undefined;
  };

  // Phoenix tracing: `register(...)`, `phoenix.otel.BatchSpanProcessor(...)` and the other
  // phoenix.otel entry points send spans to Arize Phoenix whatever the endpoint value.
  const phoenixModuleAliases = new Set<string>();
  const phoenixNames = new Set<string>();
  for (const imp of model.imports) {
    if (imp.module !== "phoenix.otel" && !imp.module.startsWith("phoenix.otel.")) {
      if (imp.module === "phoenix" && imp.names.includes("otel")) {
        for (const [alias, name] of imp.aliases) if (name === "otel") phoenixModuleAliases.add(alias);
      }
      continue;
    }
    if (imp.names.length === 0) {
      for (const [alias, target] of imp.aliases) phoenixModuleAliases.add(alias === "phoenix" ? "phoenix.otel" : alias === target ? target : alias);
    } else {
      for (const alias of imp.aliases.keys()) phoenixNames.add(alias);
    }
  }
  // LiteLLM: completion(model="groq/...") names the provider from the model prefix.
  const litellmAliases = new Set<string>();
  const litellmNames = new Set<string>();
  for (const imp of model.imports) {
    if (imp.module !== "litellm" && !imp.module.startsWith("litellm.")) continue;
    if (imp.names.length === 0) for (const alias of imp.aliases.keys()) litellmAliases.add(alias);
    else for (const [alias, name] of imp.aliases) if (LITELLM_CALLS.has(name)) litellmNames.add(alias);
  }
  // Google ADK's LiteLlm(model="provider/...") wraps LiteLLM.
  const adkLiteLlmNames = new Set<string>();
  for (const imp of model.imports) {
    if (!imp.module.startsWith("google.adk")) continue;
    for (const [alias, name] of imp.aliases) if (name === "LiteLlm") adkLiteLlmNames.add(alias);
  }

  // Google API clients: `from googleapiclient.discovery import build` (often inside a function).
  const googleBuildNames = new Set<string>();
  const googleDiscoveryModules = new Set<string>();
  for (const imp of model.imports) {
    if (imp.module === "googleapiclient.discovery" && imp.names.length > 0) {
      for (const [alias, name] of imp.aliases) if (name === "build") googleBuildNames.add(alias);
    } else if (imp.module === "googleapiclient" && imp.names.includes("discovery")) {
      for (const [alias, name] of imp.aliases) if (name === "discovery") googleDiscoveryModules.add(alias);
    } else if (imp.module === "googleapiclient.discovery") {
      for (const alias of imp.aliases.keys()) googleDiscoveryModules.add(alias === "googleapiclient" ? "googleapiclient.discovery" : alias);
    }
  }

  const info: ModuleInfo = {
    importedLibraries,
    moduleAliases,
    constructorLibrary,
    openAiImported: imported("openai"),
    mcpImported: imported("mcp") || imported("google.adk"),
    isPhoenixCall: (callee) => {
      if (phoenixNames.has(callee)) return true;
      const dot = callee.lastIndexOf(".");
      return dot > 0 && phoenixModuleAliases.has(callee.slice(0, dot));
    },
    isLitellmCall: (callee) => {
      if (litellmNames.has(callee)) return true;
      const dot = callee.lastIndexOf(".");
      return dot > 0 && litellmAliases.has(callee.slice(0, dot)) && LITELLM_CALLS.has(callee.slice(dot + 1));
    },
    isAdkLiteLlm: (callee) => adkLiteLlmNames.has(callee) || /(^|\.)lite_llm\.LiteLlm$/.test(callee),
    isGoogleBuild: (callee) => {
      if (googleBuildNames.has(callee)) return true;
      const dot = callee.lastIndexOf(".");
      return dot > 0 && callee.slice(dot + 1) === "build" && googleDiscoveryModules.has(callee.slice(0, dot));
    },
  };
  moduleInfoCache.set(model, info);
  return info;
}

function isWithin(scope: PyScope, fn: PyScope): boolean {
  for (let s: PyScope | undefined = scope; s; s = s.parent) if (s === fn) return true;
  return false;
}

function detectUncached(input: PythonOutboundHttpInput): PythonOutboundHttpResult {
  const { filePath, content, libraries } = input;
  const empty = { findings: [], openAiClientsRedirected: false };
  // Files that import nothing outbound can still call a same-repo wrapper (call_model(**kw)),
  // so with the module index active any file with a same-repo-looking import is analyzed.
  const mentionsOutbound = /\b(httpx|requests|aiohttp|openai|mcp|phoenix|google\.adk|litellm|googleapiclient)\b|['"](GET|POST|PUT|PATCH|DELETE)['"]/.test(content);
  const mayCallWrapper = pythonModuleIndexSize() > 1 && /^\s*(from\s+[\w.]+\s+import|import\s+\w)/m.test(content);
  if (!mentionsOutbound && !mayCallWrapper) {
    return empty;
  }
  const model = buildPySourceModel(content);
  const resolver = new Resolver(model, filePath);
  const router = new DestinationRouter(input.config, libraries.map((l) => l.name));
  const lines = content.split(/\r?\n/);
  const findings: RawFinding[] = [];
  const emitted = new Set<string>();

  const location = (site: Site): SourceLocation => ({
    filePath,
    startLine: site.startLine,
    endLine: site.endLine,
    code: lines[site.startLine - 1]?.trim() ?? "",
  });

  const hintFor = (call: PyCall, urlText: string): string => {
    const names: string[] = [filePath];
    let scope: PyScope | undefined = call.scope;
    while (scope) {
      names.push(scope.name);
      scope = scope.parent;
    }
    names.push(urlText);
    return names.join(" ").toLowerCase();
  };

  const emit = (
    call: PyCall,
    destinations: Destination[],
    extra: Record<string, unknown>,
    patternId: RawFinding["pattern"],
    confidence: number,
  ): void => {
    for (const d of destinations) {
      if (d.firstPartyHost) {
        emitFirstParty(call, d, extra, patternId, confidence);
        continue;
      }
      const name = d.subType ? `${d.serviceName} ${d.subType}` : d.serviceName;
      const sites = [{ startLine: call.startLine, endLine: call.endLine }, ...d.sites];
      for (const site of sites) {
        const dedupe = `${name}|${site.startLine}|${site.endLine}`;
        if (emitted.has(dedupe)) continue;
        emitted.add(dedupe);
        findings.push({
          pattern: patternId,
          name,
          confidence,
          location: location(site),
          properties: {
            serviceName: d.serviceName,
            ...(d.url ? { url: d.url } : {}),
            ...(d.subType ? { thirdPartySubType: d.subType } : {}),
            ...extra,
          },
        });
      }
    }
  };

  /** A call to one of the organization's own hosts: a first-party API, never a vendor. */
  const emitFirstParty = (
    call: PyCall,
    d: Destination,
    extra: Record<string, unknown>,
    patternId: RawFinding["pattern"],
    confidence: number,
  ): void => {
    const host = d.firstPartyHost!;
    for (const site of [{ startLine: call.startLine, endLine: call.endLine }, ...d.sites]) {
      const dedupe = `first_party|${host}|${site.startLine}|${site.endLine}`;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      findings.push({
        pattern: patternId,
        name: host,
        confidence,
        location: location(site),
        properties: { firstParty: true, host, url: d.url, ...extra },
      });
    }
  };

  /** Destinations for URL values; `fallback` allows hosts outside the catalog. */
  const destinationsFor = (call: PyCall, values: Val[], fallback: boolean): { known: Destination[]; organization: boolean } => {
    const known: Destination[] = [];
    let organization = false;
    const seen = new Set<string>();
    for (const v of values) {
      const routed = router.route(v.text, `${hintFor(call, v.text)} ${v.hint}`, fallback);
      if (routed === "unknown") continue;
      if ("organizationHost" in routed) {
        organization = true;
        const host = routed.organizationHost;
        if (!known.some((d) => d.firstPartyHost === host)) known.push({ serviceName: "", url: v.text, sites: v.sites, firstPartyHost: host });
        continue;
      }
      const key = `${routed.serviceName}|${routed.subType ?? ""}|${v.sites.map((s) => s.startLine).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      known.push({ ...routed, url: v.text, sites: v.sites });
    }
    return { known, organization };
  };

  const ctxFor = (call: PyCall, hops: number): EvalCtx => ({ scope: call.scope, line: call.startLine, hops, depth: 0 });

  /** Resolve a URL argument: literal/constant/attribute first, then base_url, then callers. */
  const resolveRequestUrl = (
    call: PyCall,
    urlExpr: PyExpr | undefined,
    client: ClientInfo | undefined,
    fallback: boolean,
    /** Where `urlExpr` lives when it came from a kwargs dict built elsewhere. */
    exprCtx?: EvalCtx,
  ): { known: Destination[]; organization: boolean; literalUrl?: string } => {
    const at = (hops: number): EvalCtx => (exprCtx ? { ...exprCtx, hops } : ctxFor(call, hops));
    const direct = urlExpr ? resolver.eval(urlExpr, at(0)) : [];
    const absolute = direct.filter((v) => parseUrl(v.text));
    if (absolute.length > 0) {
      const result = destinationsFor(call, absolute, fallback);
      return { ...result, literalUrl: absolute[0]?.text };
    }
    if (client?.baseUrl) {
      const bases = resolver
        .eval(client.baseUrl.expr, { scope: client.baseUrl.scope, line: client.baseUrl.line, hops: 0, depth: 0 })
        .filter((v) => parseUrl(v.text));
      if (bases.length > 0) {
        const rel = direct.length > 0 ? direct : [urlExpr ? placeholder(exprText(model, urlExpr)) : { text: "", sites: [], hint: "" }];
        const joined = bases.flatMap((b) => rel.map((r) => ({ text: joinUrl(b.text, r.text), sites: [...b.sites, ...r.sites], hint: `${b.hint} ${r.hint}` })));
        return destinationsFor(call, joined, fallback);
      }
    }
    const viaCallersAll = urlExpr ? resolver.eval(urlExpr, at(MAX_CALLER_HOPS)) : [];
    const viaCallers = viaCallersAll.filter((v) => parseUrl(v.text));
    if (viaCallers.length > 0) return { ...destinationsFor(call, viaCallers, fallback), literalUrl: viaCallers[0]?.text };
    // Absolute URL whose host is only known at runtime (`https://{shop}/api/mcp`): path routes.
    const runtimeHost = [...direct, ...viaCallersAll].filter((v) => /^(?:https?|wss?):\/\/[^/?#\s]*\{/i.test(v.text));
    if (runtimeHost.length > 0) return destinationsFor(call, runtimeHost, false);
    return { known: [], organization: false };
  };

  const clientOf = (receiver: PyExpr, call: PyCall, info: ModuleInfo): ClientInfo | "module" | undefined => {
    const name = dottedName(receiver);
    if (!name) return undefined;
    if (info.moduleAliases.has(name)) return "module";
    for (const binding of resolver.bindingsOf(name, call.scope, call.startLine)) {
      const value = binding.value;
      if (value.kind !== "call") continue;
      const ctor = dottedName(value.func);
      if (!ctor) continue;
      const lib = info.constructorLibrary(ctor);
      if (!lib) continue;
      const baseUrl = value.kwargs.find((k) => k.name === "base_url")?.value;
      return { library: lib, ...(baseUrl ? { baseUrl: { expr: baseUrl, scope: binding.scope, line: binding.line } } : {}) };
    }
    return undefined;
  };

  let openAiClients = 0;
  let openAiRedirected = 0;
  const mainInfo = moduleInfoFor(model, libraries);

  /**
   * Detect one outbound call. `ctx` evaluates its arguments; `site` is where findings go
   * (the call itself, or the caller of a wrapper the call sits in). Returns true when the
   * call is an outbound call kind, resolved or not.
   */
  const handle = (call: PyCall, info: ModuleInfo, ctx: EvalCtx, site: PyCall, viaWrapper: boolean): boolean => {
    const { node } = call;
    const callee = call.callee ?? "";
    const last = callee.slice(callee.lastIndexOf(".") + 1);
    const resolveUrl = (urlExpr: PyExpr | undefined, client: ClientInfo | undefined, fallback: boolean, exprCtx?: EvalCtx) =>
      resolveRequestUrl(site, urlExpr, client, fallback, exprCtx ?? ctx);

    // 1. Raw HTTP library request calls.
    if (info.importedLibraries.length > 0 && node.func.kind === "attr" && REQUEST_VERBS.has(node.func.attr)) {
      const client = clientOf(node.func.object, call, info);
      if (client) {
        const library = client === "module" ? info.moduleAliases.get(dottedName(node.func.object)!)! : client.library;
        if (client === "module" && library.name === "aiohttp" && node.func.attr !== "request") return true;
        const urlExpr = METHOD_FIRST_VERBS.has(node.func.attr)
          ? (node.args[1] ?? node.kwargs.find((k) => k.name === "url")?.value)
          : (node.args[0] ?? node.kwargs.find((k) => k.name === "url" || k.name === "str_or_url")?.value);
        const resolved = resolveUrl(urlExpr, client === "module" ? undefined : client, true);
        if (resolved.known.length > 0) {
          emit(site, resolved.known, { httpClientLibrary: library.name }, library.patternId, library.confidence);
        } else if (!viaWrapper) {
          const dedupe = `${OUTBOUND_HTTP_UNKNOWN_FINDING_NAME}|${call.startLine}|${call.endLine}`;
          if (!emitted.has(dedupe)) {
            emitted.add(dedupe);
            findings.push({
              pattern: library.patternId,
              name: OUTBOUND_HTTP_UNKNOWN_FINDING_NAME,
              confidence: library.confidence,
              location: location({ startLine: call.startLine, endLine: call.endLine }),
              properties: {
                httpClientLibrary: library.name,
                destination: "unknown",
                ...(resolved.literalUrl ? { url: resolved.literalUrl } : {}),
              },
            });
          }
        }
        return true;
      }
    }

    // 2. OpenAI-compatible clients pointed at another provider.
    if (info.openAiImported && OPENAI_CLIENTS.has(last) && (callee === last || callee === `openai.${last}`)) {
      if (!viaWrapper) openAiClients += 1;
      const baseUrls = resolver.kwargExprs(node, "base_url", ctx);
      const known = baseUrls.flatMap((b) => resolveUrl(b.expr, undefined, true, b.ctx).known);
      const elsewhere = known.filter((d) => d.serviceName.toLowerCase() !== "openai");
      if (!viaWrapper && elsewhere.length > 0 && elsewhere.length === known.length) openAiRedirected += 1;
      emit(site, known, { client: "openai_compatible" }, "external_api_call", 0.85);
      return true;
    }

    // 3. MCP over HTTP.
    if (info.mcpImported && (MCP_URL_CALLS.has(last) || MCP_URL_PARAMS.has(last))) {
      // `url=` directly, as the first argument, or inside a `**params` dict.
      const urlSources: Array<{ expr: PyExpr; ctx: EvalCtx }> =
        !MCP_URL_PARAMS.has(last) && node.args[0] ? [{ expr: node.args[0], ctx }] : resolver.kwargExprs(node, "url", ctx);
      const known = urlSources.flatMap((source) => resolveUrl(source.expr, undefined, true, source.ctx).known);
      emit(site, known, { transport: "mcp_http" }, "external_api_call", 0.85);
      return true;
    }

    // 4. Phoenix tracing (not followed through wrappers: the package is the vendor).
    if (info.isPhoenixCall(callee)) {
      if (!viaWrapper) emit(site, [{ serviceName: "arize_phoenix", url: "", sites: [] }], { transport: "otlp" }, "external_api_call", 0.85);
      return true;
    }

    // 5. LiteLLM provider prefixes.
    if (info.isLitellmCall(callee) || info.isAdkLiteLlm(callee)) {
      // The request goes to api_base when it is set, whatever provider the model prefix
      // names (an OpenAI-compatible gateway serving "groq/..." is still the gateway). So a
      // known api_base host decides; the model prefix only counts when api_base is unknown.
      // A helper with several return branches gives one api_base per branch, so each
      // branch that names a host contributes its vendor.
      const bases = ["api_base", "base_url"].flatMap((name) => resolver.kwargExprs(node, name, ctx));
      const viaBase = bases.flatMap((b) => resolveUrl(b.expr, undefined, true, b.ctx).known);
      if (viaBase.length > 0) {
        emit(site, viaBase, { client: "litellm" }, "external_api_call", 0.85);
        return true;
      }
      const models = resolver.kwargExprs(node, "model", ctx);
      if (models.length === 0 && node.args[0]) models.push({ expr: node.args[0], ctx });
      const providers: Destination[] = [];
      for (const m of models) {
        for (const v of resolver.eval(m.expr, m.ctx)) {
          const routed = router.routeModel(v.text);
          if (routed === "unknown" || providers.some((p) => p.serviceName === routed.serviceName)) continue;
          providers.push({ ...routed, url: "", sites: [] });
        }
      }
      emit(site, providers, { client: "litellm" }, "external_api_call", 0.85);
      return true;
    }

    // 6. Google API clients: build("gmail", "v1", ...) names the Google product.
    if (info.isGoogleBuild(callee)) {
      const apiExpr = node.args[0] ?? node.kwargs.find((k) => k.name === "serviceName")?.value;
      const services: Destination[] = [];
      for (const v of apiExpr ? resolver.eval(apiExpr, ctx) : []) {
        const serviceName = input.config.thirdParty.googleApiServices.get(v.text.toLowerCase());
        if (serviceName && !services.some((s) => s.serviceName === serviceName)) services.push({ serviceName, url: "", sites: [] });
      }
      emit(site, services, { client: "googleapiclient" }, "external_api_call", 0.85);
      return true;
    }

    // 7. Unresolved `(method, url)` helpers such as nexus_call("POST", url, ...): only
    //    catalog hosts count, so ordinary two-string calls do not become destinations.
    const methodArg = node.args[0];
    if (methodArg?.kind === "str" && node.args[1] && methodArg.parts.length === 1 && typeof methodArg.parts[0] === "string" && HTTP_METHODS.has(methodArg.parts[0].toUpperCase())) {
      if (node.func.kind === "attr" && clientOf(node.func.object, call, info)) return true;
      const { known } = resolveUrl(node.args[1], undefined, false);
      emit(site, known, { client: last || "http_helper" }, "external_api_call", 0.8);
      return known.length > 0;
    }
    return false;
  };

  for (const call of model.calls) {
    const ctx = ctxFor(call, 0);
    if (handle(call, mainInfo, ctx, call, false)) continue;

    // 8. Pass-through wrappers: a same-repo function whose parameters (named or **kwargs)
    //    reach an outbound call. Evaluate that inner call with this call's arguments bound
    //    and report at this call, where the destination is chosen (one level of wrapping).
    const target = resolver.callTarget(call.node, ctx);
    if (!target) continue;
    const { fn, bindings } = target;
    const varkw = fn.params.find((p) => p.star === "kwargs");
    if (varkw) {
      const { node } = call;
      const passed: PyExpr = {
        kind: "coll",
        elts: node.kwargs.map((k) => k.value),
        entries: node.kwargs.map((k) => ({ key: k.name, value: k.value })),
        spreads: node.starKwargs,
        start: node.start,
        end: node.end,
      };
      bindings.set(varkw.name, { expr: passed, ctx });
    }
    if (bindings.size === 0) continue;
    const owner = resolver.moduleModelOf(fn);
    const innerInfo = owner === model ? mainInfo : moduleInfoFor(owner, libraries);
    for (const inner of owner.calls) {
      if (!isWithin(inner.scope, fn)) continue;
      handle(inner, innerInfo, { scope: inner.scope, line: inner.startLine, hops: 0, depth: 0, bindings }, call, true);
    }
  }

  return {
    findings,
    openAiClientsRedirected: openAiClients > 0 && openAiRedirected === openAiClients,
  };
}

function joinUrl(base: string, path: string): string {
  if (!path) return base;
  if (parseUrl(path)) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
