import type { AnalyzedFile } from "./engine/analyzed-file";
import type { FunctionDefinition } from "./engine/types";

/** A call argument that carries the concept, to be joined to the callee's parameter. */
export interface ConceptCallArgument {
  callee: string;
  position: number;
  keyword?: string;
}

/** A function whose parameters include the concept. */
export interface ConceptFunction {
  name: string;
  parameters: Array<{ name: string; position: number; line: number }>;
}

/**
 * Arguments of calls starting on this line that pass the concept: an identifier, a
 * member read (`user.email`), or a call whose name is the concept
 * (`order.get_customer_email()`). A concept only inside a nested call's own arguments
 * belongs to that call, and a keyword named for the concept counts too
 * (`send(email=value)`). KDATAP-c8a46a.
 */
export function conceptCallArguments(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
): ConceptCallArgument[] {
  const sites = file.sitesOnLine(line);
  const out: ConceptCallArgument[] = [];
  for (const call of file.callSitesOnLine(line)) {
    const keywordIsConcept = call.keyword !== undefined && isConceptToken(call.keyword);
    const valueIsConcept = sites.some(
      (site) =>
        site.role !== "definition" && isConceptToken(site.name) && file.isPassedBy(site.node, call.argument),
    );
    if (!keywordIsConcept && !valueIsConcept) continue;
    out.push({ callee: call.callee, position: call.position, ...(call.keyword ? { keyword: call.keyword } : {}) });
  }
  return out;
}

/** The file's functions that have at least one concept parameter, keeping only those. */
export function conceptFunctions(
  definitions: FunctionDefinition[],
  isConceptToken: (token: string) => boolean,
): ConceptFunction[] {
  return definitions
    .map((definition) => ({
      name: definition.name,
      parameters: definition.parameters.filter((parameter) => isConceptToken(parameter.name)),
    }))
    .filter((definition) => definition.parameters.length > 0);
}

/** Where a function with concept parameters is defined. */
export interface ConceptFunctionSite extends ConceptFunction {
  filePath: string;
}

/** Concept functions of the whole repository, by signal id and function name. */
export type ConceptFunctionIndex = Map<string, Map<string, ConceptFunctionSite[]>>;

export function addConceptFunctions(
  index: ConceptFunctionIndex,
  signalId: string,
  filePath: string,
  functions: ConceptFunction[],
): void {
  const byName = index.get(signalId) ?? new Map<string, ConceptFunctionSite[]>();
  index.set(signalId, byName);
  for (const definition of functions) {
    const list = byName.get(definition.name) ?? [];
    list.push({ ...definition, filePath });
    byName.set(definition.name, list);
  }
}

/**
 * Parameter declarations a call argument passes into, as `filePath:line` pairs. Only a
 * callee name with exactly one definition that has a concept parameter at the
 * argument's keyword or position resolves; an ambiguous name resolves to nothing.
 */
export function resolveCallArgument(
  index: ConceptFunctionIndex,
  signalId: string,
  argument: ConceptCallArgument,
): { filePath: string; line: number } | undefined {
  const matches: Array<{ filePath: string; line: number }> = [];
  for (const definition of index.get(signalId)?.get(argument.callee) ?? []) {
    const parameter = definition.parameters.find((candidate) =>
      argument.keyword !== undefined ? candidate.name === argument.keyword : candidate.position === argument.position,
    );
    if (parameter) matches.push({ filePath: definition.filePath, line: parameter.line });
  }
  return matches.length === 1 ? matches[0] : undefined;
}
