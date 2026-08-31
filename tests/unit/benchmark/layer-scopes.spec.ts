import * as fs from "fs";
import * as os from "os";
import path from "path";

import { loadAnnotations, loadLayerScopes } from "../../benchmark/manifest";
import { listBenchmarkRepoKeys } from "../../benchmark/run-benchmark";

describe("layer-scopes loader", () => {
  const benchmarkRoot = path.join(__dirname, "../../benchmark");
  const giteaDir = path.join(benchmarkRoot, "repos", "gitea");

  it("loads accepted layer scopes for a corpus packet", () => {
    const scopes = loadLayerScopes(giteaDir);
    expect(scopes.get("components")?.exhaustive_scope_files).toEqual([
      "models/auth/access_token.go",
      "modules/structs/user.go",
    ]);
    expect(scopes.get("components")?.provenance.review_state).toBe("accepted");
  });

  it("merges pii_signals into mentions on load", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "layer-scopes-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "layer-scopes.yaml"),
        [
          "layer_scopes:",
          "  mentions:",
          "    exhaustive_scope_files: [a.rb]",
          "    provenance:",
          "      proposed_by: test",
          "      proposed_at: 2026-01-01T00:00:00Z",
          "      review_state: accepted",
          "  pii_signals:",
          "    exhaustive_scope_files: [b.rb]",
          "    provenance:",
          "      proposed_by: test",
          "      proposed_at: 2026-01-01T00:00:00Z",
          "      review_state: accepted",
        ].join("\n"),
        "utf8",
      );

      const scopes = loadLayerScopes(tempDir);
      expect(scopes.get("mentions")?.exhaustive_scope_files).toEqual(["a.rb", "b.rb"]);
      expect(scopes.has("pii_signals")).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects legacy exhaustive_scope_files on annotations", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "layer-scopes-"));
    try {
      fs.mkdirSync(path.join(tempDir, "annotations"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "annotations", "components.yaml"),
        [
          "annotations:",
          "  - id: bad",
          "    layer: components",
          "    subject:",
          "      key: asset:db",
          "    evidence:",
          "      file_path: app.py",
          "      start_line: 1",
          "      end_line: 1",
          "    rationale: test",
          "    expected:",
          "      status: positive",
          "      labels: []",
          "      exhaustive_scope_files: [app.py]",
          "    provenance:",
          "      proposed_by: test",
          "      proposed_at: 2026-01-01T00:00:00Z",
          "      review_state: accepted",
        ].join("\n"),
        "utf8",
      );

      expect(() => loadAnnotations(tempDir, "components")).toThrow(
        /exhaustive_scope_files is no longer supported/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads layer scopes for every corpus packet that ships them", () => {
    for (const repoKey of listBenchmarkRepoKeys()) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const scopesPath = path.join(repoDir, "layer-scopes.yaml");
      if (!fs.existsSync(scopesPath)) {
        continue;
      }
      const scopes = loadLayerScopes(repoDir);
      expect(scopes.size).toBeGreaterThan(0);
      for (const [, record] of scopes) {
        expect(record.provenance.proposed_by.length).toBeGreaterThan(0);
        expect(record.provenance.review_state).toBeDefined();
      }
    }
  });
});
