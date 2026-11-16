/**
 * Control evidence on data flows (DATAP-915).
 *
 * For each evidence location of a flow, read the request window (see flow-authentication.ts)
 * and the top-level URL constants it names, and apply patterns/flow-controls.rules.yaml.
 * The flow's `endpoint`, when it is a URL, is read too. Each match records the control,
 * its effect and the line.
 *
 * No evidence means nothing was seen. It does not mean the control is missing.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import type { DetectedDataFlow, FlowControlEffect, FlowControlEvidence } from "../core/types/data-flow";
import type { FileInfo, SourceLocation } from "../core/types/file";
import {
  IMPORT_LINE,
  definitionLines,
  loadFlowAuthenticationRules,
  locationsOf,
  requestWindow,
  type FlowAuthenticationRules,
} from "./flow-authentication";

const MAX_LOCATIONS_PER_FLOW = 12;
const MAX_EVIDENCE_PER_FLOW = 8;
/** A URL constant is one line, or a short wrapped expression. */
const CONSTANT_LINES = 3;

const rulesSchema = z.object({
  version: z.number().int().positive(),
  skip_flow_types: z.array(z.string()).default([]),
  url_constant: z.string().min(1),
  comment_line: z.string().min(1),
  controls: z.array(
    z.object({
      id: z.string().min(1),
      effect: z.enum(["mitigates", "weakens"]),
      sdk: z.boolean().default(false),
      patterns: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export interface FlowControlRules {
  version: number;
  skipFlowTypes: Set<string>;
  urlConstant: RegExp;
  commentLine: RegExp;
  controls: Array<{ id: string; effect: FlowControlEffect; sdk: boolean; patterns: RegExp[] }>;
}

let cached: FlowControlRules | undefined;

function rulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const root = distIndex !== -1 ? parts.slice(0, distIndex).join(path.sep) : path.resolve(__dirname, "..", "..");
  return path.join(root, "patterns", "flow-controls.rules.yaml");
}

export function loadFlowControlRules(): FlowControlRules {
  if (cached) return cached;
  const raw = rulesSchema.parse(YAML.parse(fs.readFileSync(rulesPath(), "utf8")));
  cached = {
    version: raw.version,
    skipFlowTypes: new Set(raw.skip_flow_types),
    urlConstant: new RegExp(raw.url_constant, "g"),
    commentLine: new RegExp(raw.comment_line),
    controls: raw.controls.map((c) => ({
      id: c.id,
      effect: c.effect,
      sdk: c.sdk,
      patterns: c.patterns.map((p) => new RegExp(p)),
    })),
  };
  return cached;
}

const TRIPLE_QUOTE = /[rRbBuUfF]{0,2}("""|\'\'\')/g;
const docstringCache = new WeakMap<string[], boolean[]>();

/** For each line, whether it is part of a Python triple-quoted string. */
function docstringLines(lines: string[]): boolean[] {
  const cachedLines = docstringCache.get(lines);
  if (cachedLines) return cachedLines;
  const out = new Array<boolean>(lines.length).fill(false);
  let open: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const startsOpen = open !== undefined;
    let touched = startsOpen;
    for (const m of line.matchAll(TRIPLE_QUOTE)) {
      touched = true;
      if (open === undefined) open = m[1];
      else if (m[1] === open) open = undefined;
    }
    // A line that only assigns a triple-quoted value (x = """...) is code, not a docstring.
    const assigns = !startsOpen && /^\s*[\w.]+\s*(?::[^=]+)?=\s*[rRbBuUfF]{0,2}("""|\'\'\')/.test(line);
    out[i] = touched && !assigns;
  }
  docstringCache.set(lines, out);
  return out;
}

/** Names an import line binds: `from x import A, B as C`, `import x.y`, `import { A } from`, `const A = require(`. */
export function importedNames(line: string): string[] {
  const names = new Set<string>();
  const from = line.match(/^\s*from\s+[\w.]+\s+import\s+\(?([^)#]+)/);
  if (from) for (const part of from[1]!.split(",")) names.add(part.trim().split(/\s+as\s+/).pop()!.trim());
  const plain = line.match(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/);
  if (plain) names.add(plain[2] ?? plain[1]!.split(".")[0]!);
  const es = line.match(/^\s*import\s+(.+?)\s+from\s+["']/);
  if (es) for (const part of es[1]!.replace(/[{}*]/g, " ").split(",")) names.add(part.trim().split(/\s+as\s+/).pop()!.trim());
  const req = line.match(/^\s*const\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(/);
  if (req) for (const part of (req[1] ?? req[2]!).split(",")) names.add(part.trim().split(/\s*:\s*/).pop()!.trim());
  return [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

function evidenceForLocation(
  lines: string[],
  location: SourceLocation,
  rules: FlowControlRules,
  windowRules: FlowAuthenticationRules,
): FlowControlEvidence[] {
  const index = location.startLine - 1;
  if (index < 0 || index >= lines.length) return [];

  const sdkImport = IMPORT_LINE.test(lines[index]!);
  const read = new Set<number>();
  if (sdkImport) {
    // Read only the lines that use what the import binds, such as `client = OpenAI(timeout=20)`.
    const names = importedNames(lines[index]!);
    const uses = names.map((n) => new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`));
    for (let i = 0; i < lines.length; i += 1) {
      if (i !== index && uses.some((u) => u.test(lines[i]!))) read.add(i);
    }
  } else {
    const window = requestWindow(lines, index, windowRules);
    for (const i of window) read.add(i);
    const text = window.map((i) => lines[i]).join("\n");
    rules.urlConstant.lastIndex = 0;
    const names = new Set([...text.matchAll(rules.urlConstant)].map((m) => m[1]!));
    for (const name of names) {
      for (const i of definitionLines(lines, name, { helperLines: CONSTANT_LINES })) read.add(i);
    }
  }

  const docstring = location.filePath.endsWith(".py") ? docstringLines(lines) : undefined;
  const evidence: FlowControlEvidence[] = [];
  for (const i of [...read].sort((a, b) => a - b)) {
    const line = lines[i]!;
    if (rules.commentLine.test(line) || docstring?.[i]) continue;
    for (const control of rules.controls) {
      if (sdkImport && !control.sdk) continue;
      if (control.patterns.some((p) => p.test(line))) {
        evidence.push({ control: control.id, effect: control.effect, filePath: location.filePath, line: i + 1 });
      }
    }
  }
  return evidence;
}

/**
 * TLS or plain HTTP from the flow's `endpoint` URL. The evidence line is the first line in
 * the flow's files that contains the endpoint's scheme and host; without one, no evidence.
 */
function endpointEvidence(
  flow: DetectedDataFlow,
  linesByPath: ReadonlyMap<string, string[]>,
  rules: FlowControlRules,
): FlowControlEvidence[] {
  const endpoint = flow.endpoint;
  const origin = endpoint?.match(/^((?:https?|wss?):\/\/[^/{}?#\s]+)/i)?.[1];
  if (!endpoint || !origin) return [];
  let at: { filePath: string; line: number } | undefined;
  for (const location of locationsOf(flow).slice(0, MAX_LOCATIONS_PER_FLOW)) {
    const lines = linesByPath.get(location.filePath);
    const docstring = lines && location.filePath.endsWith(".py") ? docstringLines(lines) : undefined;
    const i =
      lines?.findIndex((l, n) => l.includes(origin) && !rules.commentLine.test(l) && !docstring?.[n]) ?? -1;
    if (i >= 0) {
      at = { filePath: location.filePath, line: i + 1 };
      break;
    }
  }
  if (!at) return [];
  const out: FlowControlEvidence[] = [];
  for (const control of rules.controls) {
    if (control.id !== "tls" && control.id !== "plaintext_http") continue;
    if (control.patterns.some((p) => p.test(endpoint))) out.push({ control: control.id, effect: control.effect, ...at });
  }
  return out;
}

function compareEvidence(a: FlowControlEvidence, b: FlowControlEvidence): number {
  return a.control.localeCompare(b.control) || a.filePath.localeCompare(b.filePath) || a.line - b.line;
}

/** Control evidence for one flow, or undefined when the flow is not checked. */
export function flowControls(
  flow: DetectedDataFlow,
  linesByPath: ReadonlyMap<string, string[]>,
  rules: FlowControlRules = loadFlowControlRules(),
  windowRules: FlowAuthenticationRules = loadFlowAuthenticationRules(),
): FlowControlEvidence[] | undefined {
  if (rules.skipFlowTypes.has(flow.type)) return undefined;
  const locations = locationsOf(flow).slice(0, MAX_LOCATIONS_PER_FLOW);
  if (locations.length === 0) return undefined;

  const seen = new Map<string, FlowControlEvidence>();
  const add = (e: FlowControlEvidence) => seen.set(`${e.control}|${e.filePath}|${e.line}`, e);
  for (const location of locations) {
    const lines = linesByPath.get(location.filePath);
    if (!lines) continue;
    for (const e of evidenceForLocation(lines, location, rules, windowRules)) add(e);
  }
  for (const e of endpointEvidence(flow, linesByPath, rules)) add(e);

  const evidence = [...seen.values()].sort(compareEvidence);
  const controls = [...new Set(evidence.map((e) => e.control))];
  // Keep at least one line for each control, then fill up to the cap.
  const kept = controls.map((c) => evidence.find((e) => e.control === c)!);
  for (const e of evidence) {
    if (kept.length >= MAX_EVIDENCE_PER_FLOW) break;
    if (!kept.includes(e)) kept.push(e);
  }
  return kept.sort(compareEvidence);
}

/** Sets `controls` on each checked flow. Mutates the flows. */
export function annotateFlowControls(flows: DetectedDataFlow[], files: FileInfo[]): void {
  if (flows.length === 0) return;
  const rules = loadFlowControlRules();
  const windowRules = loadFlowAuthenticationRules();
  const linesByPath = new Map<string, string[]>();
  for (const file of files) {
    if (typeof file.content === "string") linesByPath.set(file.path, file.content.split(/\r?\n/));
  }
  for (const flow of flows) {
    const controls = flowControls(flow, linesByPath, rules, windowRules);
    if (controls) flow.controls = controls;
    else delete flow.controls;
  }
}
