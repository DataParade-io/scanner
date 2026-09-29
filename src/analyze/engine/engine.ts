import { Language, Parser, Query } from "web-tree-sitter";
import fs from "fs";
import { AnalyzedFile, type CompiledPack } from "./analyzed-file";
import type { LanguagePack } from "./types";

interface LoadedPack extends CompiledPack {
  parser: Parser;
}

const loaded = new Map<string, LoadedPack>();
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
