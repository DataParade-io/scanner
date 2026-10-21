import { z } from "zod";

import vocabulary from "./vocabulary.json";

/**
 * Agent output format (DATAP-749): `facts.json`, components and data flows only.
 * Vocabularies come from vocabulary.json (interim, replaced by the DATAP-740 ontology export).
 */

const evidenceSchema = z
  .object({
    filePath: z
      .string()
      .min(1)
      .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
        message: "filePath must be relative to the repository root, with no leading '/' or '..'",
      }),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .strict()
  .refine((e) => e.endLine >= e.startLine, { message: "endLine must be >= startLine" });

const evidenceList = z.array(evidenceSchema).min(1, "at least one evidence span is required");

const componentTypes = vocabulary.componentTypes as [string, ...string[]];
const flowTypes = vocabulary.flowTypes as [string, ...string[]];
const subTypesByType = vocabulary.componentSubTypes as Record<string, string[]>;

const componentSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(componentTypes),
    subType: z.string().min(1),
    evidence: evidenceList,
  })
  .strict()
  .superRefine((component, ctx) => {
    const allowed = subTypesByType[component.type] ?? [];
    if (!allowed.includes(component.subType)) {
      ctx.addIssue({
        code: "custom",
        path: ["subType"],
        message: `subType '${component.subType}' is not allowed for type '${component.type}'. Allowed: ${allowed.join(", ")}`,
      });
    }
  });

const dataFlowSchema = z
  .object({
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.enum(flowTypes),
    evidence: evidenceList,
  })
  .strict();

export const factsSchema = z
  .object({
    schemaVersion: z.literal(1),
    components: z.array(componentSchema),
    dataFlows: z.array(dataFlowSchema),
  })
  .strict()
  .superRefine((facts, ctx) => {
    const names = new Set<string>();
    facts.components.forEach((component, index) => {
      if (names.has(component.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["components", index, "name"],
          message: `duplicate component name '${component.name}'; names must be unique`,
        });
      }
      names.add(component.name);
    });
    facts.dataFlows.forEach((flow, index) => {
      for (const end of ["source", "target"] as const) {
        if (!names.has(flow[end])) {
          ctx.addIssue({
            code: "custom",
            path: ["dataFlows", index, end],
            message: `${end} '${flow[end]}' is not the name of any component in this file`,
          });
        }
      }
    });
  });

export type Facts = z.infer<typeof factsSchema>;
export type FactsComponent = Facts["components"][number];
export type FactsDataFlow = Facts["dataFlows"][number];
export type FactsEvidence = z.infer<typeof evidenceSchema>;
