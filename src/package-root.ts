import fs from "fs";
import path from "path";

/**
 * Walk up from a module directory to the npm package root.
 * Skips directories named `dist` so compiled output under dist/src resolves
 * to the repository root that contains patterns/ and package.json.
 */
export function findPackageRoot(fromDir: string): string {
  let current = path.resolve(fromDir);

  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      path.basename(current) !== "dist"
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate package root from ${fromDir}`);
    }
    current = parent;
  }
}
