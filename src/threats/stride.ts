/**
 * STRIDE per element (DATAP-914): which threat categories apply to a component or flow.
 * The table is patterns/stride.rules.yaml. Every category starts as "unknown". The status
 * rules in the same file (DATAP-915) set "mitigated" or "open" from flow control and
 * authentication evidence. No evidence never sets "open".
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import type { FlowAuthentication, FlowControlEvidence } from "../core/types/data-flow";

export type StrideElementKind = "external_entity" | "process" | "data_store" | "data_flow";
export type ThreatStatus = "unknown" | "mitigated" | "open";

/** One line of evidence behind a threat status. `control` is a control id or `auth:<kind>`. */
export interface ThreatEvidence {
  control: string;
  filePath: string;
  line: number;
}

export interface ElementThreat {
  framework: string;
  category: string;
  status: ThreatStatus;
  /** `<framework>/v<version>/<element kind>`: the table row that made the category apply. */
  ruleId: string;
  /** `<framework>/v<version>/<element kind>/<category>`: the status rule that set the status. Absent when unknown. */
  statusRuleId?: string;
  /** The evidence that set the status. Absent when unknown. */
  evidence?: ThreatEvidence[];
}

/** The flow facts that status rules read. */
export interface ThreatFlowInput {
  sourceComponentId?: string;
  targetComponentId?: string;
  authentication?: FlowAuthentication;
  controls?: FlowControlEvidence[];
}

const MAX_THREAT_EVIDENCE = 6;

const stringOrList = z.union([z.string(), z.array(z.string())]);

const rulesSchema = z.object({
  version: z.number().int().positive(),
  framework: z.string().min(1),
  categories: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1),
  elements: z.record(
    z.enum(["external_entity", "process", "data_store", "data_flow"]),
    z.object({ categories: z.array(z.string().min(1)) }),
  ),
  status_rules: z
    .partialRecord(
      z.enum(["external_entity", "process", "data_store", "data_flow"]),
      z.record(
        z.string(),
        z.object({
          mitigated_by: z.array(z.string().min(1)).default([]),
          opened_by: z.array(z.string().min(1)).default([]),
        }),
      ),
    )
    .default({}),
  component_kinds: z.array(
    z.object({
      when: z.object({ type: stringOrList.optional(), subType: stringOrList.optional() }),
      kind: z.enum(["external_entity", "process", "data_store"]),
    }),
  ),
});

export type StrideRules = z.infer<typeof rulesSchema>;

let cached: StrideRules | undefined;

function rulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const root = distIndex !== -1 ? parts.slice(0, distIndex).join(path.sep) : path.resolve(__dirname, "..", "..");
  return path.join(root, "patterns", "stride.rules.yaml");
}

export function loadStrideRules(): StrideRules {
  if (cached) return cached;
  const rules = rulesSchema.parse(YAML.parse(fs.readFileSync(rulesPath(), "utf8")));
  const known = new Set(rules.categories.map((c) => c.id));
  for (const [kind, row] of Object.entries(rules.elements)) {
    for (const c of row.categories) {
      if (!known.has(c)) throw new Error(`stride.rules.yaml: ${kind} uses unknown category ${c}`);
    }
  }
  for (const [kind, byCategory] of Object.entries(rules.status_rules)) {
    const applies = new Set(rules.elements[kind as StrideElementKind]?.categories ?? []);
    for (const c of Object.keys(byCategory ?? {})) {
      if (!applies.has(c)) throw new Error(`stride.rules.yaml: status rule ${kind}/${c} is for a category that does not apply`);
    }
  }
  cached = rules;
  return cached;
}

function matches(value: string | undefined, expected: string | string[] | undefined): boolean {
  if (expected === undefined) return true;
  if (value === undefined) return false;
  return Array.isArray(expected) ? expected.includes(value) : expected === value;
}

/** The element kind of a component; undefined when no rule matches. */
export function strideComponentKind(
  component: { type: string; subType?: string },
  rules: StrideRules = loadStrideRules(),
): StrideElementKind | undefined {
  for (const rule of rules.component_kinds) {
    if (matches(component.type, rule.when.type) && matches(component.subType, rule.when.subType)) return rule.kind;
  }
  return undefined;
}

export function strideThreatsForKind(kind: StrideElementKind, rules: StrideRules = loadStrideRules()): ElementThreat[] {
  const row = rules.elements[kind];
  if (!row) return [];
  const order = new Map(rules.categories.map((c, i) => [c.id, i]));
  return [...row.categories]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((category) => ({
      framework: rules.framework,
      category,
      status: "unknown" as const,
      ruleId: `${rules.framework}/v${rules.version}/${kind}`,
    }));
}

/** Control and authentication evidence of one flow, as threat evidence with its effect. */
function flowEvidence(flow: ThreatFlowInput): Array<ThreatEvidence & { weakens: boolean }> {
  const out: Array<ThreatEvidence & { weakens: boolean }> = [];
  for (const c of flow.controls ?? []) {
    out.push({ control: c.control, filePath: c.filePath, line: c.line, weakens: c.effect === "weakens" });
  }
  for (const a of flow.authentication?.evidence ?? []) {
    out.push({ control: `auth:${a.kind}`, filePath: a.filePath, line: a.line, weakens: false });
  }
  return out;
}

function isChecked(flow: ThreatFlowInput): boolean {
  return flow.controls !== undefined || flow.authentication !== undefined;
}

function strip(e: ThreatEvidence & { weakens?: boolean }): ThreatEvidence {
  return { control: e.control, filePath: e.filePath, line: e.line };
}

type StatusRule = { mitigated_by: string[]; opened_by: string[] };

function withStatus(
  threat: ElementThreat,
  status: ThreatStatus,
  kind: StrideElementKind,
  evidence: ThreatEvidence[],
  rules: StrideRules,
): ElementThreat {
  if (status === "unknown") return threat;
  return {
    ...threat,
    status,
    statusRuleId: `${rules.framework}/v${rules.version}/${kind}/${threat.category}`,
    evidence: evidence.slice(0, MAX_THREAT_EVIDENCE),
  };
}

/** Status of one category from one flow's evidence. */
function flowStatus(flow: ThreatFlowInput, rule: StatusRule): { status: ThreatStatus; evidence: ThreatEvidence[] } {
  const evidence = flowEvidence(flow);
  const open = evidence.filter((e) => e.weakens && rule.opened_by.includes(e.control));
  if (open.length > 0) return { status: "open", evidence: open.map(strip) };
  const mitigated = evidence.filter((e) => !e.weakens && rule.mitigated_by.includes(e.control));
  if (mitigated.length > 0) return { status: "mitigated", evidence: mitigated.map(strip) };
  return { status: "unknown", evidence: [] };
}

/**
 * Threats of a component. For an external entity, `flows` are the flows to and from it:
 * one "open" flow makes the category open; it is mitigated only when every checked flow
 * is mitigated.
 */
export function strideThreatsForComponent(
  component: { type: string; subType?: string },
  flows: ThreatFlowInput[] = [],
  rules: StrideRules = loadStrideRules(),
): ElementThreat[] {
  const kind = strideComponentKind(component, rules);
  if (!kind) return [];
  const statusRules = rules.status_rules[kind] ?? {};
  const checked = flows.filter(isChecked);
  return strideThreatsForKind(kind, rules).map((threat) => {
    const rule = statusRules[threat.category];
    if (!rule || checked.length === 0) return threat;
    const results = checked.map((f) => flowStatus(f, rule));
    const open = results.filter((r) => r.status === "open");
    if (open.length > 0) return withStatus(threat, "open", kind, open.flatMap((r) => r.evidence), rules);
    if (results.every((r) => r.status === "mitigated")) {
      // One line per flow first, so the evidence covers as many flows as the cap allows.
      const first = results.map((r) => r.evidence[0]!);
      return withStatus(threat, "mitigated", kind, first, rules);
    }
    return threat;
  });
}

/** Threats of a data flow, with statuses from its control and authentication evidence. */
export function strideThreatsForFlow(flow: ThreatFlowInput = {}, rules: StrideRules = loadStrideRules()): ElementThreat[] {
  const statusRules = rules.status_rules.data_flow ?? {};
  return strideThreatsForKind("data_flow", rules).map((threat) => {
    const rule = statusRules[threat.category];
    if (!rule) return threat;
    const { status, evidence } = flowStatus(flow, rule);
    return withStatus(threat, status, "data_flow", evidence, rules);
  });
}
