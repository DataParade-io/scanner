import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  loadAnnotations,
  loadBenchmarkManifest,
  loadLayerScopes,
} from "./manifest";
import { annotationsToEvalCases } from "./to-eval-cases";
import { scanRepoByManifestLayers } from "./scan-repo";
import { scoreEvalCases } from "../eval/score";
import type { AnnotationRecord, BenchmarkLayer, LayerScopeRecord } from "./schema";
import type { EvalCase, FixtureScanResult } from "../eval/types";

const FIXTURE = "jvm-manifests-basic";
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures", FIXTURE);
const DUMMY_COMMIT = "0".repeat(40);

const JVM_SCOPE_FILES = [
  "pom.xml",
  "services/ledger/build.gradle.kts",
  "src/main/resources/application.yml",
  "src/main/resources/bootstrap.yml",
];

function writeCorpusRepo(destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(path.join(destDir, "annotations"), { recursive: true });

  fs.writeFileSync(
    path.join(destDir, "manifest.yaml"),
    [
      "repository: https://github.com/example/jvm-manifests-basic",
      `commit: "${DUMMY_COMMIT}"`,
      "license: MIT",
      "scope:",
      "  include:",
      "    - pom.xml",
      "    - services/ledger/build.gradle.kts",
      "    - src/main/resources/application.yml",
      "    - src/main/resources/bootstrap.yml",
      "coverage:",
      "  layers:",
      "    - components",
      "    - raw_hits",
      "  languages:",
      "    - yaml",
      "    - xml",
      "    - kotlin",
      "  domains:",
      "    - backend",
      "selection_rationale: Minimal JVM manifest fixture for corpus precision.",
      "annotation_version: 1",
    ].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    path.join(destDir, "layer-scopes.yaml"),
    [
      "layer_scopes:",
      "  components:",
      "    exhaustive_scope_files:",
      ...JVM_SCOPE_FILES.map((file) => `      - ${file}`),
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  raw_hits:",
      "    exhaustive_scope_files:",
      ...JVM_SCOPE_FILES.map((file) => `      - ${file}`),
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
    ].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    path.join(destDir, "annotations", "components.yaml"),
    [
      "annotations:",
      "  - id: jvm-postgresql-jdbc",
      "    layer: components",
      "    subject:",
      "      key: asset:postgresql jdbc",
      "      name: PostgreSQL JDBC",
      "    evidence:",
      "      file_path: pom.xml",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: PostgreSQL JDBC driver in pom.xml",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-spring-data-jpa",
      "    layer: components",
      "    subject:",
      "      key: asset:spring data jpa",
      "      name: Spring Data JPA",
      "    evidence:",
      "      file_path: pom.xml",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: spring-boot-starter-data-jpa in pom.xml",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-jedis",
      "    layer: components",
      "    subject:",
      "      key: asset:jedis",
      "      name: Jedis",
      "    evidence:",
      "      file_path: pom.xml",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: Jedis Redis client in pom.xml",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-mongo-datasource",
      "    layer: components",
      "    subject:",
      "      key: asset:jdbc:mongo",
      "      name: Mongo",
      "    evidence:",
      "      file_path: src/main/resources/application.yml",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: Spring mongodb uri",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-hikaricp",
      "    layer: components",
      "    subject:",
      "      key: asset:hikaricp",
      "      name: HikariCP",
      "    evidence:",
      "      file_path: services/ledger/build.gradle.kts",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: HikariCP in ledger Gradle module",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-mysql-jdbc",
      "    layer: components",
      "    subject:",
      "      key: asset:mysql jdbc",
      "      name: MySQL JDBC",
      "    evidence:",
      "      file_path: services/ledger/build.gradle.kts",
      "      start_line: 1",
      "      end_line: 1",
      "    rationale: MySQL connector in ledger Gradle module",
      "    expected:",
      "      status: positive",
      "      labels: [database]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
    ].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    path.join(destDir, "annotations", "raw_hits.yaml"),
    [
      "annotations:",
      "  - id: jvm-raw-username",
      "    layer: raw_hits",
      "    subject:",
      "      key: raw_hit:username",
      "      name: username pattern",
      "    evidence:",
      "      file_path: src/main/resources/application.yml",
      "      start_line: 6",
      "      end_line: 6",
      "    rationale: datasource username",
      "    expected:",
      "      status: positive",
      "      labels: [username]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
      "  - id: jvm-raw-password",
      "    layer: raw_hits",
      "    subject:",
      "      key: raw_hit:password",
      "      name: password pattern",
      "    evidence:",
      "      file_path: src/main/resources/application.yml",
      "      start_line: 7",
      "      end_line: 7",
      "    rationale: datasource password",
      "    expected:",
      "      status: positive",
      "      labels: [user_password]",
      "    provenance:",
      "      proposed_by: test",
      "      proposed_at: 2026-01-01T00:00:00Z",
      "      review_state: accepted",
    ].join("\n"),
    "utf8",
  );
}

function loadEvalCases(
  repoDir: string,
  fixture: string,
  layers: string[],
  layerScopes: Map<BenchmarkLayer, LayerScopeRecord>,
): EvalCase[] {
  const evalCases: EvalCase[] = [];
  for (const layer of layers) {
    const annotations = loadAnnotations(repoDir, layer);
    evalCases.push(...annotationsToEvalCases(annotations, fixture, { layerScopes }));
  }
  return evalCases;
}

describe("corpus precision end-to-end", () => {
  let tempRoot: string;
  let repoDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dp-corpus-"));
    repoDir = path.join(tempRoot, "jvm-manifests-basic");
    writeCorpusRepo(repoDir);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("computes component precision from reviewed layer scopes", async () => {
    const manifest = loadBenchmarkManifest(repoDir);
    expect(manifest.coverage.layers).toContain("components");

    const layerScopes = loadLayerScopes(repoDir);
    expect(layerScopes.get("components")?.exhaustive_scope_files.length).toBeGreaterThan(0);

    const evalCases = loadEvalCases(repoDir, FIXTURE, manifest.coverage.layers, layerScopes);
    expect(evalCases.length).toBeGreaterThan(0);

    const scanResult = await scanRepoByManifestLayers(
      FIXTURE,
      FIXTURE_ROOT,
      manifest.coverage.layers,
    );
    const report = scoreEvalCases(evalCases, [scanResult]);

    expect(report.scores.precision).not.toBeNull();
    expect(report.scores.precision as number).toBeGreaterThan(0);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);
  });

  it("does not count other-layer findings in a component exhaustive scope", () => {
    const annotation: AnnotationRecord = {
      id: "jvm-postgresql-jdbc",
      layer: "components",
      subject: { key: "asset:postgresql jdbc", name: "PostgreSQL JDBC" },
      evidence: { file_path: "pom.xml", start_line: 1, end_line: 1 },
      rationale: "PostgreSQL JDBC driver in pom.xml",
      expected: {
        status: "positive",
        labels: ["database"],
      },
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-01-01T00:00:00Z",
        review_state: "accepted",
      },
    };

    const layerScopes = loadLayerScopes(repoDir);
    layerScopes.set("components", {
      exhaustive_scope_files: ["pom.xml"],
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-01-01T00:00:00Z",
        review_state: "accepted",
      },
    });

    const evalCases = annotationsToEvalCases([annotation], FIXTURE, { layerScopes });
    const scanResult: FixtureScanResult = {
      fixture: FIXTURE,
      findings: [
        {
          key: "asset:postgresql jdbc",
          labels: ["asset", "database"],
          layer: "components",
          sourceFilePaths: ["pom.xml"],
          sourceLines: [{ file_path: "pom.xml", start_line: 1, end_line: 1 }],
        },
        {
          key: "mention:postgresql",
          labels: ["mention"],
          layer: "mentions",
          sourceFilePaths: ["pom.xml"],
          sourceLines: [{ file_path: "pom.xml", start_line: 1, end_line: 1 }],
        },
      ],
      scannedFiles: ["pom.xml"],
    };

    const report = scoreEvalCases(evalCases, [scanResult]);

    expect(report.scores.precision).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedMatches).toBe(1);
  });

  it("returns null precision without accepted exhaustive scope", async () => {
    const manifest = loadBenchmarkManifest(repoDir);
    const layerScopes = new Map<BenchmarkLayer, LayerScopeRecord>();
    const evalCases = loadEvalCases(repoDir, FIXTURE, manifest.coverage.layers, layerScopes);

    const scanResult = await scanRepoByManifestLayers(
      FIXTURE,
      FIXTURE_ROOT,
      manifest.coverage.layers,
    );
    const report = scoreEvalCases(evalCases, [scanResult]);
    expect(report.scores.precision).toBeNull();
  });
});
