import path from "path";

import { loadAnnotations, loadBenchmarkManifest } from "../../benchmark/manifest";
import { listBenchmarkRepoKeys } from "../../benchmark/run-benchmark";
import { annotationsToEvalCases } from "../../benchmark/to-eval-cases";

describe("imported corpus gold", () => {
  const repoKeys = listBenchmarkRepoKeys();

  it("ships 29 pinned packets", () => {
    expect(repoKeys).toHaveLength(29);
  });

  it("loads accepted annotations for every declared layer", () => {
    const benchmarkRoot = path.join(__dirname, "../../benchmark");
    let accepted = 0;

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const manifest = loadBenchmarkManifest(repoDir);
      expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);

      for (const layer of manifest.coverage.layers) {
        const annotations = loadAnnotations(repoDir, layer);
        const cases = annotationsToEvalCases(annotations, repoKey);
        accepted += cases.length;
        expect(annotations.length).toBeGreaterThan(0);
      }
    }

    expect(accepted).toBeGreaterThan(1000);
  });
});
