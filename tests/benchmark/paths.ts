import path from "path";

import { findPackageRoot } from "../../src/package-root";

export { findPackageRoot };

/** Benchmark metadata and cache live under tests/benchmark, not dist/. */
export function resolveDefaultBenchmarkRoot(moduleDir: string = __dirname): string {
  return path.join(findPackageRoot(moduleDir), "tests", "benchmark");
}
