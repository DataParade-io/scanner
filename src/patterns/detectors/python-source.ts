/**
 * Small structural model of one Python source file for same-file value resolution
 * (DATAP-818): logical lines (multi-line calls joined), def/class scopes, assignments,
 * `with ... as` bindings, return statements and a tolerant expression parser.
 *
 * It is synchronous and line-agnostic on purpose: the pattern detectors run without the
 * tree-sitter engine, and the line-regex parser in `src/analyzers/python/parser.ts`
 * only sees the first call on each physical line.
 */

export interface PyNodeBase {
  /** Offsets into the file content. */
  start: number;
  end: number;
}

export type PyStrPart = string | PyExpr;

export type PyExpr =
  | (PyNodeBase & { kind: "str"; parts: PyStrPart[] })
  | (PyNodeBase & { kind: "name"; id: string })
  | (PyNodeBase & { kind: "attr"; object: PyExpr; attr: string })
  | (PyNodeBase & { kind: "call"; func: PyExpr; args: PyExpr[]; kwargs: PyKeyword[] })
  | (PyNodeBase & { kind: "binop"; op: string; left: PyExpr; right: PyExpr })
  | (PyNodeBase & { kind: "boolop"; op: "or" | "and"; values: PyExpr[] })
  | (PyNodeBase & { kind: "ifexp"; body: PyExpr; orelse: PyExpr })
  | (PyNodeBase & { kind: "tuple"; elts: PyExpr[] })
  /** List, set or dict literal; `elts` are the values (dict keys are dropped). */
  | (PyNodeBase & { kind: "coll"; elts: PyExpr[] })
  | (PyNodeBase & { kind: "subscript"; value: PyExpr })
  | (PyNodeBase & { kind: "const"; value: string })
  | (PyNodeBase & { kind: "other" });

export interface PyKeyword {
  name: string;
  value: PyExpr;
}

export interface PyParam {
  name: string;
  /** Annotation text (`ShopifyStore`, `str | None`). */
  annotation?: string;
  defaultExpr?: PyExpr;
}

export interface PyLogicalLine {
  /** Offset of the first non-blank character and the end of the statement. */
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  indent: number;
  text: string;
}

export interface PyAssignment {
  /** Plain name (`url`) or attribute target (`self._client`). */
  target: string;
  value: PyExpr;
  line: number;
  scope: PyScope;
}

export interface PyScope {
  kind: "module" | "class" | "function";
  name: string;
  parent?: PyScope;
  startLine: number;
  endLine: number;
  params: PyParam[];
  decorators: string[];
  lines: PyLogicalLine[];
  children: PyScope[];
  assignments: PyAssignment[];
  returns: PyExpr[];
}

export interface PyCall {
  node: Extract<PyExpr, { kind: "call" }>;
  /** Dotted callee (`self._client.post`), or undefined for computed callees. */
  callee?: string;
  scope: PyScope;
  startLine: number;
  endLine: number;
}

export interface PySourceModel {
  content: string;
  module: PyScope;
  calls: PyCall[];
  lineOf(offset: number): number;
  scopeAt(line: number): PyScope;
  functionsNamed(name: string): PyScope[];
  /** Imported modules (`import a.b`, `from a.b import c`) and the names bound by `from` imports. */
  imports: Array<{ module: string; names: string[]; aliases: Map<string, string> }>;
}

// ── Lexing ────────────────────────────────────────────────────────────────

interface StringSpan {
  start: number;
  end: number;
}

const STRING_PREFIX = /[rRbBuUfF]/;

/** Index just past a string literal whose opening quote is at `quoteAt`, or -1. */
function scanString(src: string, quoteAt: number): number {
  const q = src[quoteAt];
  const triple = src.startsWith(q.repeat(3), quoteAt);
  let i = quoteAt + (triple ? 3 : 1);
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (triple) {
      if (src.startsWith(q.repeat(3), i)) return i + 3;
    } else {
      if (ch === q) return i + 1;
      if (ch === "\n") return i;
    }
    i += 1;
  }
  return src.length;
}

/** Start offset of the string prefix (`f`, `rb`, ...) before a quote at `quoteAt`. */
function prefixStart(src: string, quoteAt: number): number {
  let p = quoteAt;
  while (p > 0 && quoteAt - p < 2 && STRING_PREFIX.test(src[p - 1] ?? "")) p -= 1;
  if (p < quoteAt && /[\w]/.test(src[p - 1] ?? "")) return quoteAt;
  return p;
}

function lexSpans(src: string): { strings: StringSpan[]; comments: StringSpan[] } {
  const strings: StringSpan[] = [];
  const comments: StringSpan[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "#") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      comments.push({ start: i, end });
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = scanString(src, i);
      strings.push({ start: prefixStart(src, i), end });
      i = Math.max(end, i + 1);
      continue;
    }
    i += 1;
  }
  return { strings, comments };
}

// ── Tokens and expressions ────────────────────────────────────────────────

type TokenKind = "str" | "name" | "num" | "op";

interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

const MULTI_OPS = ["**=", "//=", ">>=", "<<=", "...", "**", "//", "==", "!=", "<=", ">=", "->", ":=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>"];

/** Tokenize `src[from, to)`; offsets stay absolute. Comments are skipped. */
function tokenize(src: string, from: number, to: number): Token[] {
  const out: Token[] = [];
  let i = from;
  while (i < to) {
    const ch = src[i];
    if (ch === "#") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 || nl > to ? to : nl;
      continue;
    }
    if (/\s/.test(ch) || ch === "\\") {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < to && /\w/.test(src[j])) j += 1;
      const quote = src[j];
      if ((quote === "'" || quote === '"') && j - i <= 2 && /^[rRbBuUfF]+$/.test(src.slice(i, j))) {
        const end = Math.min(scanString(src, j), to);
        out.push({ kind: "str", text: src.slice(i, end), start: i, end });
        i = end;
        continue;
      }
      out.push({ kind: "name", text: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = Math.min(scanString(src, i), to);
      out.push({ kind: "str", text: src.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < to && /[\w.]/.test(src[j])) j += 1;
      out.push({ kind: "num", text: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    const multi = MULTI_OPS.find((op) => src.startsWith(op, i));
    const len = multi ? multi.length : 1;
    out.push({ kind: "op", text: src.slice(i, i + len), start: i, end: i + len });
    i += len;
  }
  return out;
}

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

class ParseError extends Error {}

/** Body text and flags of a string token (`f"..."` -> {f: true, body}). */
function splitStringToken(text: string): { prefix: string; body: string; bodyOffset: number } {
  let p = 0;
  while (p < text.length && text[p] !== "'" && text[p] !== '"') p += 1;
  const prefix = text.slice(0, p).toLowerCase();
  const q = text[p];
  const triple = text.startsWith(q.repeat(3), p);
  const open = triple ? 3 : 1;
  let close = open;
  if (text.length - p >= open * 2 && text.endsWith(q.repeat(open))) close = open;
  else close = 0;
  const body = text.slice(p + open, close > 0 ? text.length - close : text.length);
  return { prefix, body, bodyOffset: p + open };
}

export class PyExprParser {
  private pos = 0;

  constructor(
    private readonly src: string,
    private readonly tokens: Token[],
  ) {}

  static parseRange(src: string, from: number, to: number): PyExpr {
    const tokens = tokenize(src, from, to);
    if (tokens.length === 0) return { kind: "other", start: from, end: to };
    const parser = new PyExprParser(src, tokens);
    try {
      const expr = parser.parseExprList();
      return expr;
    } catch {
      return { kind: "other", start: from, end: to };
    }
  }

  /** Parse every call in a token range (nested calls included). */
  static callsInRange(src: string, from: number, to: number): Array<Extract<PyExpr, { kind: "call" }>> {
    const tokens = tokenize(src, from, to);
    const out: Array<Extract<PyExpr, { kind: "call" }>> = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (t.kind !== "name") continue;
      const prev = tokens[i - 1];
      if (prev && prev.kind === "op" && prev.text === ".") continue;
      // NAME (. NAME)* (
      let j = i + 1;
      while (tokens[j]?.text === "." && tokens[j + 1]?.kind === "name") j += 2;
      if (tokens[j]?.text !== "(") continue;
      const parser = new PyExprParser(src, tokens);
      parser.pos = i;
      try {
        const node = parser.parsePostfix();
        collectCalls(node, out);
      } catch {
        // Unparseable call: skip it.
      }
    }
    // Deduplicate (nested calls are reached from several starts).
    const seen = new Set<string>();
    return out.filter((c) => {
      const key = `${c.start}:${c.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ParseError("eof");
    this.pos += 1;
    return t;
  }

  private isOp(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.kind === "op" && t.text === text;
  }

  private isName(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.kind === "name" && t.text === text;
  }

  private expectOp(text: string): Token {
    const t = this.next();
    if (t.kind !== "op" || t.text !== text) throw new ParseError(`expected ${text}`);
    return t;
  }

  /** Skip a balanced bracket group starting at the current token; returns its end offset. */
  private skipGroup(): number {
    const open = this.next();
    const close = OPEN[open.text];
    let depth = 1;
    while (depth > 0) {
      const t = this.next();
      if (t.kind !== "op") continue;
      if (OPEN[t.text]) depth += 1;
      else if (t.text === ")" || t.text === "]" || t.text === "}") depth -= 1;
      if (depth === 0) {
        if (t.text !== close) throw new ParseError("mismatched");
        return t.end;
      }
    }
    return open.end;
  }

  parseExprList(): PyExpr {
    const first = this.parseExpr();
    if (!this.isOp(",")) return first;
    const elts = [first];
    while (this.isOp(",")) {
      this.next();
      if (!this.peek() || this.isOp(")") || this.isOp("]") || this.isOp("=")) break;
      elts.push(this.parseExpr());
    }
    return { kind: "tuple", elts, start: first.start, end: elts[elts.length - 1].end };
  }

  parseExpr(): PyExpr {
    if (this.isName("lambda")) {
      const start = this.next().start;
      // Lambdas never yield URLs here; consume up to the end of the enclosing argument.
      let end = start;
      while (this.peek() && !this.isOp(",") && !this.isOp(")") && !this.isOp("]") && !this.isOp("}")) {
        const t = this.peek()!;
        if (t.kind === "op" && OPEN[t.text]) end = this.skipGroup();
        else end = this.next().end;
      }
      return { kind: "other", start, end };
    }
    const body = this.parseOr();
    if (this.isName("if")) {
      this.next();
      this.parseOr();
      if (!this.isName("else")) throw new ParseError("ifexp");
      this.next();
      const orelse = this.parseExpr();
      return { kind: "ifexp", body, orelse, start: body.start, end: orelse.end };
    }
    if (this.isName("for")) {
      // Generator expression: keep the element, skip the clauses.
      let end = body.end;
      while (this.peek() && !this.isOp(",") && !this.isOp(")") && !this.isOp("]") && !this.isOp("}")) {
        const t = this.peek()!;
        if (t.kind === "op" && OPEN[t.text]) end = this.skipGroup();
        else end = this.next().end;
      }
      return { kind: "other", start: body.start, end };
    }
    return body;
  }

  private parseOr(): PyExpr {
    return this.parseBool("or", () => this.parseBool("and", () => this.parseNot()));
  }

  private parseBool(op: "or" | "and", operand: () => PyExpr): PyExpr {
    const first = operand();
    if (!this.isName(op)) return first;
    const values = [first];
    while (this.isName(op)) {
      this.next();
      values.push(operand());
    }
    return { kind: "boolop", op, values, start: first.start, end: values[values.length - 1].end };
  }

  private parseNot(): PyExpr {
    if (this.isName("not")) {
      const start = this.next().start;
      const operand = this.parseNot();
      return { kind: "other", start, end: operand.end };
    }
    return this.parseComparison();
  }

  private parseComparison(): PyExpr {
    const left = this.parseArith();
    const COMPARE = new Set(["==", "!=", "<", ">", "<=", ">=", "|", "&", "^", "<<", ">>"]);
    let end = left.end;
    let compared = false;
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === "op" && COMPARE.has(t.text)) {
        this.next();
      } else if (t.kind === "name" && (t.text === "in" || t.text === "is")) {
        this.next();
        if (this.isName("not")) this.next();
      } else if (t.kind === "name" && t.text === "not" && this.isName("in", 1)) {
        this.next();
        this.next();
      } else break;
      end = this.parseArith().end;
      compared = true;
    }
    return compared ? { kind: "other", start: left.start, end } : left;
  }

  private parseArith(): PyExpr {
    let left = this.parseTerm();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().text;
      const right = this.parseTerm();
      left = { kind: "binop", op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseTerm(): PyExpr {
    let left = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%") || this.isOp("//") || this.isOp("@")) {
      const op = this.next().text;
      const right = this.parseUnary();
      left = { kind: "binop", op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseUnary(): PyExpr {
    if (this.isOp("-") || this.isOp("+") || this.isOp("~")) {
      const start = this.next().start;
      const operand = this.parseUnary();
      return { kind: "other", start, end: operand.end };
    }
    if (this.isName("await")) {
      this.next();
      return this.parseUnary();
    }
    if (this.isOp("*") || this.isOp("**")) {
      // Star-expression inside a call or literal.
      const start = this.next().start;
      const operand = this.parseUnary();
      return { kind: "other", start, end: operand.end };
    }
    const base = this.parsePostfix();
    if (this.isOp("**")) {
      this.next();
      const exp = this.parseUnary();
      return { kind: "other", start: base.start, end: exp.end };
    }
    return base;
  }

  parsePostfix(): PyExpr {
    let node = this.parseAtom();
    for (;;) {
      if (this.isOp(".") && this.peek(1)?.kind === "name") {
        this.next();
        const name = this.next();
        node = { kind: "attr", object: node, attr: name.text, start: node.start, end: name.end };
        continue;
      }
      if (this.isOp("(")) {
        node = this.parseCallArgs(node);
        continue;
      }
      if (this.isOp("[")) {
        const end = this.skipGroup();
        node = { kind: "subscript", value: node, start: node.start, end };
        continue;
      }
      return node;
    }
  }

  /** `[a, b]`, `{a, b}` or `{k: v}`; comprehensions throw and fall back to `other`. */
  private parseCollection(): PyExpr {
    const open = this.next();
    const close = OPEN[open.text];
    const elts: PyExpr[] = [];
    while (!this.isOp(close)) {
      if (this.isOp("**")) {
        this.next();
        this.parseExpr();
      } else {
        const first = this.parseExpr();
        if (first.kind === "other" && this.isName("for", 0)) throw new ParseError("comprehension");
        if (this.isOp(":")) {
          this.next();
          elts.push(this.parseExpr());
        } else {
          elts.push(first);
        }
      }
      if (this.isName("for")) throw new ParseError("comprehension");
      if (this.isOp(",")) {
        this.next();
        continue;
      }
      if (!this.isOp(close)) throw new ParseError("collection");
    }
    const end = this.next().end;
    return { kind: "coll", elts, start: open.start, end };
  }

  private parseCallArgs(func: PyExpr): PyExpr {
    this.expectOp("(");
    const args: PyExpr[] = [];
    const kwargs: PyKeyword[] = [];
    while (!this.isOp(")")) {
      if (this.peek()?.kind === "name" && this.isOp("=", 1)) {
        const name = this.next().text;
        this.next();
        kwargs.push({ name, value: this.parseExpr() });
      } else if (this.isOp("**")) {
        this.next();
        this.parseExpr();
      } else {
        args.push(this.parseExpr());
      }
      if (this.isOp(",")) {
        this.next();
        continue;
      }
      if (!this.isOp(")")) throw new ParseError("call args");
    }
    const close = this.expectOp(")");
    return { kind: "call", func, args, kwargs, start: func.start, end: close.end };
  }

  private parseAtom(): PyExpr {
    const t = this.peek();
    if (!t) throw new ParseError("eof");
    if (t.kind === "str") {
      const parts: PyStrPart[] = [];
      const start = t.start;
      let end = t.end;
      while (this.peek()?.kind === "str") {
        const tok = this.next();
        end = tok.end;
        parts.push(...stringParts(this.src, tok));
      }
      return { kind: "str", parts: mergeStrParts(parts), start, end };
    }
    if (t.kind === "name") {
      this.next();
      if (t.text === "None" || t.text === "True" || t.text === "False") {
        return { kind: "const", value: t.text, start: t.start, end: t.end };
      }
      return { kind: "name", id: t.text, start: t.start, end: t.end };
    }
    if (t.kind === "num") {
      this.next();
      return { kind: "const", value: t.text, start: t.start, end: t.end };
    }
    if (t.text === "(") {
      const open = this.next();
      if (this.isOp(")")) {
        const close = this.next();
        return { kind: "tuple", elts: [], start: open.start, end: close.end };
      }
      const inner = this.parseExprList();
      const close = this.expectOp(")");
      return { ...inner, start: open.start, end: close.end };
    }
    if (t.text === "[" || t.text === "{") {
      const saved = this.pos;
      try {
        return this.parseCollection();
      } catch {
        this.pos = saved;
        const start = t.start;
        const end = this.skipGroup();
        return { kind: "other", start, end };
      }
    }
    throw new ParseError(`unexpected ${t.text}`);
  }
}

function collectCalls(node: PyExpr, out: Array<Extract<PyExpr, { kind: "call" }>>): void {
  switch (node.kind) {
    case "call":
      out.push(node);
      collectCalls(node.func, out);
      for (const a of node.args) collectCalls(a, out);
      for (const k of node.kwargs) collectCalls(k.value, out);
      return;
    case "attr":
      collectCalls(node.object, out);
      return;
    case "subscript":
      collectCalls(node.value, out);
      return;
    default:
      return;
  }
}

function mergeStrParts(parts: PyStrPart[]): PyStrPart[] {
  const out: PyStrPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (typeof part === "string" && typeof last === "string") out[out.length - 1] = last + part;
    else out.push(part);
  }
  return out;
}

/** Literal text and embedded expressions of one string token. */
function stringParts(src: string, tok: Token): PyStrPart[] {
  const { prefix, body, bodyOffset } = splitStringToken(tok.text);
  if (!prefix.includes("f")) return [body];
  const parts: PyStrPart[] = [];
  let literal = "";
  const base = tok.start + bodyOffset;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "{" && body[i + 1] === "{") {
      literal += "{";
      i += 2;
      continue;
    }
    if (ch === "}" && body[i + 1] === "}") {
      literal += "}";
      i += 2;
      continue;
    }
    if (ch !== "{") {
      literal += ch;
      i += 1;
      continue;
    }
    // Find the end of the replacement field and of its expression part.
    let depth = 0;
    let j = i + 1;
    let exprEnd = -1;
    let quote: string | undefined;
    for (; j < body.length; j += 1) {
      const c = body[j];
      if (quote) {
        if (c === quote) quote = undefined;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (c === "}") {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && exprEnd === -1 && (c === ":" || (c === "!" && body[j + 1] !== "="))) {
        exprEnd = j;
      }
    }
    if (exprEnd === -1) exprEnd = j;
    let exprText = body.slice(i + 1, exprEnd);
    if (exprText.trimEnd().endsWith("=")) exprText = exprText.trimEnd().slice(0, -1);
    if (literal) parts.push(literal);
    literal = "";
    parts.push(PyExprParser.parseRange(src, base + i + 1, base + i + 1 + exprText.length));
    i = j + 1;
  }
  if (literal) parts.push(literal);
  return parts;
}

// ── Model ─────────────────────────────────────────────────────────────────

function buildLineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function logicalLines(src: string, spans: { strings: StringSpan[]; comments: StringSpan[] }, starts: number[]): PyLogicalLine[] {
  const skip = [...spans.strings, ...spans.comments].sort((a, b) => a.start - b.start);
  const out: PyLogicalLine[] = [];
  let depth = 0;
  let stmtStart = -1;
  let lastCode = -1;
  let k = 0;
  const flush = (): void => {
    if (stmtStart === -1) return;
    const end = lastCode + 1;
    const startLine = lineAt(starts, stmtStart);
    const lineStart = starts[startLine - 1];
    out.push({
      start: stmtStart,
      end,
      startLine,
      endLine: lineAt(starts, Math.max(stmtStart, end - 1)),
      indent: stmtStart - lineStart,
      text: src.slice(stmtStart, end),
    });
    stmtStart = -1;
    lastCode = -1;
  };
  let i = 0;
  while (i < src.length) {
    while (k < skip.length && skip[k].end <= i) k += 1;
    const span = skip[k];
    if (span && span.start <= i && i < span.end) {
      const isComment = src[span.start] === "#";
      if (!isComment) {
        if (stmtStart === -1) stmtStart = span.start;
        lastCode = span.end - 1;
      }
      i = span.end;
      continue;
    }
    const ch = src[i];
    if (ch === "\n") {
      const continued = lastCode >= 0 && src[lastCode] === "\\";
      if (depth <= 0 && !continued) {
        depth = 0;
        flush();
      }
      i += 1;
      continue;
    }
    if (ch === ";" && depth <= 0) {
      flush();
      i += 1;
      continue;
    }
    if (!/\s/.test(ch)) {
      if (stmtStart === -1) stmtStart = i;
      lastCode = i;
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    }
    i += 1;
  }
  flush();
  return out;
}

function newScope(kind: PyScope["kind"], name: string, parent: PyScope | undefined, startLine: number): PyScope {
  return { kind, name, parent, startLine, endLine: startLine, params: [], decorators: [], lines: [], children: [], assignments: [], returns: [] };
}

/** Split `src[from, to)` at top-level commas; returns [start, end) ranges. */
function splitTopLevel(src: string, from: number, to: number, sep = ","): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tokens = tokenize(src, from, to);
  let depth = 0;
  let segStart = from;
  for (const t of tokens) {
    if (t.kind !== "op") continue;
    if (OPEN[t.text]) depth += 1;
    else if (t.text === ")" || t.text === "]" || t.text === "}") depth -= 1;
    else if (depth === 0 && t.text === sep) {
      out.push([segStart, t.start]);
      segStart = t.end;
    }
  }
  out.push([segStart, to]);
  return out.filter(([a, b]) => src.slice(a, b).trim().length > 0);
}

function parseParams(src: string, from: number, to: number): PyParam[] {
  const params: PyParam[] = [];
  for (const [a, b] of splitTopLevel(src, from, to)) {
    const tokens = tokenize(src, a, b);
    const nameTok = tokens.find((t) => t.kind === "name");
    if (!nameTok || tokens[0]?.text === "*" && tokens.length === 1) continue;
    if (tokens[0]?.kind === "op" && tokens[0].text === "/") continue;
    const eq = tokens.find((t, idx) => t.kind === "op" && t.text === "=" && idx > 0);
    const colon = tokens.find((t, idx) => t.kind === "op" && t.text === ":" && idx > 0);
    const annotation = colon ? src.slice(colon.end, eq ? eq.start : b).trim() : "";
    params.push({
      name: nameTok.text,
      ...(annotation ? { annotation } : {}),
      ...(eq ? { defaultExpr: PyExprParser.parseRange(src, eq.end, b) } : {}),
    });
  }
  return params;
}

/** First top-level `=` of an assignment statement (not `==`, `<=`, `+=` ...). */
function assignmentEquals(src: string, line: PyLogicalLine): Token | undefined {
  const tokens = tokenize(src, line.start, line.end);
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === "name" && depth === 0 && /^(if|elif|while|for|return|with|assert|lambda|def|class|import|from|del|raise|yield)$/.test(t.text)) {
      return undefined;
    }
    if (t.kind !== "op") continue;
    if (OPEN[t.text]) depth += 1;
    else if (t.text === ")" || t.text === "]" || t.text === "}") depth -= 1;
    else if (depth === 0 && t.text === "=") return t;
  }
  return undefined;
}

function targetNames(src: string, from: number, to: number): string[] {
  let text = src.slice(from, to).trim();
  // Annotated assignment `name: Type = value`.
  const annotated = /^([A-Za-z_][\w.]*)\s*:/.exec(text);
  if (annotated) return [annotated[1]];
  text = text.replace(/^[([]|[)\]]$/g, "");
  return text
    .split(",")
    .map((part) => part.trim().replace(/^\*/, ""))
    .filter((part) => /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)*$/.test(part));
}

const modelCache = new Map<string, PySourceModel>();

export function buildPySourceModel(content: string): PySourceModel {
  const cached = modelCache.get(content);
  if (cached) return cached;
  const model = buildModelUncached(content);
  modelCache.clear();
  modelCache.set(content, model);
  return model;
}

function buildModelUncached(src: string): PySourceModel {
  const starts = buildLineStarts(src);
  const spans = lexSpans(src);
  const lines = logicalLines(src, spans, starts);
  const totalLines = starts.length;
  const module = newScope("module", "<module>", undefined, 1);
  module.endLine = totalLines;

  const stack: Array<{ indent: number; scope: PyScope }> = [{ indent: -1, scope: module }];
  const allFunctions: PyScope[] = [];
  let pendingDecorators: string[] = [];

  for (const line of lines) {
    while (stack.length > 1 && line.indent <= stack[stack.length - 1].indent) {
      const closed = stack.pop()!;
      closed.scope.endLine = Math.max(closed.scope.endLine, prevEndLine(closed.scope));
    }
    const owner = stack[stack.length - 1].scope;
    owner.lines.push(line);

    if (line.text.startsWith("@")) {
      pendingDecorators.push(line.text.slice(1).trim());
      continue;
    }

    const def = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line.text);
    const cls = /^class\s+([A-Za-z_]\w*)/.exec(line.text);
    if (def) {
      const fn = newScope("function", def[1], owner, line.startLine);
      fn.decorators = pendingDecorators;
      const open = line.start + def[0].length - 1;
      const close = matchingClose(src, open, line.end);
      fn.params = parseParams(src, open + 1, close);
      fn.endLine = line.endLine;
      owner.children.push(fn);
      allFunctions.push(fn);
      stack.push({ indent: line.indent, scope: fn });
      pendingDecorators = [];
      // One-line body: `def f(): return X`.
      const colon = src.indexOf(":", close);
      if (colon !== -1 && colon < line.end - 1) {
        const rest = src.slice(colon + 1, line.end).trim();
        if (rest.startsWith("return ")) {
          const from = src.indexOf("return", colon) + "return".length;
          fn.returns.push(PyExprParser.parseRange(src, from, line.end));
        }
      }
      continue;
    }
    if (cls) {
      const scope = newScope("class", cls[1], owner, line.startLine);
      scope.decorators = pendingDecorators;
      scope.endLine = line.endLine;
      owner.children.push(scope);
      stack.push({ indent: line.indent, scope });
      pendingDecorators = [];
      continue;
    }
    pendingDecorators = [];
    indexStatement(src, line, owner);
  }
  while (stack.length > 1) {
    const closed = stack.pop()!;
    closed.scope.endLine = Math.max(closed.scope.endLine, prevEndLine(closed.scope));
  }

  const calls: PyCall[] = [];
  const scopeAt = (line: number): PyScope => innermostScope(module, line);
  for (const line of lines) {
    if (/^(?:async\s+)?def\s|^class\s|^@/.test(line.text)) {
      // Default values and decorators can hold calls, but never request calls.
      continue;
    }
    const scope = scopeAt(line.startLine);
    for (const node of PyExprParser.callsInRange(src, line.start, line.end)) {
      calls.push({
        node,
        callee: dottedName(node.func),
        scope,
        startLine: lineAt(starts, node.start),
        endLine: lineAt(starts, Math.max(node.start, node.end - 1)),
      });
    }
  }

  const imports = parseImports(lines);

  return {
    content: src,
    module,
    calls,
    imports,
    lineOf: (offset: number) => lineAt(starts, offset),
    scopeAt,
    functionsNamed: (name: string) => allFunctions.filter((fn) => fn.name === name),
  };
}

function prevEndLine(scope: PyScope): number {
  const lastLine = scope.lines[scope.lines.length - 1];
  const lastChild = scope.children[scope.children.length - 1];
  return Math.max(lastLine?.endLine ?? scope.startLine, lastChild?.endLine ?? scope.startLine);
}

function matchingClose(src: string, open: number, limit: number): number {
  const tokens = tokenize(src, open, limit);
  let depth = 0;
  for (const t of tokens) {
    if (t.kind !== "op") continue;
    if (OPEN[t.text]) depth += 1;
    else if (t.text === ")" || t.text === "]" || t.text === "}") {
      depth -= 1;
      if (depth === 0) return t.start;
    }
  }
  return limit;
}

function innermostScope(scope: PyScope, line: number): PyScope {
  for (const child of scope.children) {
    if (line > child.startLine && line <= child.endLine) return innermostScope(child, line);
    if (line === child.startLine && child.kind === "function") return scope;
  }
  return scope;
}

function indexStatement(src: string, line: PyLogicalLine, owner: PyScope): void {
  const text = line.text;
  if (/^return\b/.test(text)) {
    const from = line.start + "return".length;
    if (from < line.end) owner.returns.push(PyExprParser.parseRange(src, from, line.end));
    return;
  }
  const withMatch = /^(?:async\s+)?with\s/.exec(text);
  if (withMatch) {
    const colon = lastTopLevelColon(src, line);
    const from = line.start + withMatch[0].length;
    for (const [a, b] of splitTopLevel(src, from, colon)) {
      const segment = src.slice(a, b);
      const as = /\s+as\s+([\w.]+|\([^)]*\))\s*$/.exec(segment);
      if (!as) continue;
      const exprEnd = a + as.index;
      const value = PyExprParser.parseRange(src, a, exprEnd);
      for (const target of targetNames(src, b - as[1].length, b)) {
        owner.assignments.push({ target, value, line: line.startLine, scope: owner });
      }
    }
    return;
  }
  const eq = assignmentEquals(src, line);
  if (!eq) return;
  const value = PyExprParser.parseRange(src, eq.end, line.end);
  for (const target of targetNames(src, line.start, eq.start)) {
    owner.assignments.push({ target, value, line: line.startLine, scope: owner });
  }
}

function lastTopLevelColon(src: string, line: PyLogicalLine): number {
  const tokens = tokenize(src, line.start, line.end);
  let depth = 0;
  let last = line.end;
  for (const t of tokens) {
    if (t.kind !== "op") continue;
    if (OPEN[t.text]) depth += 1;
    else if (t.text === ")" || t.text === "]" || t.text === "}") depth -= 1;
    else if (depth === 0 && t.text === ":") last = t.start;
  }
  return last;
}

function parseImports(lines: PyLogicalLine[]): PySourceModel["imports"] {
  const out: PySourceModel["imports"] = [];
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ");
    const from = /^from ([\w.]+) import (.+)$/.exec(text);
    if (from) {
      const aliases = new Map<string, string>();
      const names: string[] = [];
      for (const raw of from[2].replace(/[()]/g, "").split(",")) {
        const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(raw);
        if (!m) continue;
        names.push(m[1]);
        aliases.set(m[2] ?? m[1], m[1]);
      }
      out.push({ module: from[1], names, aliases });
      continue;
    }
    const imp = /^import (.+)$/.exec(text);
    if (imp) {
      for (const raw of imp[1].split(",")) {
        const m = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(raw);
        if (!m) continue;
        const aliases = new Map<string, string>([[m[2] ?? m[1].split(".")[0], m[1]]]);
        out.push({ module: m[1], names: [], aliases });
      }
    }
  }
  return out;
}

/** `a.b.c` for a name/attribute chain, else undefined. */
export function dottedName(expr: PyExpr): string | undefined {
  if (expr.kind === "name") return expr.id;
  if (expr.kind === "attr") {
    const base = dottedName(expr.object);
    return base ? `${base}.${expr.attr}` : undefined;
  }
  return undefined;
}

/** Source text of an expression. */
export function exprText(model: PySourceModel, expr: PyExpr): string {
  return model.content.slice(expr.start, expr.end);
}
