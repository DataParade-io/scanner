#!/usr/bin/env node
/**
 * Run a real scanner recall evaluation against the curated corpus and
 * persist an Evaluation record in local Plexus GraphQL (Virtuus).
 *
 * Usage:
 *   pnpm exec ts-node scripts/run-corpus-eval.ts \
 *     --corpus-dir /path/to/tests/benchmark \
 *     --graphql-url http://127.0.0.1:8000
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  importGoldAnnotations,
  shouldImportAnnotation,
} from "./import-gold-annotations";
import {
  buildLocalGraphqlChildEnv,
  requireGraphqlProxyDir,
  resolvePlexusCli,
} from "../features/steps/plexus-runtime";
import {
  loadAnnotations,
  loadBenchmarkManifest,
} from "../tests/benchmark/manifest";
import type { AnnotationRecord } from "../tests/benchmark/schema";
import { scoreCorpusPrecision } from "../tests/benchmark/precision";
import type { LayerFinding } from "../tests/eval/types";
import {
  createDefaultScanConfiguration,
  scan,
} from "../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../src/core/types/component";
import type { DetectedDataFlow } from "../src/core/types/data-flow";
import { collectPersonalDataFindings } from "../src/eval-layers/collect-personal-data-findings";

const ACCOUNT_ID = "local-eval";
const ACCOUNT_KEY = "local-eval";
const SCORECARD_NAME = "Scanner Recall";
const SCORE_NAME = "Span Overlap";
const SCORECARD_ID = "scanner-recall-scorecard";
const SECTION_ID = "scanner-recall-section";
const SCORE_ID = "scanner-recall-span-overlap";

const repoRoot = join(__dirname, "..");
const startScript = join(repoRoot, "scripts", "start-local-graphql.sh");

interface GraphQlItemRef {
  id: string;
  externalId?: string | null;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function listRepoDirs(corpusDir: string): string[] {
  const reposRoot = join(corpusDir, "repos");
  return readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(reposRoot, entry.name))
    .sort();
}

function cacheDirFor(
  corpusDir: string,
  repoKey: string,
  commit: string,
): string {
  return join(corpusDir, ".cache", "repos", `${repoKey}@${commit}`);
}

function stageScopedSources(
  corpusDir: string,
  workDir: string,
): Map<string, string> {
  const stagedByKey = new Map<string, string>();

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const manifest = loadBenchmarkManifest(repoDir);
    const cacheDir = cacheDirFor(corpusDir, repoKey, manifest.commit);
    if (!existsSync(cacheDir)) {
      throw new Error(
        `Materialized clone missing for ${repoKey} at ${cacheDir}. Run benchmark:materialize first.`,
      );
    }

    const stagedRoot = join(workDir, "sources", repoKey);
    mkdirSync(stagedRoot, { recursive: true });

    for (const includePath of manifest.scope.include) {
      const from = join(cacheDir, includePath);
      const to = join(stagedRoot, includePath);
      if (!existsSync(from)) {
        throw new Error(`Scope path missing in clone ${repoKey}: ${includePath}`);
      }
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: statSync(from).isDirectory() });
    }

    stagedByKey.set(repoKey, stagedRoot);
  }

  return stagedByKey;
}

function writeDatasetCsv(
  corpusDir: string,
  stagedByKey: Map<string, string>,
  datasetPath: string,
): { rows: number; skipped: number } {
  const lines = [`text,${csvEscape(SCORE_NAME)},content_id,metadata`];
  let rows = 0;
  let skipped = 0;

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const manifest = loadBenchmarkManifest(repoDir);
    const sourceRoot = stagedByKey.get(repoKey);
    if (!sourceRoot) {
      throw new Error(`No staged source root for ${repoKey}`);
    }

    for (const layer of manifest.coverage.layers) {
      const annotations = loadAnnotations(repoDir, layer);
      for (const annotation of annotations) {
        if (!shouldImportAnnotation(annotation)) {
          skipped += 1;
          continue;
        }
        const text = annotation.subject.name
          ? `${annotation.subject.name}: ${annotation.rationale}`
          : annotation.rationale;
        const metadata = {
          groundTruth: "Yes",
          repository: manifest.repository,
          commit: manifest.commit,
          filePath: annotation.evidence.file_path,
          startLine: annotation.evidence.start_line,
          endLine: annotation.evidence.end_line,
          sourceRoot,
          annotationId: annotation.id,
          repoKey,
          layer: annotation.layer,
          reviewState: annotation.provenance.review_state,
        };
        lines.push(
          [
            csvEscape(text),
            csvEscape("Yes"),
            csvEscape(annotation.id),
            csvEscape(JSON.stringify(metadata)),
          ].join(","),
        );
        rows += 1;
      }
    }
  }

  writeFileSync(datasetPath, `${lines.join("\n")}\n`, "utf8");
  return { rows, skipped };
}

function writeScorecardYaml(workDir: string): void {
  const scoreDir = join(workDir, "scorecards", SCORECARD_NAME);
  mkdirSync(scoreDir, { recursive: true });
  writeFileSync(
    join(scoreDir, `${SCORE_NAME}.yaml`),
    [
      `name: ${SCORE_NAME}`,
      `id: ${SCORE_ID}`,
      `key: span-overlap`,
      `class: SourceSpanOverlapScore`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function componentIdentity(component: DetectedComponent): string {
  return `${component.type}:${component.name.toLowerCase()}`;
}

async function computeCorpusPrecision(
  corpusDir: string,
  stagedByKey: Map<string, string>,
): Promise<Record<string, unknown>> {
  const perRepo: Record<string, unknown> = {};
  let totalScoped = 0;
  let totalMatched = 0;

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const sourceRoot = stagedByKey.get(repoKey);
    if (!sourceRoot) continue;

    const manifest = loadBenchmarkManifest(repoDir);
    const allAnnotations: AnnotationRecord[] = [];
    for (const layer of manifest.coverage.layers) {
      allAnnotations.push(...loadAnnotations(repoDir, layer));
    }

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(sourceRoot, config);
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

    const componentsById = new Map(
      scanResult.components.map((c) => [c.id, c]),
    );
    for (const flow of scanResult.dataFlows) {
      const source = componentsById.get(flow.sourceComponentId);
      const target = componentsById.get(flow.targetComponentId);
      const sourceKey = source ? componentIdentity(source) : flow.sourceComponentId;
      const targetKey = target ? componentIdentity(target) : flow.targetComponentId;
      const locations = flow.sourceLocations?.length
        ? flow.sourceLocations
        : flow.sourceLocation
          ? [flow.sourceLocation]
          : [];
      findings.push({
        key: `flow:${sourceKey}->${targetKey}`,
        labels: [flow.type],
        sourceFilePaths: [...new Set(locations.map((l) => l.filePath))],
        sourceLines: locations.map((l) => ({
          file_path: l.filePath,
          start_line: l.startLine,
          end_line: l.endLine,
        })),
      });
    }

    for (const layer of ["raw-hits", "mentions", "data-items"] as const) {
      const payload = await collectPersonalDataFindings(sourceRoot, layer);
      for (const f of payload.findings) {
        findings.push({
          key: f.subjectKey,
          labels: f.labels,
          sourceFilePaths: [f.filePath],
          sourceLines: [{ file_path: f.filePath, start_line: f.startLine, end_line: f.endLine }],
        });
      }
    }

    const report = scoreCorpusPrecision(allAnnotations, findings);
    perRepo[repoKey] = report;
    totalScoped += report.exhaustiveScopedFindings;
    totalMatched += report.exhaustiveScopedMatches;
  }

  return {
    perRepo,
    aggregate: {
      precision: totalScoped === 0 ? null : totalMatched / totalScoped,
      exhaustiveScopedFindings: totalScoped,
      exhaustiveScopedMatches: totalMatched,
    },
  };
}

function annotationToScoringRecord(annotation: AnnotationRecord): Record<string, unknown> {
  return {
    file_path: annotation.evidence.file_path,
    start_line: annotation.evidence.start_line,
    end_line: annotation.evidence.end_line,
    expected: { status: annotation.expected.status, labels: annotation.expected.labels },
  };
}

function findingToScoringRecord(finding: LayerFinding): Record<string, unknown> {
  const loc = finding.sourceLines[0];
  return {
    filePath: loc?.file_path ?? "",
    startLine: loc?.start_line ?? 0,
    endLine: loc?.end_line ?? 0,
  };
}

function scoreRecallViaPlexus(
  annotations: AnnotationRecord[],
  findings: LayerFinding[],
): Record<string, unknown> {
  const payload = JSON.stringify({
    annotations: annotations.map(annotationToScoringRecord),
    findings: findings.map(findingToScoringRecord),
  });
  const scriptPath = join(repoRoot, "scripts", "score-corpus-recall.py");
  const plexusRoot = process.env.PLEXUS_ROOT || join(repoRoot, "..", "Plexus");
  const result = spawnSync("python3", [scriptPath], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: plexusRoot },
  });
  if (result.status !== 0) {
    throw new Error(`score-corpus-recall.py failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

async function computeCorpusRecallProgrammatic(
  corpusDir: string,
  stagedByKey: Map<string, string>,
): Promise<Record<string, unknown>> {
  const perRepo: Record<string, unknown> = {};
  let totalTp = 0;
  let totalFp = 0;
  let totalTn = 0;
  let totalFn = 0;

  for (const repoDir of listRepoDirs(corpusDir)) {
    const repoKey = repoDir.split("/").pop()!;
    const sourceRoot = stagedByKey.get(repoKey);
    if (!sourceRoot) continue;

    const manifest = loadBenchmarkManifest(repoDir);
    const allAnnotations: AnnotationRecord[] = [];
    for (const layer of manifest.coverage.layers) {
      allAnnotations.push(...loadAnnotations(repoDir, layer));
    }

    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(sourceRoot, config);
    const findings: LayerFinding[] = [];

    for (const component of scanResult.components) {
      findings.push({
        key: componentIdentity(component),
        labels: [component.type, ...(component.subType ? [component.subType] : [])],
        sourceFilePaths: component.sourceLocations.map((l) => l.filePath),
        sourceLines: component.sourceLocations.map((l) => ({
          file_path: l.filePath, start_line: l.startLine, end_line: l.endLine,
        })),
      });
    }

    const componentsById = new Map(scanResult.components.map((c) => [c.id, c]));
    for (const flow of scanResult.dataFlows) {
      const source = componentsById.get(flow.sourceComponentId);
      const target = componentsById.get(flow.targetComponentId);
      const sourceKey = source ? componentIdentity(source) : flow.sourceComponentId;
      const targetKey = target ? componentIdentity(target) : flow.targetComponentId;
      const locations = flow.sourceLocations?.length
        ? flow.sourceLocations
        : flow.sourceLocation
          ? [flow.sourceLocation]
          : [];
      findings.push({
        key: `flow:${sourceKey}->${targetKey}`,
        labels: [flow.type],
        sourceFilePaths: [...new Set(locations.map((l) => l.filePath))],
        sourceLines: locations.map((l) => ({
          file_path: l.filePath, start_line: l.startLine, end_line: l.endLine,
        })),
      });
    }

    for (const layer of ["raw-hits", "mentions", "data-items"] as const) {
      const p = await collectPersonalDataFindings(sourceRoot, layer);
      for (const f of p.findings) {
        findings.push({
          key: f.subjectKey,
          labels: f.labels,
          sourceFilePaths: [f.filePath],
          sourceLines: [{ file_path: f.filePath, start_line: f.startLine, end_line: f.endLine }],
        });
      }
    }

    const report = scoreRecallViaPlexus(allAnnotations, findings);
    perRepo[repoKey] = report;
    totalTp += report.true_positives as number;
    totalFp += report.false_positives as number;
    totalTn += report.true_negatives as number;
    totalFn += report.false_negatives as number;
  }

  const total = totalTp + totalFp + totalTn + totalFn;
  return {
    perRepo,
    aggregate: {
      accuracy: total === 0 ? null : (totalTp + totalTn) / total,
      recall: totalTp + totalFn === 0 ? null : totalTp / (totalTp + totalFn),
      precision: totalTp + totalFp === 0 ? null : totalTp / (totalTp + totalFp),
      true_positives: totalTp,
      false_positives: totalFp,
      true_negatives: totalTn,
      false_negatives: totalFn,
    },
  };
}

async function graphqlRequest(
  graphqlUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${graphqlUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status !== 200) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) {
    throw new Error("GraphQL response missing data");
  }
  return payload.data;
}

async function seedMetadata(graphqlUrl: string): Promise<void> {
  const existingAccount = await graphqlRequest(
    graphqlUrl,
    `query GetAccount($id: ID!) { getAccount(id: $id) { id key } }`,
    { id: ACCOUNT_ID },
  );
  if (!(existingAccount.getAccount as { id?: string } | null)?.id) {
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateAccount($input: CreateAccountInput!) {
        createAccount(input: $input) { id key }
      }`,
      {
        input: {
          id: ACCOUNT_ID,
          key: ACCOUNT_KEY,
          name: "Scanner Recall Account",
        },
      },
    );
  }

  const existingScorecard = await graphqlRequest(
    graphqlUrl,
    `query GetScorecard($id: ID!) { getScorecard(id: $id) { id name } }`,
    { id: SCORECARD_ID },
  );
  if (!(existingScorecard.getScorecard as { id?: string } | null)?.id) {
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateScorecard($input: CreateScorecardInput!) {
        createScorecard(input: $input) { id }
      }`,
      {
        input: {
          id: SCORECARD_ID,
          accountId: ACCOUNT_ID,
          name: SCORECARD_NAME,
          key: "scanner-recall",
        },
      },
    );
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateSection($input: CreateScorecardSectionInput!) {
        createScorecardSection(input: $input) { id }
      }`,
      {
        input: {
          id: SECTION_ID,
          name: "Main",
          order: 1,
          scorecardId: SCORECARD_ID,
        },
      },
    );
    await graphqlRequest(
      graphqlUrl,
      `mutation CreateScore($input: CreateScoreInput!) {
        createScore(input: $input) { id }
      }`,
      {
        input: {
          id: SCORE_ID,
          accountId: ACCOUNT_ID,
          scorecardId: SCORECARD_ID,
          sectionId: SECTION_ID,
          name: SCORE_NAME,
          key: "span-overlap",
          order: 1,
          type: "classification",
          externalId: SCORE_ID,
        },
      },
    );
  }
}

async function importCorpus(corpusDir: string, graphqlUrl: string): Promise<number> {
  let imported = 0;
  for (const repoDir of listRepoDirs(corpusDir)) {
    await importGoldAnnotations(repoDir, graphqlUrl);
    const manifest = loadBenchmarkManifest(repoDir);
    for (const layer of manifest.coverage.layers) {
      imported += loadAnnotations(repoDir, layer).filter(shouldImportAnnotation)
        .length;
    }
  }
  return imported;
}

async function waitForReady(baseUrl: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.status === 200) {
        const payload = (await response.json()) as { status?: string };
        if (payload.status === "ready") {
          return;
        }
        lastError = JSON.stringify(payload);
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/readyz: ${lastError}`);
}

function startGraphql(dataDir: string, port: number, proxyDir: string): ChildProcess {
  mkdirSync(dataDir, { recursive: true });
  const child = spawn("bash", [startScript], {
    cwd: repoRoot,
    env: buildLocalGraphqlChildEnv({
      dataDir,
      host: "127.0.0.1",
      port,
      proxyDir,
    }),
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  child.unref();
  return child;
}

function extractEvaluationId(output: string): string | undefined {
  return output.match(
    /Created initial Evaluation record with ID:\s*([0-9a-f-]{36})/i,
  )?.[1];
}

async function fetchEvaluation(
  graphqlUrl: string,
  evaluationId: string,
): Promise<Record<string, unknown>> {
  const query = `query GetEvaluation($id: ID!) {
      getEvaluation(id: $id) {
        id
        type
        status
        accuracy
        metrics
        totalItems
        processedItems
        confusionMatrix
        errorMessage
        scorecardId
        scoreId
      }
    }`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const data = await graphqlRequest(graphqlUrl, query, { id: evaluationId });
      const evaluation = data.getEvaluation as Record<string, unknown> | null;
      if (!evaluation) {
        throw new Error(`getEvaluation returned null for ${evaluationId}`);
      }
      return evaluation;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`getEvaluation failed for ${evaluationId}`);
}

async function countItems(graphqlUrl: string): Promise<number> {
  const data = await graphqlRequest(
    graphqlUrl,
    `query ListItems($filter: ModelItemFilterInput) {
      listItems(filter: $filter, limit: 1000) {
        items { id externalId isEvaluation }
      }
    }`,
    { filter: { accountId: { eq: ACCOUNT_ID }, isEvaluation: { eq: true } } },
  );
  const items = (data.listItems as { items?: GraphQlItemRef[] })?.items ?? [];
  return items.length;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "corpus-dir": { type: "string" },
      "graphql-url": { type: "string" },
      "work-dir": { type: "string" },
      "graphql-proxy-dir": { type: "string" },
      port: { type: "string" },
      "start-graphql": { type: "boolean", default: false },
      "programmatic-recall": { type: "boolean", default: false },
    },
  });

  const corpusDir = values["corpus-dir"]?.trim();
  if (!corpusDir) {
    throw new Error("--corpus-dir is required (tests/benchmark of the corpus checkout)");
  }

  const proxyDir =
    values["graphql-proxy-dir"]?.trim() ||
    process.env.PLEXUS_GRAPHQL_PROXY_DIR?.trim() ||
    requireGraphqlProxyDir();

  const workDir =
    values["work-dir"]?.trim() || join(repoRoot, ".plexus-corpus-eval");
  mkdirSync(workDir, { recursive: true });

  const port = Number(values.port || process.env.PLEXUS_GRAPHQL_PORT || "8000");
  let graphqlUrl =
    values["graphql-url"]?.trim().replace(/\/$/, "") ||
    `http://127.0.0.1:${port}`;

  const dataDir = join(workDir, "virtuus");
  try {
    await waitForReady(graphqlUrl, 2_000);
  } catch {
    if (!values["start-graphql"]) {
      throw new Error(
        `GraphQL is not reachable at ${graphqlUrl}. Start it with --start-graphql or scripts/start-local-graphql.sh`,
      );
    }
    console.log(`Starting local GraphQL on port ${port}...`);
    startGraphql(dataDir, port, proxyDir);
    await waitForReady(graphqlUrl);
  }

  console.log(`GraphQL ready at ${graphqlUrl}`);
  console.log("Staging corpus scope into scan roots...");
  const stagedByKey = stageScopedSources(corpusDir, workDir);
  writeScorecardYaml(workDir);

  console.log("Computing corpus precision from exhaustive scopes...");
  const precisionReport = await computeCorpusPrecision(corpusDir, stagedByKey);
  writeFileSync(
    join(workDir, "precision.json"),
    `${JSON.stringify(precisionReport, null, 2)}\n`,
    "utf8",
  );
  console.log(`Corpus precision: ${JSON.stringify(precisionReport.aggregate)}`);

  if (values["programmatic-recall"]) {
    console.log("Computing corpus recall via plexus.scoring (no GraphQL server)...");
    const recallReport = await computeCorpusRecallProgrammatic(corpusDir, stagedByKey);
    writeFileSync(
      join(workDir, "recall.json"),
      `${JSON.stringify(recallReport, null, 2)}\n`,
      "utf8",
    );
    console.log(`Corpus recall: ${JSON.stringify(recallReport.aggregate)}`);
    console.log(JSON.stringify({
      precision: precisionReport.aggregate,
      recall: recallReport.aggregate,
      datasetPath,
      positiveGoldRows: rows,
    }, null, 2));
    return;
  }

  const datasetPath = join(workDir, "dataset.csv");
  const { rows, skipped } = writeDatasetCsv(corpusDir, stagedByKey, datasetPath);
  console.log(`Dataset rows (positive gold): ${rows}; omitted: ${skipped}`);

  await seedMetadata(graphqlUrl);
  const imported = await importCorpus(corpusDir, graphqlUrl);
  const itemCount = await countItems(graphqlUrl);
  console.log(`Imported gold Items: ${imported}; GraphQL evaluation Items: ${itemCount}`);

  const plexusCli = resolvePlexusCli();
  const findingsCommand = `cd ${repoRoot} && node -r ts-node/register scripts/scan-findings.ts --root {root}`;
  const result = spawnSync(
    plexusCli,
    [
      "evaluate",
      "accuracy",
      "--yaml",
      "--scorecard",
      SCORECARD_NAME,
      "--score",
      SCORE_NAME,
      "--dataset-file",
      datasetPath,
      "--notes",
      "Scanner recall on the curated 150-annotation corpus. Gold labels are still proposed (not human-accepted). Unread files are omitted from the recall denominator.",
    ],
    {
      cwd: workDir,
      env: {
        ...process.env,
        PLEXUS_API_URL: `${graphqlUrl}/graphql`,
        PLEXUS_GRAPHQL_AUTH_MODE: "api_key",
        PLEXUS_API_KEY: "local-eval-key",
        PLEXUS_ACCOUNT_ID: ACCOUNT_ID,
        PLEXUS_ACCOUNT_KEY: ACCOUNT_KEY,
        PLEXUS_SOURCE_FINDINGS_COMMAND: findingsCommand,
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  writeFileSync(join(workDir, "evaluate.log"), output, "utf8");
  if (result.status !== 0) {
    throw new Error(
      `plexus evaluate accuracy failed (exit ${result.status}). See ${join(workDir, "evaluate.log")}\n${output.slice(-8000)}`,
    );
  }

  const evaluationId = extractEvaluationId(output);
  if (!evaluationId) {
    throw new Error("evaluate output did not include an Evaluation id");
  }
  writeFileSync(join(workDir, "evaluation-id.txt"), `${evaluationId}\n`, "utf8");

  const evaluation = await fetchEvaluation(graphqlUrl, evaluationId);
  writeFileSync(
    join(workDir, "evaluation.json"),
    `${JSON.stringify(evaluation, null, 2)}\n`,
    "utf8",
  );

  console.log(JSON.stringify({
    evaluationId,
    graphqlUrl,
    datasetPath,
    positiveGoldRows: rows,
    importedItems: imported,
    precision: precisionReport.aggregate,
    evaluation,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { shouldImportAnnotation };
export type { AnnotationRecord };
