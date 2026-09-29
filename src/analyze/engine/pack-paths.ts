import path from "path";
import { findPackageRoot } from "../../package-root";

/** Absolute path of a pack's `queries.scm`; sources ship in the package's `src`. */
export function packQueriesFile(languageDir: string): string {
  return path.join(findPackageRoot(__dirname), "src", "analyze", "languages", languageDir, "queries.scm");
}
