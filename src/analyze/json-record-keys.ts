import type { AnalyzedFile } from "./engine/analyzed-file";
import type { ColumnCandidate } from "./column-catalog";
import type { KeyFlow, ParameterSink } from "./engine/types";

/**
 * Keys written into JSON record columns (KDATAP-fb8019). A dict or object literal that
 * flows, within two hops, into a JSON field of a model gets one column per key,
 * `<Model>.<json_field>.<key>`: `Model.objects.create(parameters={"k": v})` writes
 * `Model.parameters.k`, and so does an event factory `def make(parameters): Model.objects
 * .create(parameters=parameters)` called as `make(parameters={"k": v})`. Such a key is its
 * own data item, whatever the key shares with columns that hold the same kind of value.
 * The JSON fields come from the column catalog; they are not columns of any concept.
 */

/** A key whose object literal reaches a call, by file and 1-based line. */
export interface KeyFlowFact {
  file: string;
  line: number;
  key: string;
  flow: KeyFlow;
}

export interface RecordFacts {
  keyFlows: KeyFlowFact[];
  sinks: Array<ParameterSink & { file: string }>;
}

/** Facts of one analyzed file: keys that flow into calls, and parameters that do. */
export function recordFacts(analyzed: AnalyzedFile, filePath: string): RecordFacts {
  const keyFlows: KeyFlowFact[] = [];
  for (const key of analyzed.keyDeclarations()) {
    if (key.flow) keyFlows.push({ file: filePath, line: key.line, key: key.name, flow: key.flow });
  }
  const sinks = analyzed.parameterSinks().map((sink) => ({ ...sink, file: filePath }));
  return { keyFlows, sinks };
}

const JSON_TYPE = /^(?:json|jsonb|jsonfield|jsonbfield)$/i;

/** Model name to its JSON fields, from the column catalog's candidates. */
export function jsonFieldIndex(candidates: readonly ColumnCandidate[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.type || !JSON_TYPE.test(candidate.type.replace(/^.*\./, ""))) continue;
    for (const owner of new Set([candidate.model, candidate.table])) {
      if (!owner) continue;
      const fields = index.get(owner) ?? new Set<string>();
      fields.add(candidate.column);
      index.set(owner, fields);
    }
  }
  return index;
}

/**
 * The record column of each key, as `file:line` to `{ key: "Model.field.key" }`. A flow
 * reaches a model when its call is on the model (`Model.objects.create`) or constructs it
 * (`Model(...)`) with a keyword that is one of the model's JSON fields. Otherwise the call
 * must be to the one function of that name that passes the argument on to such a call.
 */
export function recordKeyColumns(facts: RecordFacts, candidates: readonly ColumnCandidate[]): Map<string, Record<string, string>> {
  const fields = jsonFieldIndex(candidates);
  const out = new Map<string, Record<string, string>>();
  if (fields.size === 0) return out;
  const modelField = (model: string | undefined, callee: string, keyword: string | undefined): string | undefined => {
    if (!keyword) return undefined;
    for (const name of [model, callee]) if (name && fields.get(name)?.has(keyword)) return `${name}.${keyword}`;
    return undefined;
  };
  const sinksByFunction = new Map<string, Array<ParameterSink & { file: string }>>();
  for (const sink of facts.sinks) {
    const list = sinksByFunction.get(sink.function) ?? [];
    list.push(sink);
    sinksByFunction.set(sink.function, list);
  }
  for (const { file, line, key, flow } of facts.keyFlows) {
    let column = modelField(flow.receiverClass, flow.callee, flow.keyword);
    if (!column) {
      // Through a function: it must be unique by name, and its parameter (by keyword or
      // position) must be passed on to a model's JSON field.
      const candidates = sinksByFunction.get(flow.callee) ?? [];
      const functions = new Set(candidates.map((sink) => `${sink.file}:${sink.owner ?? ""}`));
      if (functions.size === 1) {
        const sink = candidates.find((c) => (flow.keyword !== undefined ? c.param === flow.keyword : c.position === flow.position) && modelField(c.receiverClass, c.callee, c.keyword));
        if (sink) column = modelField(sink.receiverClass, sink.callee, sink.keyword);
      }
    }
    if (!column) continue;
    const at = `${file}:${line}`;
    out.set(at, { ...(out.get(at) ?? {}), [key]: `${column}.${key}` });
  }
  return out;
}
