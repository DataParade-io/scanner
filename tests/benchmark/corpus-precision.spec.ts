import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "./manifest";
import { scoreCorpusPrecision } from "./precision";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../src/core/types/component";
import type { AnnotationRecord } from "./schema";
import type { LayerFinding } from "../eval/types";

const FIXTURE = "jvm-manifests-basic";
const FIXTURE_ROOT = path.join(__dirname, "..", "fixtures", FIXTURE);
const DUMMY_COMMIT = "0".repeat(40);

function componentIdentity(component: DetectedComponent): string {
  return `${component.type}:${component.name.toLowerCase()}`;
}

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
      "      exhaustive_scope_files:",
      "        - pom.xml",
      "        - services/ledger/build.gradle.kts",
      "        - src/main/resources/application.yml",
      "        - src/main/resources/bootstrap.yml",
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
      "      exhaustive_scope_files:",
      "        - pom.xml",
      "        - services/ledger/build.gradle.kts",
      "        - src/main/resources/application.yml",
      "        - src/main/resources/bootstrap.yml",
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

async function scanRepoFindings(root: string): Promise<LayerFinding[]> {
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult } = await scan(root, config);
  const findings: LayerFinding[] = [];

  for (const component of scanResult.components) {
    findings.push({
      key: componentIdentity(component),
      labels: [component.type, ...(component.subType ? [component.subType] : [])],
      sourceFilePaths: component.sourceLocations.map((l) => l.filePath),
      sourceLines: component.sourceLocations.map((l) => ({
        file_path: l.filePath,
        start_line: l.startLine,
        end_line: l.endLine,
      })),
    });
  }

  return findings;
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

  it("computes component precision from exhaustive scope annotations", async () => {
    const manifest = loadBenchmarkManifest(repoDir);
    expect(manifest.coverage.layers).toContain("components");

    const annotations = loadAnnotations(repoDir, "components");
    expect(annotations.length).toBeGreaterThan(0);
    expect(
      annotations.some((a) => a.expected.exhaustive_scope_files?.length),
    ).toBe(true);

    const findings = await scanRepoFindings(FIXTURE_ROOT);
    const report = scoreCorpusPrecision(annotations, findings);

    expect(report.precision).not.toBeNull();
    expect(report.precision as number).toBeGreaterThan(0);
    expect(report.exhaustiveScopedFindings).toBeGreaterThan(0);
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
        exhaustive_scope_files: ["pom.xml"],
      },
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-01-01T00:00:00Z",
        review_state: "accepted",
      },
    };

    const findings: LayerFinding[] = [
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
    ];

    const report = scoreCorpusPrecision([annotation], findings);

    expect(report.precision).toBe(1);
    expect(report.exhaustiveScopedFindings).toBe(1);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("returns null precision without exhaustive scope", async () => {
    const manifest = loadBenchmarkManifest(repoDir);
    const annotations = loadAnnotations(repoDir, "raw_hits").map((a) => ({
      ...a,
      expected: { ...a.expected, exhaustive_scope_files: undefined },
    }));

    const findings = await scanRepoFindings(FIXTURE_ROOT);
    const report = scoreCorpusPrecision(annotations, findings);
    expect(report.precision).toBeNull();
  });
});
