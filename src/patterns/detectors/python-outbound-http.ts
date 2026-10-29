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
import type { ThirdPartyUrlRoute } from "../../config/third-party-detection-config";
import {
  defaultServiceNameFromLiteralPublicUrl,
  hostMatchesOrganizationDomains,
  shouldIgnoreExternalHttpUrl,
} from "../../classifier/external-url-third-party";
import { getActiveOrganizationDomains } from "../../classifier/organization-domains-scan-scope";
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
}

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

interface Destination {
  serviceName: string;
  subType?: string;
  url: string;
  sites: Site[];
}

// ── Value resolution ──────────────────────────────────────────────────────

class Resolver {
  private readonly active = new Set<string>();

  constructor(private readonly model: PySourceModel) {}

  eval(expr: PyExpr, ctx: EvalCtx): Val[] {
    if (ctx.depth > MAX_DEPTH) return [];
    const key = `${expr.start}:${expr.end}:${ctx.hops}:${ctx.bindings ? [...ctx.bindings.keys()].join(",") : ""}`;
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
        let acc: Val[] = [{ text: "", sites: [] }];
        for (const part of expr.parts) {
          if (typeof part === "string") {
            acc = acc.map((v) => ({ text: v.text + part, sites: v.sites }));
            continue;
          }
          const values = this.eval(part, ctx);
          const pieces = values.length > 0 ? values : [{ text: `{${exprText(this.model, part)}}`, sites: [] }];
          acc = product(acc, pieces);
        }
        return acc;
      }
      case "name":
        return this.resolveName(expr.id, ctx);
      case "attr": {
        const base = dottedName(expr.object);
        if (base === "self" || base === "cls") return this.resolveSelfAttr(expr.attr, ctx);
        return [];
      }
      case "call":
        return this.evalCall(expr, ctx);
      case "binop": {
        if (expr.op === "%") return this.eval(expr.left, ctx);
        if (expr.op !== "+") return [];
        const left = this.eval(expr.left, ctx);
        const right = this.eval(expr.right, ctx);
        if (left.length === 0 && right.length === 0) return [];
        const l = left.length > 0 ? left : [{ text: `{${exprText(this.model, expr.left)}}`, sites: [] }];
        const r = right.length > 0 ? right : [{ text: `{${exprText(this.model, expr.right)}}`, sites: [] }];
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
    if (callee && /(^|\.)urljoin$/.test(callee) && expr.args.length >= 2) {
      const base = this.eval(expr.args[0], ctx);
      const rel = this.eval(expr.args[1], ctx);
      return product(base, rel.length > 0 ? rel : [{ text: "/{…}", sites: [] }]);
    }
    if (expr.func.kind === "attr" && STRING_METHODS.has(expr.func.attr)) {
      const receiver = this.eval(expr.func.object, ctx);
      if (expr.func.attr === "rstrip" || expr.func.attr === "strip") {
        return receiver.map((v) => ({ ...v, text: v.text.replace(/\/+$/, "") }));
      }
      return receiver;
    }
    // Same-file function or method: evaluate its return values with the arguments bound.
    const func = expr.func;
    let target: PyScope | undefined;
    if (func.kind === "name") target = this.lookupFunction(func.id, ctx.scope);
    else if (func.kind === "attr" && (dottedName(func.object) === "self" || dottedName(func.object) === "cls")) {
      target = this.enclosingClass(ctx.scope)?.children.find((c) => c.kind === "function" && c.name === func.attr);
    }
    if (!target) return [];
    const bindings = this.bindArguments(target, expr, ctx);
    return target.returns.flatMap((ret) =>
      this.eval(ret, { scope: target!, line: this.model.lineOf(ret.start), bindings, hops: 0, depth: ctx.depth }),
    );
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
      scope = scope.parent;
      first = false;
    }
    return [];
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
      for (const v of values) out.push({ text: v.text, sites: [...v.sites, site] });
    }
    return out;
  }

  resolveSelfAttr(attr: string, ctx: EvalCtx): Val[] {
    const cls = this.enclosingClass(ctx.scope);
    if (!cls) return [];
    const out: Val[] = [];
    for (const member of cls.children) {
      if (member.kind !== "function") continue;
      if (member.name === attr && member.decorators.some((d) => /(^|\.)(property|cached_property)$/.test(d))) {
        for (const ret of member.returns) {
          out.push(...this.eval(ret, { scope: member, line: this.model.lineOf(ret.start), hops: 0, depth: ctx.depth }));
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
      out.push({ text: l.text + r.text, sites: [...l.sites, ...r.sites] });
      if (out.length >= MAX_VALUES) return out;
    }
  }
  return out;
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
  private readonly catalogSubTypes = new Map<string, string>();
  private readonly libraryNames: Set<string>;

  constructor(config: UnifiedPatternConfig, libraryNames: string[]) {
    this.hostPatterns = config.thirdParty.services.flatMap((svc) =>
      svc.urlHostPatterns.map((pattern) => ({ pattern, serviceName: svc.serviceName })),
    );
    this.routes = config.thirdParty.urlRoutes;
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
   * and "organization" for the scanned organization's own domains.
   */
  route(
    url: string,
    hint: string,
    fallback: boolean,
  ): { serviceName: string; subType?: string } | "unknown" | "organization" {
    const parsed = parseUrl(url);
    if (!parsed) return "unknown";
    const organizationDomains = getActiveOrganizationDomains() ?? [];
    if (hostMatchesOrganizationDomains(parsed.host, organizationDomains)) return "organization";
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
  const key = `${input.filePath}\u0000${input.content}`;
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

function detectUncached(input: PythonOutboundHttpInput): PythonOutboundHttpResult {
  const { filePath, content, libraries } = input;
  const empty = { findings: [], openAiClientsRedirected: false };
  if (!/\b(httpx|requests|aiohttp|openai|mcp|phoenix|google\.adk)\b|['"](GET|POST|PUT|PATCH|DELETE)['"]/.test(content)) {
    return empty;
  }
  const model = buildPySourceModel(content);
  const resolver = new Resolver(model);
  const router = new DestinationRouter(input.config, libraries.map((l) => l.name));
  const lines = content.split(/\r?\n/);
  const findings: RawFinding[] = [];
  const emitted = new Set<string>();

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
            url: d.url,
            ...(d.subType ? { thirdPartySubType: d.subType } : {}),
            ...extra,
          },
        });
      }
    }
  };

  /** Destinations for URL values; `fallback` allows hosts outside the catalog. */
  const destinationsFor = (call: PyCall, values: Val[], fallback: boolean): { known: Destination[]; organization: boolean } => {
    const known: Destination[] = [];
    let organization = false;
    const seen = new Set<string>();
    for (const v of values) {
      const routed = router.route(v.text, hintFor(call, v.text), fallback);
      if (routed === "organization") {
        organization = true;
        continue;
      }
      if (routed === "unknown") continue;
      const key = `${routed.serviceName}|${routed.subType ?? ""}|${v.sites.map((s) => s.startLine).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      known.push({ ...routed, url: v.text, sites: v.sites });
    }
    return { known, organization };
  };

  const ctxFor = (call: PyCall, hops: number): EvalCtx => ({ scope: call.scope, line: call.startLine, hops, depth: 0 });

  /** Resolve a URL argument: literal/constant/attribute first, then base_url, then callers. */
  const resolveRequestUrl = (call: PyCall, urlExpr: PyExpr | undefined, client: ClientInfo | undefined, fallback: boolean): { known: Destination[]; organization: boolean; literalUrl?: string } => {
    const direct = urlExpr ? resolver.eval(urlExpr, ctxFor(call, 0)) : [];
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
        const rel = direct.length > 0 ? direct : [{ text: urlExpr ? `{${exprText(model, urlExpr)}}` : "", sites: [] }];
        const joined = bases.flatMap((b) => rel.map((r) => ({ text: joinUrl(b.text, r.text), sites: [...b.sites, ...r.sites] })));
        return destinationsFor(call, joined, fallback);
      }
    }
    if (urlExpr) {
      const viaCallers = resolver.eval(urlExpr, ctxFor(call, MAX_CALLER_HOPS)).filter((v) => parseUrl(v.text));
      if (viaCallers.length > 0) return { ...destinationsFor(call, viaCallers, fallback), literalUrl: viaCallers[0]?.text };
    }
    return { known: [], organization: false };
  };

  const clientOf = (receiver: PyExpr, call: PyCall): ClientInfo | "module" | undefined => {
    const name = dottedName(receiver);
    if (!name) return undefined;
    if (moduleAliases.has(name)) return "module";
    for (const binding of resolver.bindingsOf(name, call.scope, call.startLine)) {
      const value = binding.value;
      if (value.kind !== "call") continue;
      const ctor = dottedName(value.func);
      if (!ctor) continue;
      const lib = constructorLibrary(ctor);
      if (!lib) continue;
      const baseUrl = value.kwargs.find((k) => k.name === "base_url")?.value;
      return { library: lib, ...(baseUrl ? { baseUrl: { expr: baseUrl, scope: binding.scope, line: binding.line } } : {}) };
    }
    return undefined;
  };

  const constructorLibrary = (ctor: string): RawHttpLibrary | undefined => {
    const dot = ctor.lastIndexOf(".");
    if (dot === -1) return constructorAliases.get(ctor);
    const lib = moduleAliases.get(ctor.slice(0, dot));
    return lib && lib.constructors.includes(ctor.slice(dot + 1)) ? lib : undefined;
  };

  let openAiClients = 0;
  let openAiRedirected = 0;
  const openAiImported = imported("openai");
  const mcpImported = imported("mcp") || imported("google.adk");
  const phoenixRegister = new Set<string>(["phoenix.otel.register", "px.otel.register"]);
  for (const imp of model.imports) {
    if (imp.module === "phoenix.otel") {
      for (const [alias, name] of imp.aliases) if (name === "register") phoenixRegister.add(alias);
    }
  }

  for (const call of model.calls) {
    const { node } = call;
    const callee = call.callee ?? "";
    const last = callee.slice(callee.lastIndexOf(".") + 1);

    // 1. Raw HTTP library request calls.
    if (importedLibraries.length > 0 && node.func.kind === "attr" && REQUEST_VERBS.has(node.func.attr)) {
      const client = clientOf(node.func.object, call);
      if (client) {
        const library = client === "module" ? moduleAliases.get(dottedName(node.func.object)!)! : client.library;
        if (client === "module" && library.name === "aiohttp" && node.func.attr !== "request") continue;
        const urlExpr = METHOD_FIRST_VERBS.has(node.func.attr)
          ? (node.args[1] ?? node.kwargs.find((k) => k.name === "url")?.value)
          : (node.args[0] ?? node.kwargs.find((k) => k.name === "url" || k.name === "str_or_url")?.value);
        const resolved = resolveRequestUrl(call, urlExpr, client === "module" ? undefined : client, true);
        if (resolved.organization && resolved.known.length === 0) continue;
        if (resolved.known.length > 0) {
          emit(call, resolved.known, { httpClientLibrary: library.name }, library.patternId, library.confidence);
        } else {
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
        continue;
      }
    }

    // 2. OpenAI-compatible clients pointed at another provider.
    if (openAiImported && OPENAI_CLIENTS.has(last) && (callee === last || callee === `openai.${last}`)) {
      openAiClients += 1;
      const baseUrl = node.kwargs.find((k) => k.name === "base_url")?.value;
      if (!baseUrl) continue;
      const { known } = resolveRequestUrl(call, baseUrl, undefined, true);
      const elsewhere = known.filter((d) => d.serviceName.toLowerCase() !== "openai");
      if (elsewhere.length > 0 && elsewhere.length === known.length) openAiRedirected += 1;
      emit(call, known, { client: "openai_compatible" }, "external_api_call", 0.85);
      continue;
    }

    // 3. MCP over HTTP.
    if (mcpImported && (MCP_URL_CALLS.has(last) || MCP_URL_PARAMS.has(last))) {
      const urlExpr = MCP_URL_PARAMS.has(last)
        ? node.kwargs.find((k) => k.name === "url")?.value
        : (node.args[0] ?? node.kwargs.find((k) => k.name === "url")?.value);
      if (!urlExpr) continue;
      const { known } = resolveRequestUrl(call, urlExpr, undefined, true);
      emit(call, known, { transport: "mcp_http" }, "external_api_call", 0.85);
      continue;
    }

    // 4. Phoenix tracing (phoenix.otel.register(endpoint=...)).
    if (phoenixRegister.has(callee)) {
      const endpoint = node.kwargs.find((k) => k.name === "endpoint")?.value;
      if (!endpoint) continue;
      const { known } = resolveRequestUrl(call, endpoint, undefined, false);
      emit(call, known, { transport: "otlp" }, "external_api_call", 0.85);
      continue;
    }

    // 5. Unresolved `(method, url)` helpers such as nexus_call("POST", url, ...): only
    //    catalog hosts count, so ordinary two-string calls do not become destinations.
    const methodArg = node.args[0];
    if (methodArg?.kind === "str" && node.args[1] && methodArg.parts.length === 1 && typeof methodArg.parts[0] === "string" && HTTP_METHODS.has(methodArg.parts[0].toUpperCase())) {
      if (node.func.kind === "attr" && clientOf(node.func.object, call)) continue;
      const { known } = resolveRequestUrl(call, node.args[1], undefined, false);
      emit(call, known, { client: last || "http_helper" }, "external_api_call", 0.8);
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
