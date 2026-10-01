/**
 * Find the graphify node that encloses a line of code (KDATAP-a528cd).
 *
 * graphify records only where a node starts (`source_location: "L<n>"`), not where it
 * ends, so spans come from the scanner's own tree-sitter engine: the enclosing function
 * or class of a line, with its start line. The graphify node is then matched on file,
 * label (`name()` for functions, `.name()` for methods, a plain name for classes and
 * module-level constants) and start line. A line inside no function, class or constant
 * resolves to the file node.
 */
import type { AnalyzedFile } from "../analyze/engine/analyzed-file";
import type { GraphifyGraph, GraphifyNode } from "../structure/graphify";

export type StructureNodeKind = "function" | "method" | "class" | "const" | "file";

export interface StructureMatch {
  id: string;
  kind: StructureNodeKind;
  /** File and start line of the matched node, for re-resolving if ids change. */
  file: string;
  line: number;
}

interface IndexedNode {
  id: string;
  label: string;
  line: number;
}

function nodeLine(node: GraphifyNode): number | undefined {
  const match = /^L(\d+)$/.exec(String(node.source_location ?? ""));
  return match ? Number(match[1]) : undefined;
}

export class StructureIndex {
  private readonly byFile = new Map<string, IndexedNode[]>();
  private readonly fileNodes = new Map<string, string>();

  constructor(graph: GraphifyGraph) {
    const containsFrom = new Set(graph.links.filter((link) => link.relation === "contains").map((link) => link.source));
    for (const node of graph.nodes) {
      if (typeof node.source_file !== "string" || node.source_file.length === 0) continue;
      const line = nodeLine(node);
      if (line === undefined) continue;
      const file = node.source_file;
      const basename = file.split("/").pop();
      if (node.label === basename && line === 1 && (containsFrom.has(node.id) || !this.fileNodes.has(file))) {
        this.fileNodes.set(file, node.id);
        continue;
      }
      const list = this.byFile.get(file) ?? [];
      list.push({ id: node.id, label: node.label, line });
      this.byFile.set(file, list);
    }
  }

  fileNode(file: string): StructureMatch | undefined {
    const id = this.fileNodes.get(file);
    return id ? { id, kind: "file", file, line: 1 } : undefined;
  }

  private find(file: string, labels: string[], line: number): IndexedNode | undefined {
    const candidates = (this.byFile.get(file) ?? []).filter((node) => labels.includes(node.label));
    // Decorators and multi-line signatures can put graphify's start a line or two off
    // the engine's; prefer an exact match, then the nearest within three lines.
    return (
      candidates.find((node) => node.line === line) ??
      candidates
        .filter((node) => Math.abs(node.line - line) <= 3)
        .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0]
    );
  }

  /**
   * The graphify node enclosing a 1-based line: the innermost function or method, else
   * the class, else a module-level constant defined on that line, else the file.
   */
  resolve(file: string, line: number, analyzed?: AnalyzedFile, column = 0): StructureMatch | undefined {
    if (analyzed) {
      const fn = analyzed.enclosingFunction(line, column);
      if (fn?.name) {
        const node = this.find(file, [`${fn.name}()`, `.${fn.name}()`], fn.startLine);
        if (node) return { id: node.id, kind: node.label.startsWith(".") ? "method" : "function", file, line: node.line };
      }
      const cls = analyzed.enclosingClass(line, column);
      if (cls?.name) {
        const node = this.find(file, [cls.name], cls.startLine);
        if (node) return { id: node.id, kind: "class", file, line: node.line };
      }
    }
    const constant = (this.byFile.get(file) ?? []).find(
      (node) => node.line === line && !node.label.endsWith("()"),
    );
    if (constant) return { id: constant.id, kind: "const", file, line };
    return this.fileNode(file);
  }
}
