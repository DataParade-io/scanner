/**
 * The DataParade knowledge-graph file (KDATAP-a528cd).
 *
 * graphify's `graph.json` describes how the code is built. This file adds what the code
 * does with sensitive data: occurrences, data items and their groups, components, and
 * data flows. It uses the same NetworkX node-link format, and its bridge edges point at
 * graphify node ids, so an app (or NetworkX `compose`) loads both files as one
 * connected graph. Every edge carries evidence (`source_file`, `source_location`) and a
 * graphify-style confidence: EXTRACTED when the code states it, INFERRED when the
 * scanner deduced it.
 *
 * OCSF discoveries remain the stored records; this graph is a projection of a scan.
 */
import fs from "fs";
import path from "path";

import { analyzeSource, initAnalysisEngine, isAnalysisEngineReady } from "../analyze/engine/engine";
import type { AnalyzedFile } from "../analyze/engine/analyzed-file";
import { LANGUAGE_PACKS, packForFile } from "../analyze/languages";
import type { OrchestratorScanResult } from "../core/pipeline/orchestrator-result";
import type { FileInfo, SourceLocation } from "../core/types";
import { loadGraphifyGraph, type GraphifyGraph, type StructureGraphInfo } from "../structure/graphify";
import { StructureIndex, type StructureMatch } from "./structure-index";

export const DATAPARADE_GRAPH_SCHEMA = "dataparade-graph/1";
export const DATAPARADE_GRAPH_FILE = "dataparade-graph.json";
/** Id prefix for DataParade nodes, like graphify's own `repo::` prefixes in merge-graphs. */
export const DP_PREFIX = "dp::";

export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface DataParadeNode {
  id: string;
  label: string;
  /** graphify's node file type; DataParade nodes are concepts. */
  file_type: "concept";
  /** DataParade's kind: occurrence, data_item, data_item_group, component, data_flow. */
  dp_kind: "occurrence" | "data_item" | "data_item_group" | "component" | "data_flow";
  source_file: string | null;
  source_location: string | null;
  [attribute: string]: unknown;
}

export interface DataParadeLink {
  source: string;
  target: string;
  relation: string;
  confidence: Confidence;
  confidence_score: number;
  source_file: string | null;
  source_location: string | null;
  [attribute: string]: unknown;
}

export interface DataParadeGraph {
  directed: true;
  multigraph: false;
  graph: {
    schema: typeof DATAPARADE_GRAPH_SCHEMA;
    structure?: { tool: "graphify"; version: string; built_at_commit?: string; graph_file: string };
  };
  nodes: DataParadeNode[];
  links: DataParadeLink[];
}

/** Confidence of the edge from an occurrence to its group, by the evidence that named it. */
const GROUP_BASIS_CONFIDENCE: Record<string, [Confidence, number]> = {
  declaration: ["EXTRACTED", 1],
  location: ["EXTRACTED", 1],
  name: ["INFERRED", 0.85],
  "receiver-vote": ["INFERRED", 0.85],
  "table-vote": ["INFERRED", 0.75],
  "weak-name": ["INFERRED", 0.75],
  "file-vote": ["INFERRED", 0.65],
};

const at = (line: number | undefined): string | null => (line === undefined ? null : `L${line}`);

function conceptOf(occurrenceId: string): string {
  return occurrenceId.split(":")[1] ?? "";
}

function firstColumn(content: string, line: number): number {
  const text = content.split(/\r?\n/)[line - 1] ?? "";
  return text.length - text.trimStart().length;
}

export interface BuildDataParadeGraphOptions {
  /** graphify's graph for the same scan root; loaded from `result.structureGraph.path` when omitted. */
  structure?: GraphifyGraph;
}

/**
 * Build the DataParade graph for an enriched scan result. Bridge edges to graphify are
 * added when a structure graph is available.
 */
export async function buildDataParadeGraph(
  result: OrchestratorScanResult,
  options: BuildDataParadeGraphOptions = {},
): Promise<DataParadeGraph> {
  const info: StructureGraphInfo | undefined = result.structureGraph;
  const structure =
    options.structure ?? (info && fs.existsSync(info.path) ? loadGraphifyGraph(info.path) : undefined);
  const index = structure ? new StructureIndex(structure) : undefined;

  const nodes = new Map<string, DataParadeNode>();
  const links: DataParadeLink[] = [];
  const linkKeys = new Set<string>();
  const addNode = (node: DataParadeNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addLink = (link: DataParadeLink): void => {
    const key = `${link.source}\u0000${link.target}\u0000${link.relation}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push(link);
  };

  // Parse files lazily, once, for enclosing spans.
  const filesByPath = new Map<string, FileInfo>(result.files.map((file) => [file.path, file]));
  const analyzedByPath = new Map<string, AnalyzedFile | undefined>();
  if (index && !isAnalysisEngineReady()) {
    try {
      await initAnalysisEngine(LANGUAGE_PACKS);
    } catch {
      // Without the engine, occurrences resolve to constants on their line or the file node.
    }
  }
  const analyzedFor = (filePath: string): AnalyzedFile | undefined => {
    if (analyzedByPath.has(filePath)) return analyzedByPath.get(filePath);
    const file = filesByPath.get(filePath);
    const pack = file && isAnalysisEngineReady() ? packForFile(file.language, file.path) : undefined;
    const analyzed = pack && file ? analyzeSource(pack, file.content) : undefined;
    analyzedByPath.set(filePath, analyzed);
    return analyzed;
  };
  const resolve = (filePath: string, line: number): StructureMatch | undefined => {
    if (!index) return undefined;
    const content = filesByPath.get(filePath)?.content ?? "";
    return index.resolve(filePath, line, analyzedFor(filePath), firstColumn(content, line));
  };
  const bridge = (from: string, relation: string, location: SourceLocation | undefined): void => {
    if (!location) return;
    const match = resolve(location.filePath, location.startLine);
    if (!match) return;
    addLink({
      source: from,
      target: match.id,
      relation,
      confidence: "EXTRACTED",
      confidence_score: 1,
      source_file: location.filePath,
      source_location: at(location.startLine),
      target_kind: match.kind,
      target_file: match.file,
      target_line: match.line,
    });
  };

  // Data items and their groups.
  for (const item of result.dataItems) {
    const itemId = `${DP_PREFIX}${item.id}`;
    addNode({
      id: itemId,
      label: item.id.replace(/^data_item:/, ""),
      file_type: "concept",
      dp_kind: "data_item",
      source_file: null,
      source_location: null,
      labels: item.labels,
      occurrence_count: item.occurrenceIds.length,
    });
    for (const group of item.groups ?? []) {
      const groupId = `${DP_PREFIX}group:${group.id}`;
      addNode({
        id: groupId,
        label: group.id,
        file_type: "concept",
        dp_kind: "data_item_group",
        source_file: null,
        source_location: null,
        occurrence_count: group.occurrenceIds.length,
      });
      addLink({
        source: groupId,
        target: itemId,
        relation: "part_of",
        confidence: "EXTRACTED",
        confidence_score: 1,
        source_file: null,
        source_location: null,
      });
    }
  }

  // Occurrences.
  const occurrenceIds = new Set(result.occurrences.map((occurrence) => occurrence.id));
  for (const occurrence of result.occurrences) {
    const id = `${DP_PREFIX}${occurrence.id}`;
    const concept = conceptOf(occurrence.id);
    addNode({
      id,
      label: `${concept} @ ${occurrence.filePath}:${occurrence.startLine}`,
      file_type: "concept",
      dp_kind: "occurrence",
      source_file: occurrence.filePath,
      source_location: at(occurrence.startLine),
      end_line: occurrence.endLine,
      labels: occurrence.labels,
      location: occurrence.location ?? "code",
      ...(occurrence.code !== undefined ? { code: occurrence.code } : {}),
      ...(occurrence.group ? { group: occurrence.group, group_basis: occurrence.groupBasis ?? null } : {}),
      ...(occurrence.declaration ? { declaration: occurrence.declaration } : {}),
    });

    const evidence = { source_file: occurrence.filePath, source_location: at(occurrence.startLine) };
    const itemId = `${DP_PREFIX}data_item:${concept}`;
    if (occurrence.group && nodes.has(`${DP_PREFIX}group:${occurrence.group}`)) {
      const [confidence, score] = GROUP_BASIS_CONFIDENCE[occurrence.groupBasis ?? "name"] ?? ["INFERRED", 0.65];
      addLink({
        source: id,
        target: `${DP_PREFIX}group:${occurrence.group}`,
        relation: "occurrence_of",
        confidence,
        confidence_score: score,
        basis: occurrence.groupBasis ?? null,
        ...evidence,
      });
    } else if (nodes.has(itemId)) {
      addLink({
        source: id,
        target: itemId,
        relation: "occurrence_of",
        confidence: occurrence.location === "comment" ? "AMBIGUOUS" : "EXTRACTED",
        confidence_score: occurrence.location === "comment" ? 0.5 : 1,
        ...evidence,
      });
    }

    if (occurrence.declaration && occurrence.declaration !== "unresolved") {
      const declaring = `occurrence:${concept}:${occurrence.filePath}:${occurrence.declaration.line}`;
      if (declaring !== occurrence.id && occurrenceIds.has(declaring)) {
        addLink({
          source: id,
          target: `${DP_PREFIX}${declaring}`,
          relation: "declared_by",
          confidence: "EXTRACTED",
          confidence_score: 1,
          declaration_kind: occurrence.declaration.kind,
          ...evidence,
        });
      }
    }

    bridge(id, "occurs_in", { filePath: occurrence.filePath, startLine: occurrence.startLine, endLine: occurrence.endLine });
  }

  // Components.
  const components = result.scanResult.components;
  const componentName = new Map(components.map((component) => [component.id, component.name]));
  const filesWithGroups = new Map<string, Set<string>>();
  for (const occurrence of result.occurrences) {
    if (!occurrence.group) continue;
    const set = filesWithGroups.get(occurrence.filePath) ?? new Set<string>();
    set.add(occurrence.group);
    filesWithGroups.set(occurrence.filePath, set);
  }
  for (const component of components) {
    const id = `${DP_PREFIX}${component.id}`;
    const first = component.sourceLocations[0];
    addNode({
      id,
      label: component.name,
      file_type: "concept",
      dp_kind: "component",
      source_file: first?.filePath ?? null,
      source_location: at(first?.startLine),
      component_type: component.type,
      ...(component.subType ? { sub_type: component.subType } : {}),
      confidence_score: component.confidence,
    });
    for (const location of component.sourceLocations) {
      bridge(id, "defined_in", location);
      // A data item group with occurrences in a file where the component is detected:
      // the component plausibly handles it.
      for (const group of filesWithGroups.get(location.filePath) ?? []) {
        addLink({
          source: `${DP_PREFIX}group:${group}`,
          target: id,
          relation: "handled_by",
          confidence: "INFERRED",
          confidence_score: 0.65,
          basis: "same_file",
          source_file: location.filePath,
          source_location: at(location.startLine),
        });
      }
    }
  }

  // Data flows, as nodes so several flows between the same components stay distinct.
  const itemByConcept = new Map(result.dataItems.map((item) => [item.id.replace(/^data_item:/, ""), item]));
  for (const flow of result.scanResult.dataFlows) {
    const id = `${DP_PREFIX}${flow.id}`;
    const locations = flow.sourceLocations ?? (flow.sourceLocation ? [flow.sourceLocation] : []);
    const first = locations[0];
    addNode({
      id,
      label: `${componentName.get(flow.sourceComponentId) ?? flow.sourceComponentId} -> ${componentName.get(flow.targetComponentId) ?? flow.targetComponentId}`,
      file_type: "concept",
      dp_kind: "data_flow",
      source_file: first?.filePath ?? null,
      source_location: at(first?.startLine),
      flow_type: flow.type,
      confidence_score: flow.confidence,
      ...(flow.targetScope ? { target_scope: flow.targetScope } : {}),
      ...(flow.dataCategories ? { data_categories: flow.dataCategories } : {}),
    });
    const flowEvidence = { source_file: first?.filePath ?? null, source_location: at(first?.startLine) };
    addLink({
      source: `${DP_PREFIX}${flow.sourceComponentId}`,
      target: id,
      relation: "sends",
      confidence: flow.confidence >= 0.8 ? "EXTRACTED" : "INFERRED",
      confidence_score: flow.confidence,
      ...flowEvidence,
    });
    addLink({
      source: id,
      target: `${DP_PREFIX}${flow.targetComponentId}`,
      relation: "delivers_to",
      confidence: flow.confidence >= 0.8 ? "EXTRACTED" : "INFERRED",
      confidence_score: flow.confidence,
      ...flowEvidence,
    });
    for (const category of flow.dataCategories ?? []) {
      const item = itemByConcept.get(category);
      if (!item) continue;
      addLink({
        source: id,
        target: `${DP_PREFIX}${item.id}`,
        relation: "carries",
        confidence: "INFERRED",
        confidence_score: 0.75,
        basis: "data_category",
        ...flowEvidence,
      });
    }
    for (const location of locations) bridge(id, "observed_in", location);
  }

  for (const analyzed of analyzedByPath.values()) analyzed?.dispose();

  // Keep only links whose DataParade endpoints exist; bridge targets are graphify ids.
  const isOurs = (nodeId: string): boolean => nodeId.startsWith(DP_PREFIX);
  const keptLinks = links.filter(
    (link) => (!isOurs(link.source) || nodes.has(link.source)) && (!isOurs(link.target) || nodes.has(link.target)),
  );

  return {
    directed: true,
    multigraph: false,
    graph: {
      schema: DATAPARADE_GRAPH_SCHEMA,
      ...(info
        ? {
            structure: {
              tool: "graphify" as const,
              version: info.version,
              ...(info.builtAtCommit ? { built_at_commit: info.builtAtCommit } : {}),
              graph_file: "graphify-out/graph.json",
            },
          }
        : {}),
    },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    links: keptLinks.sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.relation.localeCompare(b.relation),
    ),
  };
}

/**
 * Write `dataparade-graph.json` into `outDir`, next to `graphify-out/graph.json` (copied
 * there from the scan's structure graph when it was written elsewhere). Returns the
 * paths written.
 */
export async function writeKnowledgeGraph(
  result: OrchestratorScanResult,
  outDir: string,
  options: BuildDataParadeGraphOptions = {},
): Promise<{ dataparadeGraph: string; structureGraph?: string }> {
  fs.mkdirSync(outDir, { recursive: true });
  const graph = await buildDataParadeGraph(result, options);
  const dataparadeGraph = path.join(outDir, DATAPARADE_GRAPH_FILE);
  fs.writeFileSync(dataparadeGraph, `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  let structureGraph: string | undefined;
  if (result.structureGraph && fs.existsSync(result.structureGraph.path)) {
    structureGraph = path.join(outDir, "graphify-out", "graph.json");
    if (path.resolve(result.structureGraph.path) !== path.resolve(structureGraph)) {
      fs.mkdirSync(path.dirname(structureGraph), { recursive: true });
      fs.copyFileSync(result.structureGraph.path, structureGraph);
    }
  }
  return { dataparadeGraph, ...(structureGraph ? { structureGraph } : {}) };
}
