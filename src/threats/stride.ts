/**
 * STRIDE per element (DATAP-914): which threat categories apply to a component or flow.
 * The table is patterns/stride.rules.yaml. Every category starts as "unknown"; control
 * evidence (DATAP-915) sets "mitigated" or "open" later.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

export type StrideElementKind = "external_entity" | "process" | "data_store" | "data_flow";
export type ThreatStatus = "unknown" | "mitigated" | "open";

export interface ElementThreat {
  framework: string;
  category: string;
  status: ThreatStatus;
  /** `<framework>/v<version>/<element kind>`: the table row that made the category apply. */
  ruleId: string;
}

const stringOrList = z.union([z.string(), z.array(z.string())]);

const rulesSchema = z.object({
  version: z.number().int().positive(),
  framework: z.string().min(1),
  categories: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).min(1),
  elements: z.record(
    z.enum(["external_entity", "process", "data_store", "data_flow"]),
    z.object({ categories: z.array(z.string().min(1)) }),
  ),
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

export function strideThreatsForComponent(
  component: { type: string; subType?: string },
  rules: StrideRules = loadStrideRules(),
): ElementThreat[] {
  const kind = strideComponentKind(component, rules);
  return kind ? strideThreatsForKind(kind, rules) : [];
}

export function strideThreatsForFlow(rules: StrideRules = loadStrideRules()): ElementThreat[] {
  return strideThreatsForKind("data_flow", rules);
}
