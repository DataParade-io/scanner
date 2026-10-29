import { collectRepoDeclaredDomains } from "./repo-declared-domains";
import type { FileInfo } from "../../core/types/file";

/**
 * The Python, TypeScript and JavaScript files of the scan, by repo-relative path, while
 * analyzers run. Detectors use it to follow same-repo imports (`from .settings import
 * settings`, `import { X } from "./settings"`) when they resolve a value (DATAP-818).
 * Outside a scan the index is empty and resolution stays in one file.
 */
let activeIndex: ReadonlyMap<string, string> | undefined;
let activeDeclaredDomains: readonly string[] = [];
let generation = 0;

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function runWithPythonModuleIndex<T>(files: readonly FileInfo[], fn: () => T): T {
  const prev = activeIndex;
  const index = new Map<string, string>();
  for (const file of files) {
    if (file.language === "python" || file.language === "typescript" || file.language === "javascript" || /\.(py|[cm]?[jt]sx?)$/.test(file.path)) {
      index.set(normalize(file.path), file.content);
    }
  }
  const prevDomains = activeDeclaredDomains;
  activeIndex = index;
  activeDeclaredDomains = collectRepoDeclaredDomains(files);
  generation += 1;
  try {
    return fn();
  } finally {
    activeIndex = prev;
    activeDeclaredDomains = prevDomains;
    generation += 1;
  }
}

/** Domains the scanned repository declares as its own (see repo-declared-domains.ts). */
export function repoDeclaredDomains(): readonly string[] {
  return activeDeclaredDomains;
}

/** Changes whenever the active index changes, for cache keys. */
export function pythonModuleIndexGeneration(): number {
  return generation;
}

export function pythonModuleIndexSize(): number {
  if (!activeIndex) return 0;
  let n = 0;
  for (const key of activeIndex.keys()) if (key.endsWith(".py")) n += 1;
  return n;
}

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

/** Repo-relative file of a relative TS/JS import (`./settings`, `../lib/http`), seen from `fromFile`. */
export function resolveTsModulePath(fromFile: string, spec: string): string | undefined {
  if (!activeIndex || !spec.startsWith(".")) return undefined;
  const parts = dirname(normalize(fromFile)).split("/").filter(Boolean);
  for (const segment of spec.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const base = parts.join("/");
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  const candidates = [base, ...TS_EXTENSIONS.map((e) => `${stem}${e}`), ...TS_EXTENSIONS.map((e) => `${base}/index${e}`)];
  return candidates.find((p) => activeIndex!.has(p));
}

export function sourceModule(filePath: string): string | undefined {
  return activeIndex?.get(normalize(filePath));
}

export function pythonModuleSource(filePath: string): string | undefined {
  return activeIndex?.get(normalize(filePath));
}

function dirname(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

function join(dir: string, rel: string): string {
  return dir ? `${dir}/${rel}` : rel;
}

/**
 * Repo-relative file of an imported module, seen from `fromFile`: relative imports
 * (`.settings`, `..pkg.mod`) resolve from the importing file's package; absolute imports
 * (`app.settings`) match a path suffix, preferring the file nearest to the importer.
 */
export function resolvePythonModulePath(fromFile: string, moduleSpec: string): string | undefined {
  if (!activeIndex) return undefined;
  const from = normalize(fromFile);
  const dots = /^\.*/.exec(moduleSpec)?.[0].length ?? 0;
  const parts = moduleSpec.slice(dots).split(".").filter(Boolean);
  const candidates = (base: string): string[] => {
    const rel = parts.join("/");
    return rel ? [join(base, `${rel}.py`), join(base, `${rel}/__init__.py`)] : [join(base, "__init__.py")];
  };
  if (dots > 0) {
    let dir = dirname(from);
    for (let i = 1; i < dots; i += 1) dir = dirname(dir);
    return candidates(dir).find((p) => activeIndex!.has(p));
  }
  if (parts.length === 0) return undefined;
  const suffixes = candidates("");
  let best: { path: string; shared: number } | undefined;
  for (const path of activeIndex.keys()) {
    if (!suffixes.some((s) => path === s || path.endsWith(`/${s}`))) continue;
    const shared = sharedPrefix(path, from);
    if (!best || shared > best.shared) best = { path, shared };
  }
  return best?.path;
}

function sharedPrefix(a: string, b: string): number {
  const x = a.split("/");
  const y = b.split("/");
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return n;
}
