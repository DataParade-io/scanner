import { Language, Parser, Query, type Node } from "web-tree-sitter";
import fs from "fs";
import { AnalyzedFile, type CompiledPack } from "./analyzed-file";
import type { LanguagePack } from "./types";

interface LoadedPack extends CompiledPack {
  parser: Parser;
}

const loaded = new Map<string, LoadedPack>();

/**
 * Grammars loaded for parsing only, with no analysis pack (KDATAP-fded10): the column
 * catalog reads JPA entities and Go structs from their trees without the engine analyzing
 * those languages, so detection and grouping do not change for them.
 */
const PARSE_ONLY_GRAMMARS = { java: "tree-sitter-wasms/out/tree-sitter-java.wasm", go: "tree-sitter-wasms/out/tree-sitter-go.wasm" } as const;
export type ParseOnlyGrammar = keyof typeof PARSE_ONLY_GRAMMARS;
const parseOnly = new Map<ParseOnlyGrammar, Parser>();
let initPromise: Promise<void> | undefined;
let ready = false;

/**
 * Load the WASM runtime and the grammars of the given packs, once. Everything after
 * this is synchronous. Safe to call repeatedly and concurrently.
 */
export function initAnalysisEngine(packs: readonly LanguagePack[]): Promise<void> {
  initPromise ??= (async () => {
    await Parser.init();
    for (const pack of packs) {
      // Bytes, not a path: web-tree-sitter reads paths with a dynamic import that Jest's VM rejects.
      const language = await Language.load(fs.readFileSync(require.resolve(pack.grammarWasm)));
      const parser = new Parser();
      parser.setLanguage(language);
      const query = new Query(language, fs.readFileSync(pack.queriesFile, "utf8"));
      loaded.set(pack.id, { pack, query, parser });
    }
    for (const [id, wasm] of Object.entries(PARSE_ONLY_GRAMMARS) as Array<[ParseOnlyGrammar, string]>) {
      const parser = new Parser();
      parser.setLanguage(await Language.load(fs.readFileSync(require.resolve(wasm))));
      parseOnly.set(id, parser);
    }
    ready = true;
  })();
  return initPromise;
}

export function isAnalysisEngineReady(): boolean {
  return ready;
}

/**
 * Parse a file with a pack. Returns undefined when the engine is not initialized, the
 * pack is unknown, or the parser fails: callers treat that as "no analysis".
 */
export function analyzeSource(pack: LanguagePack, source: string): AnalyzedFile | undefined {
  const entry = loaded.get(pack.id);
  if (!ready || !entry) return undefined;
  try {
    const tree = entry.parser.parse(source);
    return tree ? new AnalyzedFile(tree, entry) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse with a parse-only grammar and hand the tree to `read`, freeing it after. Returns
 * undefined when the engine is not initialized or the parse fails.
 */
export function withParseTree<T>(grammar: ParseOnlyGrammar, source: string, read: (root: Node) => T): T | undefined {
  const parser = parseOnly.get(grammar);
  if (!ready || !parser) return undefined;
  let tree;
  try {
    tree = parser.parse(source);
    return tree ? read(tree.rootNode) : undefined;
  } catch {
    return undefined;
  } finally {
    tree?.delete();
  }
}
