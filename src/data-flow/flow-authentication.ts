/**
 * Authentication evidence on data flows (DATAP-912).
 *
 * For each evidence location of a flow, read the code around the request (the enclosing
 * function, up to a few lines after the call and never past the end of that function) and any helper function or constant that the
 * call passes as `headers=`, `auth=` and similar. Apply the patterns in
 * patterns/flow-authentication.rules.yaml. Each match records its kind and line.
 *
 * "none_seen" means no evidence was found. It does not mean the flow is unauthenticated.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import type { DetectedDataFlow, FlowAuthentication, FlowAuthenticationEvidence } from "../core/types/data-flow";
import type { FileInfo, SourceLocation } from "../core/types/file";

const MAX_LOCATIONS_PER_FLOW = 12;
const MAX_EVIDENCE_PER_FLOW = 6;

const rulesSchema = z.object({
  version: z.number(),
  window: z.object({
    max_lines_before: z.number().int().positive(),
    lines_after: z.number().int().nonnegative(),
    helper_lines: z.number().int().positive(),
  }),
  skip_flow_types: z.array(z.string()).default([]),
  credential_arguments: z.array(z.string().min(1)),
  kinds: z.array(z.object({ id: z.string().min(1), patterns: z.array(z.string().min(1)).min(1) })),
});

export interface FlowAuthenticationRules {
  version: number;
  maxLinesBefore: number;
  linesAfter: number;
  helperLines: number;
  skipFlowTypes: Set<string>;
  credentialArgument: RegExp;
  kinds: Array<{ id: string; patterns: RegExp[] }>;
}

let cached: FlowAuthenticationRules | undefined;

function rulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const root = distIndex !== -1 ? parts.slice(0, distIndex).join(path.sep) : path.resolve(__dirname, "..", "..");
  return path.join(root, "patterns", "flow-authentication.rules.yaml");
}

export function loadFlowAuthenticationRules(): FlowAuthenticationRules {
  if (cached) return cached;
  const raw = rulesSchema.parse(YAML.parse(fs.readFileSync(rulesPath(), "utf8")));
  const args = raw.credential_arguments.map((a) => a.replace(/[^A-Za-z0-9_]/g, "")).join("|");
  cached = {
    version: raw.version,
    maxLinesBefore: raw.window.max_lines_before,
    linesAfter: raw.window.lines_after,
    helperLines: raw.window.helper_lines,
    skipFlowTypes: new Set(raw.skip_flow_types),
    // `headers=_auth_headers()`, `auth=creds`, `headers: buildHeaders(token)`, `headers=self._headers`.
    credentialArgument: new RegExp(`\\b(?:${args})\\s*[=:]\\s*(?:self\\.|this\\.)?([A-Za-z_][A-Za-z0-9_]*)\\s*(\\()?`, "g"),
    kinds: raw.kinds.map((k) => ({ id: k.id, patterns: k.patterns.map((p) => new RegExp(p)) })),
  };
  return cached;
}

export const FUNCTION_START =
  /^\s*(?:@\w+.*)?(?:async\s+)?def\s+\w+\s*\(|^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b|^\s*(?:public|private|protected|static|async|\s)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$|=>\s*\{\s*$/;

export const IMPORT_LINE = /^\s*(?:from\s+[\w.]+\s+import\b|import\s+[\w.]+|import\b.*\bfrom\s+["']|const\s+\w+\s*=\s*require\()/;

/** Kinds that an SDK client takes as a constructor argument. */
const SDK_CLIENT_KINDS = new Set(["api_key", "oauth"]);

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Line indexes (0-based) of the code around one request. */
export function requestWindow(
  lines: string[],
  index: number,
  rules: Pick<FlowAuthenticationRules, "maxLinesBefore" | "linesAfter">,
): number[] {
  let start = index;
  let enclosing: number | undefined;
  const floor = Math.max(0, index - rules.maxLinesBefore);
  for (let i = index; i >= floor; i -= 1) {
    start = i;
    if (FUNCTION_START.test(lines[i] ?? "")) {
      enclosing = i;
      break;
    }
  }
  const limit = Math.min(lines.length - 1, index + rules.linesAfter);
  const end = enclosing === undefined ? nextFunctionBound(lines, index, limit) : functionEnd(lines, enclosing, index, limit);
  const out: number[] = [];
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
}

const PY_DEF = /^(\s*)(?:async\s+)?def\s/;
const DECORATOR = /^\s*@\w/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Last line before the next function definition, up to `limit`. */
function nextFunctionBound(lines: string[], index: number, limit: number): number {
  for (let i = index + 1; i <= limit; i += 1) {
    if (FUNCTION_START.test(lines[i] ?? "") || DECORATOR.test(lines[i] ?? "")) return i - 1;
  }
  return limit;
}

/** Count of `{` minus `}` on a line, ignoring string literals and line comments. */
function braceDelta(line: string): number {
  const code = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").replace(/\/\/.*$/, "");
  let delta = 0;
  for (const ch of code) {
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

/**
 * Last line of the function that starts at `start` and contains `index`, up to `limit`.
 * Python functions end at the first non-blank line indented no deeper than the `def`.
 * Brace functions end where the braces opened on the first line close.
 */
function functionEnd(lines: string[], start: number, index: number, limit: number): number {
  const py = PY_DEF.exec(lines[start] ?? "");
  if (py) {
    const defIndent = py[1]!.length;
    for (let i = index + 1; i <= limit; i += 1) {
      const line = lines[i] ?? "";
      if (line.trim() === "") continue;
      if (indentOf(line) <= defIndent) return i - 1;
    }
    return limit;
  }
  let depth = 0;
  let opened = false;
  for (let i = start; i <= limit; i += 1) {
    depth += braceDelta(lines[i] ?? "");
    if (depth > 0) opened = true;
    if (opened && depth <= 0 && i >= index) return i;
  }
  return nextFunctionBound(lines, index, limit);
}

/**
 * Line indexes of the definition of `name` elsewhere in the file: a function, or a
 * top-level constant. Local variables are already inside the request window.
 */
export function definitionLines(
  lines: string[],
  name: string,
  rules: Pick<FlowAuthenticationRules, "helperLines">,
): number[] {
  const n = escapeRegExp(name);
  const def = new RegExp(
    `^\\s*(?:async\\s+)?def\\s+${n}\\s*\\(|^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(|^(?:export\\s+)?(?:const|let|var)\\s+${n}\\b|^${n}\\s*(?::[^=]+)?=[^=]`,
  );
  for (let i = 0; i < lines.length; i += 1) {
    if (!def.test(lines[i]!)) continue;
    const out: number[] = [];
    for (let j = i; j < Math.min(lines.length, i + rules.helperLines); j += 1) out.push(j);
    return out;
  }
  return [];
}

function evidenceForLocation(
  lines: string[],
  location: SourceLocation,
  rules: FlowAuthenticationRules,
): FlowAuthenticationEvidence[] {
  const index = location.startLine - 1;
  if (index < 0 || index >= lines.length) return [];
  const window = requestWindow(lines, index, rules);
  const read = new Set(window);

  const windowText = window.map((i) => lines[i]).join("\n");
  rules.credentialArgument.lastIndex = 0;
  for (const match of windowText.matchAll(rules.credentialArgument)) {
    const name = match[1]!;
    // A name assigned inside the window is a local; its value is already read.
    const local = new RegExp(`^\\s*${escapeRegExp(name)}\\s*(?::[^=]+)?=[^=]`);
    if (window.some((i) => local.test(lines[i]!))) continue;
    for (const i of definitionLines(lines, name, rules)) read.add(i);
  }

  // SDK flows cite the import. The credentials go to the client built in the same file,
  // so read the file, but keep only the kinds an SDK client takes.
  const sdkImport = IMPORT_LINE.test(lines[index]!);
  if (sdkImport) for (let i = 0; i < lines.length; i += 1) read.add(i);

  const evidence: FlowAuthenticationEvidence[] = [];
  for (const i of [...read].sort((a, b) => a - b)) {
    const line = lines[i]!;
    for (const kind of rules.kinds) {
      if (sdkImport && !SDK_CLIENT_KINDS.has(kind.id)) continue;
      if (kind.patterns.some((p) => p.test(line))) {
        evidence.push({ kind: kind.id, filePath: location.filePath, line: i + 1 });
      }
    }
  }
  return evidence;
}

export function locationsOf(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) return flow.sourceLocations;
  return flow.sourceLocation ? [flow.sourceLocation] : [];
}

/** Authentication evidence for one flow, or undefined when the flow is not checked. */
export function flowAuthentication(
  flow: DetectedDataFlow,
  linesByPath: ReadonlyMap<string, string[]>,
  rules: FlowAuthenticationRules = loadFlowAuthenticationRules(),
): FlowAuthentication | undefined {
  if (rules.skipFlowTypes.has(flow.type)) return undefined;
  const locations = locationsOf(flow).slice(0, MAX_LOCATIONS_PER_FLOW);
  if (locations.length === 0) return undefined;

  const seen = new Map<string, FlowAuthenticationEvidence>();
  for (const location of locations) {
    const lines = linesByPath.get(location.filePath);
    if (!lines) continue;
    for (const e of evidenceForLocation(lines, location, rules)) {
      seen.set(`${e.kind}|${e.filePath}|${e.line}`, e);
    }
  }
  const evidence = [...seen.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.filePath.localeCompare(b.filePath) || a.line - b.line,
  );
  const kinds = [...new Set(evidence.map((e) => e.kind))].sort();
  if (kinds.length === 0) return { status: "none_seen", kinds: [], evidence: [] };
  // Keep at least one line for each kind, then fill up to the cap.
  const kept: FlowAuthenticationEvidence[] = kinds.map((k) => evidence.find((e) => e.kind === k)!);
  for (const e of evidence) {
    if (kept.length >= MAX_EVIDENCE_PER_FLOW) break;
    if (!kept.includes(e)) kept.push(e);
  }
  kept.sort((a, b) => a.kind.localeCompare(b.kind) || a.filePath.localeCompare(b.filePath) || a.line - b.line);
  return { status: "seen", kinds, evidence: kept };
}

/** Sets `authentication` on each checked flow. Mutates the flows. */
export function annotateFlowAuthentication(flows: DetectedDataFlow[], files: FileInfo[]): void {
  if (flows.length === 0) return;
  const rules = loadFlowAuthenticationRules();
  const linesByPath = new Map<string, string[]>();
  for (const file of files) {
    if (typeof file.content === "string") linesByPath.set(file.path, file.content.split(/\r?\n/));
  }
  for (const flow of flows) {
    const auth = flowAuthentication(flow, linesByPath, rules);
    if (auth) flow.authentication = auth;
    else delete flow.authentication;
  }
}
