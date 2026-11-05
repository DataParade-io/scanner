/**
 * TypeScript/JavaScript outbound HTTP destinations (DATAP-818), the counterpart of
 * `python-outbound-http.ts`.
 *
 * It parses the file with the TypeScript compiler API (the TS analyzer's parser already
 * depends on it) and finds request calls: the global `fetch`, and the raw HTTP libraries
 * marked `rawHttp` in `typescript.patterns.yaml` (axios, got, ky, node-fetch ...), including
 * instances made with `axios.create({ baseURL })` / `got.extend({ prefixUrl })`. The URL is
 * resolved from literals and template literals, `const` bindings, parameter defaults,
 * `??` / `||` defaults on `process.env`, object-literal constants, and `const` exports of
 * same-repo modules imported with a relative path. A known host names the vendor; a URL that
 * only comes from the environment (`import.meta.env.VITE_*`, `process.env.X` with no default)
 * gives an outbound call with no vendor. A library is never the destination. Relative URLs
 * with no base are same-origin calls and are not reported.
 */

import * as ts from "typescript";

import type { RawFinding } from "../../core/types/detection";
import type { UnifiedPatternConfig } from "../config";
import type { RawHttpClientConfig } from "../../analyzers/typescript/typescript-detection-config";
import {
  DestinationRouter,
  OUTBOUND_HTTP_UNKNOWN_FINDING_NAME,
  remoteServiceName,
  remoteServiceProperties,
} from "./python-outbound-http";
import { resolveTsModulePath, sourceModule } from "./source-module-index";

const REQUEST_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "request"]);
const MAX_DEPTH = 10;
const MAX_VALUES = 8;
const ENV_PREFIX = "{env:";

interface Val {
  text: string;
}

interface Lib {
  name: string;
  config: RawHttpClientConfig;
}

interface Instance {
  lib: Lib;
  base?: ts.Expression;
}

export interface TsOutboundHttpResult {
  findings: RawFinding[];
  /** 1-based line spans of the request calls the detector handled (resolved or not). */
  coveredSpans: Array<{ startLine: number; endLine: number }>;
}

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const sourceCache = new Map<string, ts.SourceFile>();

function parse(path: string, content: string): ts.SourceFile {
  const key = `${path}\u0000${content.length}\u0000${content.slice(0, 64)}`;
  const cached = sourceCache.get(key);
  if (cached && cached.text === content) return cached;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  if (sourceCache.size > 64) sourceCache.clear();
  sourceCache.set(key, sf);
  return sf;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isEnvAccess(node: ts.Expression): string | undefined {
  // process.env.X, process.env["X"], import.meta.env.X
  const n = unwrap(node);
  const target = ts.isPropertyAccessExpression(n) ? n.expression : ts.isElementAccessExpression(n) ? n.expression : undefined;
  if (!target) return undefined;
  const text = target.getText();
  if (text !== "process.env" && text !== "import.meta.env") return undefined;
  return ts.isPropertyAccessExpression(n) ? n.name.text : n.getText();
}

function product(left: Val[], right: Val[]): Val[] {
  const out: Val[] = [];
  for (const l of left) for (const r of right) {
    out.push({ text: l.text + r.text });
    if (out.length >= MAX_VALUES) return out;
  }
  return out;
}

function dedupe(values: Val[]): Val[] {
  const seen = new Set<string>();
  return values.filter((v) => (seen.has(v.text) ? false : (seen.add(v.text), true))).slice(0, MAX_VALUES);
}

/** Drop environment-only values when a concrete default exists (`process.env.X ?? "https://..."`). */
function preferConcrete(values: Val[]): Val[] {
  const concrete = values.filter((v) => !v.text.startsWith(ENV_PREFIX));
  return concrete.length > 0 ? concrete : values;
}

class TsResolver {
  constructor(private readonly path: string) {}

  eval(node: ts.Expression, depth = 0): Val[] {
    if (depth > MAX_DEPTH) return [];
    const n = unwrap(node);
    const next = depth + 1;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [{ text: n.text }];
    if (ts.isTemplateExpression(n)) {
      let acc: Val[] = [{ text: n.head.text }];
      for (const span of n.templateSpans) {
        const values = this.eval(span.expression, next);
        const piece = values.length > 0 ? values : [{ text: `{${span.expression.getText()}}` }];
        acc = product(product(acc, piece), [{ text: span.literal.text }]);
      }
      return acc;
    }
    const env = isEnvAccess(n);
    if (env) return [{ text: `${ENV_PREFIX}${env}}` }];
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
        return preferConcrete(dedupe([...this.eval(n.left, next), ...this.eval(n.right, next)]));
      }
      if (op === ts.SyntaxKind.PlusToken) {
        const l = this.eval(n.left, next);
        const r = this.eval(n.right, next);
        if (l.length === 0 && r.length === 0) return [];
        return product(l.length ? l : [{ text: `{${n.left.getText()}}` }], r.length ? r : [{ text: `{${n.right.getText()}}` }]);
      }
      return [];
    }
    if (ts.isConditionalExpression(n)) return dedupe([...this.eval(n.whenTrue, next), ...this.eval(n.whenFalse, next)]);
    if (ts.isIdentifier(n)) return this.resolveIdentifier(n, next);
    if (ts.isPropertyAccessExpression(n)) {
      // CONFIG.apiBase where CONFIG is a const object literal.
      const obj = this.objectLiteralOf(n.expression, next);
      const prop = obj?.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propertyName(p) === n.name.text,
      );
      return prop ? this.eval(prop.initializer, next) : [];
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "String" && n.arguments[0]) {
      return this.eval(n.arguments[0], next);
    }
    return [];
  }

  /** Object literal a name or expression refers to (for property reads and instance options). */
  objectLiteralOf(node: ts.Expression, depth: number): ts.ObjectLiteralExpression | undefined {
    const n = unwrap(node);
    if (ts.isObjectLiteralExpression(n)) return n;
    if (ts.isIdentifier(n) && depth <= MAX_DEPTH) {
      const decl = this.declarationOf(n);
      if (decl?.initializer) return this.objectLiteralOf(decl.initializer, depth + 1);
    }
    return undefined;
  }

  private resolveIdentifier(id: ts.Identifier, depth: number): Val[] {
    const name = id.text;
    // Parameters: use the default value (`apiBase = DEFAULT_API_BASE`).
    for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
      if (ts.isFunctionLike(node)) {
        const param = node.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name);
        if (param) return param.initializer ? this.eval(param.initializer, depth) : [];
      }
    }
    const decl = this.declarationOf(id);
    if (decl) return decl.initializer ? this.eval(decl.initializer, depth) : [];
    return this.importedConst(id, depth);
  }

  /** Nearest `const/let/var name = ...` visible from `id` (block, function or file level). */
  declarationOf(id: ts.Identifier): ts.VariableDeclaration | undefined {
    const name = id.text;
    for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
      if (!(ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node))) continue;
      for (const stmt of node.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return d;
        }
      }
    }
    return undefined;
  }

  /** `import { NAME } from "./settings"` -> the exported const in that same-repo module. */
  private importedConst(id: ts.Identifier, depth: number): Val[] {
    const sf = id.getSourceFile();
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const el = bindings.elements.find((e) => e.name.text === id.text);
      if (!el) continue;
      const exported = (el.propertyName ?? el.name).text;
      const path = resolveTsModulePath(sf.fileName || this.path, stmt.moduleSpecifier.text);
      const source = path ? sourceModule(path) : undefined;
      if (!path || source === undefined) return [];
      const target = parse(path, source);
      for (const s of target.statements) {
        if (!ts.isVariableStatement(s)) continue;
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === exported && d.initializer) {
            return new TsResolver(path).eval(d.initializer, depth + 1);
          }
        }
      }
      return [];
    }
    return [];
  }
}

function propertyName(p: ts.ObjectLiteralElementLike): string | undefined {
  const n = p.name;
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return undefined;
}

/** Local names bound to a library (default/namespace import or require) and to its request functions. */
function libraryBindings(sf: ts.SourceFile, libs: Lib[]): { libByName: Map<string, Lib>; fnByName: Map<string, Lib> } {
  const libByName = new Map<string, Lib>();
  const fnByName = new Map<string, Lib>();
  const libForModule = (spec: string): Lib | undefined => libs.find((l) => l.config.modules.includes(spec));
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const lib = libForModule(stmt.moduleSpecifier.text);
    const clause = stmt.importClause;
    if (!lib || !clause) continue;
    if (clause.name) libByName.set(clause.name.text, lib);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) libByName.set(nb.name.text, lib);
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (imported === "default") libByName.set(el.name.text, lib);
        else if (lib.config.namedFunctions.includes(imported)) fnByName.set(el.name.text, lib);
      }
    }
  }
  const visitRequires = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require") {
        const arg = init.arguments[0];
        const lib = arg && ts.isStringLiteral(arg) ? libForModule(arg.text) : undefined;
        if (lib && ts.isIdentifier(node.name)) libByName.set(node.name.text, lib);
        if (lib && ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const imported = (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName : el.name) as ts.Identifier;
            if (ts.isIdentifier(el.name) && lib.config.namedFunctions.includes(imported.text)) fnByName.set(el.name.text, lib);
          }
        }
      }
    }
    ts.forEachChild(node, visitRequires);
  };
  visitRequires(sf);
  return { libByName, fnByName };
}

const bindingsCache = new WeakMap<ts.SourceFile, ReturnType<typeof libraryBindings>>();

function bindingsOf(sf: ts.SourceFile, libs: Lib[]): ReturnType<typeof libraryBindings> {
  let cached = bindingsCache.get(sf);
  if (!cached) {
    cached = libraryBindings(sf, libs);
    bindingsCache.set(sf, cached);
  }
  return cached;
}

/** Top-level `const NAME = ...` in a file. */
function topLevelConst(sf: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d;
  }
  return undefined;
}

/**
 * The expression a same-repo module exports under `exported` ("default" for the default
 * export): `export const X = ...`, `export { local as X }`, `export default local`, or
 * `export default <expression>`.
 */
function exportedExpression(sf: ts.SourceFile, exported: string): ts.Expression | undefined {
  for (const stmt of sf.statements) {
    if (exported === "default" && ts.isExportAssignment(stmt) && !stmt.isExportEquals) return stmt.expression;
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      const el = stmt.exportClause.elements.find((e) => e.name.text === exported);
      if (el) return ts.factory.createIdentifier((el.propertyName ?? el.name).text);
    }
  }
  const decl = exported !== "default" ? topLevelConst(sf, exported) : undefined;
  return decl?.initializer;
}

function instanceFor(expr: ts.Expression, sf: ts.SourceFile, libs: Lib[], depth: number): Instance | undefined {
  if (depth > 4) return undefined;
  const n = unwrap(expr);
  let init: ts.Expression | undefined;
  let home = sf;
  if (ts.isIdentifier(n)) {
    // Local binding first (synthesized identifiers from re-exports have no parent).
    const local = n.parent ? new TsResolver(sf.fileName).declarationOf(n) : topLevelConst(sf, n.text);
    if (local?.initializer) init = local.initializer;
    else {
      const imported = importedBinding(sf, n.text);
      if (!imported) return undefined;
      const path = resolveTsModulePath(sf.fileName, imported.spec);
      const source = path ? sourceModule(path) : undefined;
      if (!path || source === undefined) return undefined;
      home = parse(path, source);
      const target = exportedExpression(home, imported.exported);
      if (!target) return undefined;
      if (ts.isIdentifier(target)) return instanceFor(target, home, libs, depth + 1);
      init = target;
    }
  } else {
    init = n;
  }
  const call = unwrap(init);
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) {
    return ts.isIdentifier(call) && call !== n ? instanceFor(call, home, libs, depth + 1) : undefined;
  }
  const owner = unwrap(call.expression.expression);
  const lib = ts.isIdentifier(owner) ? bindingsOf(home, libs).libByName.get(owner.text) : undefined;
  if (!lib || !lib.config.instanceFactories.includes(call.expression.name.text)) return undefined;
  const resolver = new TsResolver(home.fileName);
  const options = call.arguments[0] ? resolver.objectLiteralOf(call.arguments[0], 0) : undefined;
  const baseProp = options?.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && lib.config.baseUrlKeys.includes(propertyName(p) ?? ""),
  );
  return { lib, ...(baseProp ? { base: baseProp.initializer } : {}) };
}

/** `import X from "./m"` / `import { Y as X } from "./m"` -> where X comes from. */
function importedBinding(sf: ts.SourceFile, local: string): { spec: string; exported: string } | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name?.text === local) return { spec: stmt.moduleSpecifier.text, exported: "default" };
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      const el = nb.elements.find((e) => e.name.text === local);
      if (el) return { spec: stmt.moduleSpecifier.text, exported: (el.propertyName ?? el.name).text };
    }
  }
  return undefined;
}

export function detectTsOutboundHttp(input: {
  filePath: string;
  content: string;
  config: UnifiedPatternConfig;
}): TsOutboundHttpResult {
  const { filePath, content, config } = input;
  const empty: TsOutboundHttpResult = { findings: [], coveredSpans: [] };
  const libs: Lib[] = config.typescript.externalApis.httpClients
    .filter((c) => c.rawHttp)
    .map((c) => ({ name: c.clientName, config: c.rawHttp! }));
  // A file may also call an instance created in another module (`import { backend } from "../lib/http"`).
  const mentionsHttp = /\bfetch\s*\(/.test(content) || libs.some((l) => l.config.modules.some((m) => content.includes(m)));
  const relativeImport = /\bfrom\s+["']\.{1,2}\//.test(content);
  if (!mentionsHttp && !relativeImport) return empty;

  let sf: ts.SourceFile;
  try {
    sf = parse(filePath, content);
  } catch {
    return empty;
  }
  const resolver = new TsResolver(filePath);
  const router = new DestinationRouter(config, [...libs.map((l) => l.name), ...libs.flatMap((l) => l.config.modules), "fetch"]);

  const { libByName, fnByName } = libraryBindings(sf, libs);

  // Instances: `const api = axios.create({ baseURL })`, here or exported by a same-repo module.
  const instanceOf = (expr: ts.Expression): Instance | undefined => instanceFor(expr, sf, libs, 0);

  const findings: RawFinding[] = [];
  const coveredSpans: TsOutboundHttpResult["coveredSpans"] = [];
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const lines = content.split(/\r?\n/);

  const urlFromArg = (arg: ts.Expression | undefined): ts.Expression | undefined => {
    if (!arg) return undefined;
    const obj = ts.isObjectLiteralExpression(unwrap(arg)) ? (unwrap(arg) as ts.ObjectLiteralExpression) : undefined;
    if (!obj) return arg;
    const urlProp = obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propertyName(p) === "url");
    return urlProp?.initializer;
  };

  const hintFor = (node: ts.Node): string => {
    const names: string[] = [filePath];
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
        names.push(n.name.text);
      }
    }
    return names.join(" ").toLowerCase();
  };

  const handle = (call: ts.CallExpression, lib: string, urlExpr: ts.Expression | undefined, base: ts.Expression | undefined): void => {
    const startLine = lineOf(call.getStart());
    const endLine = lineOf(call.getEnd());
    coveredSpans.push({ startLine, endLine });
    const urlValues = urlExpr ? resolver.eval(urlExpr) : [];
    const absolute = urlValues.filter((v) => /^(https?|wss?):\/\//i.test(v.text));
    let candidates: Val[] = absolute;
    let envOnly = urlValues.length > 0 && urlValues.every((v) => v.text.startsWith(ENV_PREFIX));
    const envNames = new Set<string>();
    const noteEnv = (values: Val[]): void => {
      for (const v of values) {
        const m = /^\{env:([^}]+)\}/.exec(v.text);
        if (m) envNames.add(m[1]);
      }
    };
    noteEnv(urlValues);
    if (candidates.length === 0 && base) {
      const bases = new TsResolver(base.getSourceFile().fileName).eval(base);
      noteEnv(bases);
      const absoluteBases = bases.filter((v) => /^(https?|wss?):\/\//i.test(v.text));
      if (absoluteBases.length > 0) {
        const rel = urlValues.length > 0 ? urlValues : [{ text: urlExpr ? `{${urlExpr.getText()}}` : "" }];
        candidates = absoluteBases.flatMap((b) => rel.map((r) => ({ text: `${b.text.replace(/\/+$/, "")}/${r.text.replace(/^\/+/, "")}` })));
      } else if (bases.length > 0 && bases.every((v) => v.text.startsWith(ENV_PREFIX))) {
        envOnly = true;
      }
    }
    const location = { filePath, startLine, endLine, code: lines[startLine - 1]?.trim() ?? "" };
    const seen = new Set<string>();
    let reported = false;
    for (const v of candidates) {
      const routed = router.route(v.text, hintFor(call), true);
      if (routed === "unknown") continue;
      if ("remote" in routed) {
        const host = routed.remote.host;
        if (seen.has(`remote:${host}`)) continue;
        seen.add(`remote:${host}`);
        reported = true;
        findings.push({
          pattern: "external_api_call",
          name: remoteServiceName(routed.remote),
          confidence: 0.85,
          location,
          properties: remoteServiceProperties(routed.remote, v.text, { client: lib, httpClientLibrary: lib }),
        });
        continue;
      }
      const name = routed.subType ? `${routed.serviceName} ${routed.subType}` : routed.serviceName;
      if (seen.has(name)) continue;
      seen.add(name);
      reported = true;
      findings.push({
        pattern: "external_api_call",
        name,
        confidence: 0.85,
        location,
        properties: {
          serviceName: routed.serviceName,
          url: v.text,
          ...(routed.subType ? { thirdPartySubType: routed.subType } : {}),
          client: lib, httpClientLibrary: lib,
        },
      });
    }
    // Outbound with no vendor: the URL or base exists only in the environment, or the URL is
    // absolute with a host the router cannot name. Same-origin relative calls stay silent.
    if (!reported && (envOnly || candidates.length > 0)) {
      // Name the remote service after the setting that holds its URL, so two env-configured
      // backends stay two API assets.
      const envVar = [...envNames].sort()[0];
      findings.push({
        pattern: "external_api_call",
        name: envVar && envOnly ? envVar : OUTBOUND_HTTP_UNKNOWN_FINDING_NAME,
        confidence: 0.8,
        location,
        properties: { client: lib, httpClientLibrary: lib, destination: "unknown", ...(envVar && envOnly ? { envVar } : {}) },
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) {
        const lib = libByName.get(callee.text);
        const fn = fnByName.get(callee.text);
        if (callee.text === "fetch" && !lib && !fn) handle(node, "fetch", urlFromArg(node.arguments[0]), undefined);
        else if (fn) handle(node, fn.name, urlFromArg(node.arguments[0]), undefined);
        else if (lib?.config.callable) handle(node, lib.name, urlFromArg(node.arguments[0]), undefined);
        else {
          const inst = instanceOf(callee);
          if (inst) handle(node, inst.lib.name, urlFromArg(node.arguments[0]), inst.base);
        }
      } else if (ts.isPropertyAccessExpression(callee) && REQUEST_VERBS.has(callee.name.text)) {
        const owner = unwrap(callee.expression);
        const lib = ts.isIdentifier(owner) ? libByName.get(owner.text) : undefined;
        if (lib) handle(node, lib.name, urlFromArg(node.arguments[0]), undefined);
        else {
          const inst = instanceOf(owner);
          if (inst) handle(node, inst.lib.name, urlFromArg(node.arguments[0]), inst.base);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  try {
    visit(sf);
  } catch {
    return empty;
  }
  return { findings, coveredSpans };
}
