/**
 * Code-structure graph from graphify (KDATAP-49ff82).
 *
 * graphify (https://github.com/Graphify-Labs/graphify, PyPI `graphifyy`, Apache-2.0)
 * parses a codebase with tree-sitter into a NetworkX node-link `graph.json`: files,
 * classes, functions, module-level constants, and `calls` / `imports` / `contains`
 * edges. The scanner runs it as a subprocess during a scan, code-only (no LLM, no
 * API key), and links its own privacy and security layer to those nodes
 * (`src/graph/`). A missing or failing graphify is a scan warning, never a failure.
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/** Versions whose graph.json shape this module was written against. */
export const GRAPHIFY_SUPPORTED_VERSION = { min: "0.9.73", belowMajorMinor: "0.10" } as const;

export interface GraphifyNode {
  id: string;
  label: string;
  file_type: string;
  source_file?: string | null;
  /** `L<line>`, 1-based. */
  source_location?: string | null;
  [attribute: string]: unknown;
}

export interface GraphifyLink {
  source: string;
  target: string;
  relation: string;
  confidence?: string;
  confidence_score?: number;
  source_file?: string | null;
  source_location?: string | null;
  [attribute: string]: unknown;
}

export interface GraphifyGraph {
  directed: boolean;
  multigraph: boolean;
  graph: Record<string, unknown>;
  nodes: GraphifyNode[];
  links: GraphifyLink[];
  built_at_commit?: string | null;
}

export interface StructureGraphConfig {
  /** Run graphify during the scan. Default: true when a graphify command is found. */
  enabled?: boolean;
  /**
   * Command to run, split on spaces (`graphify`, `python -m graphify`, a venv path).
   * Default: `DATAPARADE_GRAPHIFY_COMMAND`, then `graphify`.
   */
  command?: string;
  /** Directory graphify writes `graphify-out/` into. Default: a temporary directory. */
  outDir?: string;
  timeoutMs?: number;
}

export interface StructureGraphInfo {
  tool: "graphify";
  version: string;
  /** Absolute path of the written graph.json. */
  path: string;
  builtAtCommit?: string;
  nodeCount: number;
  linkCount: number;
}

export interface StructureGraphOutcome {
  info?: StructureGraphInfo;
  graph?: GraphifyGraph;
  warnings: string[];
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/).filter((part) => part.length > 0);
  return [parts[0] ?? "graphify", parts.slice(1)];
}

export function resolveGraphifyCommand(config: StructureGraphConfig = {}): string {
  return config.command ?? process.env.DATAPARADE_GRAPHIFY_COMMAND ?? "graphify";
}

function run(
  command: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  const [file, prefix] = splitCommand(command);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...prefix, ...args],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          GRAPHIFY_NO_TIPS: "1",
          GRAPHIFY_NO_AUTO_REFRESH: "1",
          GRAPHIFY_VIZ_NODE_LIMIT: "0",
        },
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr }));
        else resolve({ stdout, stderr });
      },
    );
  });
}

/** `graphify 0.9.73` -> `0.9.73`, or undefined. */
export function parseGraphifyVersion(output: string): string | undefined {
  return /graphify\s+v?(\d+\.\d+\.\d+)/i.exec(output)?.[1];
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when the version is in the range this module was written against. */
export function isSupportedGraphifyVersion(version: string): boolean {
  return (
    compareVersions(version, GRAPHIFY_SUPPORTED_VERSION.min) >= 0 &&
    compareVersions(version, `${GRAPHIFY_SUPPORTED_VERSION.belowMajorMinor}.0`) < 0
  );
}

/**
 * Read a graphify graph.json. Accepts `links` (the default) or `edges` (written with
 * `--no-cluster`).
 */
export function loadGraphifyGraph(graphPath: string): GraphifyGraph {
  const raw = JSON.parse(fs.readFileSync(graphPath, "utf8")) as Record<string, unknown>;
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as GraphifyNode[]) : [];
  const linksRaw = Array.isArray(raw.links) ? raw.links : Array.isArray(raw.edges) ? raw.edges : [];
  return {
    directed: raw.directed === true,
    multigraph: raw.multigraph === true,
    graph: typeof raw.graph === "object" && raw.graph !== null ? (raw.graph as Record<string, unknown>) : {},
    nodes,
    links: linksRaw as GraphifyLink[],
    built_at_commit: typeof raw.built_at_commit === "string" ? raw.built_at_commit : null,
  };
}

/**
 * Run `graphify extract <scanRoot> --code-only --out <outDir>` and load the result.
 * Never throws: problems come back as warnings.
 */
export async function runGraphify(
  scanRoot: string,
  config: StructureGraphConfig = {},
): Promise<StructureGraphOutcome> {
  const warnings: string[] = [];
  if (config.enabled === false) return { warnings };
  const command = resolveGraphifyCommand(config);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let version: string | undefined;
  try {
    const { stdout, stderr } = await run(command, ["--version"], 60_000);
    version = parseGraphifyVersion(`${stdout}\n${stderr}`);
  } catch {
    if (config.enabled === true || config.command !== undefined) {
      warnings.push(`structure graph skipped: graphify command '${command}' is not available`);
    }
    return { warnings };
  }
  if (!version) {
    warnings.push(`structure graph skipped: could not read the graphify version from '${command} --version'`);
    return { warnings };
  }
  if (!isSupportedGraphifyVersion(version)) {
    warnings.push(
      `graphify ${version} is outside the supported range ` +
        `>=${GRAPHIFY_SUPPORTED_VERSION.min} <${GRAPHIFY_SUPPORTED_VERSION.belowMajorMinor}; graph.json may differ`,
    );
  }

  const outDir = config.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "dataparade-graphify-"));
  fs.mkdirSync(outDir, { recursive: true });
  try {
    await run(command, ["extract", path.resolve(scanRoot), "--code-only", "--out", path.resolve(outDir)], timeoutMs, outDir);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    warnings.push(`structure graph skipped: graphify extract failed (${(stderr.trim().split("\n").pop() ?? String(error)).slice(0, 300)})`);
    return { warnings };
  }

  const graphPath = path.join(path.resolve(outDir), "graphify-out", "graph.json");
  if (!fs.existsSync(graphPath)) {
    warnings.push(`structure graph skipped: graphify wrote no graph.json at ${graphPath}`);
    return { warnings };
  }
  const graph = loadGraphifyGraph(graphPath);
  return {
    graph,
    info: {
      tool: "graphify",
      version,
      path: graphPath,
      ...(graph.built_at_commit ? { builtAtCommit: graph.built_at_commit } : {}),
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
    },
    warnings,
  };
}
