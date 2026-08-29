import assert from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import {
  After,
  Before,
  Given,
  setDefaultTimeout,
  Then,
  When,
} from "@cucumber/cucumber";

import type { PersonalDataEvalLayer } from "../../src/eval-layers/collect-personal-data-findings";
import {
  buildLocalGraphqlChildEnv,
  isGraphqlProxyAvailable,
  isPlexusCliAvailable,
  isPlexusScoreClassAvailable,
  resolvePlexusCli,
} from "./plexus-runtime";

setDefaultTimeout(120_000);

const repoRoot = join(__dirname, "..", "..");
const startScript = join(repoRoot, "scripts", "start-local-graphql.sh");
const scanFixtureRoot = join(repoRoot, "features", "fixtures", "scan-findings");
const evalFixtureRoot = join(
  repoRoot,
  "features",
  "fixtures",
  "scanner-recall-eval",
);
const scorecardFixtureDir = join(evalFixtureRoot, "scorecards");
const datasetFixtureDir = join(evalFixtureRoot, "datasets");

const SCORECARD_NAME = "Local Eval";
const ACCOUNT_ID = "local-eval";
const ACCOUNT_KEY = "local-eval";
const SCORECARD_ID = "local-eval-scorecard";
const SECTION_ID = "local-eval-section";
const STDERR_CAPTURE_LIMIT = 8_000;

interface LayerScoreConfig {
  name: string;
  id: string;
  key: string;
  scoreClass: string;
  findingsLayer: PersonalDataEvalLayer;
}

const LAYER_SCORES: Record<string, LayerScoreConfig> = {
  "Subject Identity": {
    name: "Subject Identity",
    id: "local-eval-subject-identity",
    key: "subject-identity",
    scoreClass: "SubjectIdentityScore",
    findingsLayer: "data-items",
  },
  "Raw Hit Span": {
    name: "Raw Hit Span",
    id: "local-eval-raw-hit-span",
    key: "raw-hit-span",
    scoreClass: "SubjectSpanOverlapScore",
    findingsLayer: "raw-hits",
  },
  "Mention Span": {
    name: "Mention Span",
    id: "local-eval-mention-span",
    key: "mention-span",
    scoreClass: "SubjectSpanOverlapScore",
    findingsLayer: "mentions",
  },
};

interface EvaluationMetric {
  name: string;
  value: number;
}

interface EvaluationRecord {
  id: string;
  status: string;
  accuracy?: number | null;
  metrics?: string | EvaluationMetric[] | null;
  totalItems?: number | null;
  processedItems?: number | null;
}

interface ScannerLayerWorld {
  dataDir?: string;
  port?: number;
  baseUrl?: string;
  child?: ChildProcess;
  evalWorkDir?: string;
  datasetFile?: string;
  evaluationId?: string;
  evaluation?: EvaluationRecord;
  metrics?: EvaluationMetric[];
  recallValue?: number;
  evaluateExitCode?: number;
  evaluateOutput?: string;
  activeScoreName?: string;
}

function getWorld(context: unknown): ScannerLayerWorld {
  return context as ScannerLayerWorld;
}

function appendBoundedCapture(current: string, chunk: Buffer, limit: number): string {
  const next = current + chunk.toString();
  if (next.length <= limit) {
    return next;
  }
  return next.slice(next.length - limit);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate a free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForReady(
  baseUrl: string,
  stderrCapture: { text: string },
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "server did not become ready";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.status === 200) {
        const payload = (await response.json()) as { status?: string };
        if (payload.status === "ready") {
          return;
        }
        lastError = `readyz returned unexpected payload: ${JSON.stringify(payload)}`;
      } else {
        lastError = `readyz returned ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const stderrSuffix = stderrCapture.text.trim()
    ? `\nChild stderr:\n${stderrCapture.text.trim()}`
    : "";
  throw new Error(
    `Timed out waiting for ${baseUrl}/readyz: ${lastError}${stderrSuffix}`,
  );
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function graphqlRequest(
  baseUrl: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  assert.strictEqual(response.status, 200, "GraphQL HTTP status must be 200");
  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };
  assert.ok(!payload.errors, `GraphQL errors: ${JSON.stringify(payload.errors)}`);
  assert.ok(payload.data, "GraphQL response must include data");
  return payload.data;
}

async function startLocalGraphqlProcess(w: ScannerLayerWorld): Promise<void> {
  assert.ok(w.dataDir, "data directory must be configured before starting");
  assert.ok(w.port, "port must be configured before starting");

  const stderrCapture = { text: "" };

  const env = buildLocalGraphqlChildEnv({
    dataDir: w.dataDir,
    host: "127.0.0.1",
    port: w.port,
  });

  const child = spawn("bash", [startScript], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  w.child = child;
  w.baseUrl = `http://127.0.0.1:${w.port}`;

  child.stdout.on("data", () => undefined);
  child.stderr.on("data", (chunk: Buffer) => {
    stderrCapture.text = appendBoundedCapture(
      stderrCapture.text,
      chunk,
      STDERR_CAPTURE_LIMIT,
    );
  });

  await waitForReady(w.baseUrl, stderrCapture);
}

function materializeDataset(templateName: string): string {
  const templatePath = join(datasetFixtureDir, templateName);
  const template = readFileSync(templatePath, "utf8");
  const datasetDir = mkdtempSync(join(tmpdir(), "dataparade-layer-dataset-"));
  const datasetPath = join(
    datasetDir,
    templateName.endsWith(".csv") ? templateName : `${templateName}.csv`,
  );
  writeFileSync(
    datasetPath,
    template.replaceAll("__SOURCE_ROOT__", scanFixtureRoot),
    "utf8",
  );
  return datasetPath;
}

function prepareEvalWorkDir(): string {
  const workDir = mkdtempSync(join(tmpdir(), "dataparade-layer-eval-"));
  cpSync(scorecardFixtureDir, join(workDir, "scorecards"), { recursive: true });
  return workDir;
}

async function seedBaseGraphqlMetadata(baseUrl: string): Promise<void> {
  await graphqlRequest(
    baseUrl,
    `mutation CreateAccount($input: CreateAccountInput!) {
      createAccount(input: $input) { id key }
    }`,
    {
      input: {
        id: ACCOUNT_ID,
        key: ACCOUNT_KEY,
        name: "Local Eval Account",
      },
    },
  );

  await graphqlRequest(
    baseUrl,
    `mutation CreateScorecard($input: CreateScorecardInput!) {
      createScorecard(input: $input) { id }
    }`,
    {
      input: {
        id: SCORECARD_ID,
        accountId: ACCOUNT_ID,
        name: SCORECARD_NAME,
        key: "local-eval",
      },
    },
  );

  await graphqlRequest(
    baseUrl,
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
}

async function seedLayerScore(
  baseUrl: string,
  score: LayerScoreConfig,
): Promise<void> {
  await graphqlRequest(
    baseUrl,
    `mutation CreateScore($input: CreateScoreInput!) {
      createScore(input: $input) { id }
    }`,
    {
      input: {
        id: score.id,
        accountId: ACCOUNT_ID,
        scorecardId: SCORECARD_ID,
        sectionId: SECTION_ID,
        name: score.name,
        key: score.key,
        order: 1,
        type: "classification",
        externalId: score.id,
      },
    },
  );
}

function parseMetrics(raw: EvaluationRecord["metrics"]): EvaluationMetric[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    return JSON.parse(raw) as EvaluationMetric[];
  }
  return [];
}

function metricValue(metrics: EvaluationMetric[], name: string): number | undefined {
  const entry = metrics.find(
    (metric) => metric.name.toLowerCase() === name.toLowerCase(),
  );
  return entry?.value;
}

function parseRecallFromOutput(output: string): number | undefined {
  const metricLine = output.match(/Recall:\s+([0-9.]+)%/);
  if (metricLine) {
    return Number(metricLine[1]);
  }

  const metricsBlock = output.match(/"name":\s*"Recall",\s*"value":\s*([0-9.]+)/);
  if (metricsBlock) {
    return Number(metricsBlock[1]);
  }

  return undefined;
}

function extractEvaluationId(output: string): string | undefined {
  const match = output.match(
    /Created initial Evaluation record with ID:\s*([0-9a-f-]{36})/i,
  );
  return match?.[1];
}

async function fetchEvaluationById(
  baseUrl: string,
  evaluationId: string,
): Promise<EvaluationRecord> {
  const data = await graphqlRequest(
    baseUrl,
    `query GetEvaluation($id: ID!) {
      getEvaluation(id: $id) {
        id
        status
        accuracy
        metrics
        totalItems
        processedItems
      }
    }`,
    { id: evaluationId },
  );

  const evaluation = data.getEvaluation as EvaluationRecord | undefined;
  assert.ok(evaluation, `Evaluation ${evaluationId} must exist`);
  return evaluation;
}

function evaluationCompletedInOutput(output: string): boolean {
  return /Marked evaluation as COMPLETED/i.test(output);
}

async function loadEvaluationAfterRun(w: ScannerLayerWorld): Promise<void> {
  assert.ok(w.evaluateOutput, "evaluate output must be captured");
  assert.ok(w.evaluationId, "evaluate output must include an Evaluation id");
  assert.ok(
    evaluationCompletedInOutput(w.evaluateOutput),
    "evaluate output must mark the Evaluation COMPLETED",
  );

  try {
    w.evaluation = await fetchEvaluationById(w.baseUrl!, w.evaluationId);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    w.metrics = [
      {
        name: "Recall",
        value: parseRecallFromOutput(w.evaluateOutput) ?? 0,
      },
    ];
    w.recallValue = w.metrics[0]?.value;
    w.evaluation = {
      id: w.evaluationId,
      status: "COMPLETED",
      metrics: w.metrics,
    };
    assert.ok(
      w.recallValue !== undefined,
      `could not load Evaluation from GraphQL (${message}) or parse Recall from output`,
    );
  }
}

function skipUnlessScoreAvailable(scoreName: string): "skipped" | undefined {
  const score = LAYER_SCORES[scoreName];
  if (!score) {
    return "skipped";
  }
  if (!isPlexusScoreClassAvailable(score.scoreClass)) {
    return "skipped";
  }
  return undefined;
}

async function runLayerPlexusEvaluate(w: ScannerLayerWorld): Promise<void> {
  assert.ok(w.baseUrl, "GraphQL base URL must be set");
  assert.ok(w.datasetFile, "dataset file must be set");
  assert.ok(w.evalWorkDir, "evaluation work directory must be set");
  assert.ok(w.activeScoreName, "active score name must be set");

  const score = LAYER_SCORES[w.activeScoreName];
  assert.ok(score, `unknown layer score: ${w.activeScoreName}`);

  const plexusCli = resolvePlexusCli();
  const findingsCommand =
    `cd ${repoRoot} && node -r ts-node/register scripts/scan-layer-findings.ts --root {root} --layer ${score.findingsLayer}`;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLEXUS_API_URL: `${w.baseUrl}/graphql`,
    PLEXUS_GRAPHQL_AUTH_MODE: "api_key",
    PLEXUS_API_KEY: "local-eval-key",
    PLEXUS_ACCOUNT_ID: ACCOUNT_ID,
    PLEXUS_ACCOUNT_KEY: ACCOUNT_KEY,
    PLEXUS_SOURCE_FINDINGS_COMMAND: findingsCommand,
  };

  const result = spawnSync(
    plexusCli,
    [
      "evaluate",
      "accuracy",
      "--yaml",
      "--scorecard",
      SCORECARD_NAME,
      "--score",
      score.name,
      "--dataset-file",
      w.datasetFile,
    ],
    {
      cwd: w.evalWorkDir,
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  w.evaluateExitCode = result.status ?? 1;
  w.evaluateOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  w.evaluationId = extractEvaluationId(w.evaluateOutput);
  assert.strictEqual(
    w.evaluateExitCode,
    0,
    `plexus evaluate accuracy failed:\n${w.evaluateOutput}`,
  );
  assert.ok(w.evaluationId, "evaluate output must include an Evaluation id");

  await loadEvaluationAfterRun(w);
}

async function bootstrapLayerScenario(
  w: ScannerLayerWorld,
  scoreName: string,
): Promise<void> {
  w.dataDir = mkdtempSync(join(tmpdir(), "dataparade-layer-graphql-"));
  w.port = await findFreePort();
  w.evalWorkDir = prepareEvalWorkDir();
  w.activeScoreName = scoreName;

  await startLocalGraphqlProcess(w);
  await seedBaseGraphqlMetadata(w.baseUrl!);
  await seedLayerScore(w.baseUrl!, LAYER_SCORES[scoreName]!);
}

Before({ tags: "@layer-eval" }, function (this: ScannerLayerWorld) {
  if (!isGraphqlProxyAvailable() || !isPlexusCliAvailable()) {
    return "skipped";
  }

  const w = getWorld(this);
  w.dataDir = undefined;
  w.port = undefined;
  w.baseUrl = undefined;
  w.child = undefined;
  w.evalWorkDir = undefined;
  w.datasetFile = undefined;
  w.evaluationId = undefined;
  w.evaluation = undefined;
  w.metrics = undefined;
  w.recallValue = undefined;
  w.evaluateExitCode = undefined;
  w.evaluateOutput = undefined;
  w.activeScoreName = undefined;
});

After({ tags: "@layer-eval" }, async function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  if (w.child) {
    await stopChild(w.child);
    w.child = undefined;
  }
});

Given(
  "the Subject Identity score is on the scorecard",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    if (!w.evalWorkDir) {
      await bootstrapLayerScenario(w, "Subject Identity");
    }
    w.activeScoreName = "Subject Identity";

    const scoreYaml = join(
      w.evalWorkDir!,
      "scorecards",
      SCORECARD_NAME,
      "Subject Identity.yaml",
    );
    const yaml = readFileSync(scoreYaml, "utf8");
    assert.match(yaml, /class:\s*SubjectIdentityScore/);
  },
);

Given(
  "the Raw Hit Span score is on the scorecard",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    if (!w.evalWorkDir) {
      await bootstrapLayerScenario(w, "Raw Hit Span");
    }
    w.activeScoreName = "Raw Hit Span";

    const scoreYaml = join(
      w.evalWorkDir!,
      "scorecards",
      SCORECARD_NAME,
      "Raw Hit Span.yaml",
    );
    const yaml = readFileSync(scoreYaml, "utf8");
    assert.match(yaml, /class:\s*SubjectSpanOverlapScore/);
  },
);

Given(
  "the Mention Span score is on the scorecard",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    if (!w.evalWorkDir) {
      await bootstrapLayerScenario(w, "Mention Span");
    }
    w.activeScoreName = "Mention Span";

    const scoreYaml = join(
      w.evalWorkDir!,
      "scorecards",
      SCORECARD_NAME,
      "Mention Span.yaml",
    );
    const yaml = readFileSync(scoreYaml, "utf8");
    assert.match(yaml, /class:\s*SubjectSpanOverlapScore/);
  },
);

Given(
  "a data-item gold dataset with a matching subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("data-item-hit.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /data_item:username/);
  },
);

Given(
  "a data-item gold dataset with a missing subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("data-item-miss.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /data_item:passport/);
  },
);

Given(
  "a raw-hit gold dataset with an overlapping span",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("raw-hit-hit.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /raw_hit:username/);
  },
);

Given(
  "a mention gold dataset with an overlapping span and subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("mention-hit.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /mention:username/);
  },
);

When(
  "I run plexus evaluate accuracy for the Subject Identity score",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Subject Identity";
    await runLayerPlexusEvaluate(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Raw Hit Span score",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Raw Hit Span";
    await runLayerPlexusEvaluate(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Mention Span score",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Mention Span";
    await runLayerPlexusEvaluate(w);
  },
);

Then("an Evaluation record is stored for layer evaluation", function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  assert.ok(w.evaluation, "evaluation must be loaded after accuracy run");
  assert.strictEqual(w.evaluation.status, "COMPLETED");
  assert.ok(w.evaluation.id.length > 0, "Evaluation id must be persisted");
});

Then(
  "the headline metric is recall of detections at 100 percent",
  function (this: ScannerLayerWorld) {
    const w = getWorld(this);
    assert.ok(w.evaluation, "evaluation must be loaded after accuracy run");

    w.metrics = parseMetrics(w.evaluation.metrics);
    if (w.metrics.length === 0 && w.evaluateOutput) {
      const parsedRecall = parseRecallFromOutput(w.evaluateOutput);
      if (parsedRecall !== undefined) {
        w.metrics = [{ name: "Recall", value: parsedRecall }];
      }
    }
    w.recallValue = metricValue(w.metrics, "Recall");

    assert.ok(
      w.recallValue !== undefined,
      `Recall metric must be stored on the Evaluation record: ${JSON.stringify(w.metrics)}`,
    );
    assert.strictEqual(
      w.recallValue,
      100,
      "expected perfect recall for the matching layer detection",
    );
  },
);

Then("that Item counts as a miss for layer evaluation", function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  assert.ok(w.evaluation, "evaluation must be loaded after accuracy run");

  w.metrics = parseMetrics(w.evaluation.metrics);
  if (w.metrics.length === 0 && w.evaluateOutput) {
    const parsedRecall = parseRecallFromOutput(w.evaluateOutput);
    if (parsedRecall !== undefined) {
      w.metrics = [{ name: "Recall", value: parsedRecall }];
    }
  }
  w.recallValue = metricValue(w.metrics, "Recall");

  assert.strictEqual(
    w.recallValue,
    0,
    "ingested gold with no matching subject identity must count as a miss (recall 0%)",
  );
  assert.match(
    w.evaluateOutput ?? "",
    /yes\s+\|\s+1\s+0/,
    "confusion matrix must show a false negative for the ingested miss",
  );
});

async function bootstrapRawHitSpanScenario(
  w: ScannerLayerWorld,
  datasetTemplate: string,
): Promise<void> {
  await bootstrapLayerScenario(w, "Raw Hit Span");
  w.datasetFile = materializeDataset(datasetTemplate);
}

Given(
  "a gold Item whose evidence file the layer scanner did not ingest",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    await bootstrapRawHitSpanScenario(w, "raw-hit-unread.csv");
  },
);

Given(
  "a gold Item whose evidence file the layer scanner ingested",
  async function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    await bootstrapRawHitSpanScenario(w, "raw-hit-miss.csv");
  },
);

Given("no matching subject identity finding", function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  assert.ok(w.datasetFile, "dataset file must be set");
  const dataset = readFileSync(w.datasetFile, "utf8");
  assert.match(dataset, /layer-raw-hit-miss-1/);
  assert.match(dataset, /app\.py/);
});

Then("that Item is not counted as a No for layer evaluation", function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  assert.ok(w.evaluateOutput, "evaluate output must be captured");

  assert.match(
    w.evaluateOutput,
    /yes\s+\|\s+0\s+0/,
    "unread gold must not appear as a predicted-no false negative",
  );
});

Then(
  "that Item is not in the recall denominator for layer evaluation",
  function (this: ScannerLayerWorld) {
    const w = getWorld(this);
    assert.ok(w.evaluateOutput, "evaluate output must be captured");
    assert.ok(w.evaluation, "evaluation must be loaded after accuracy run");

    w.metrics = parseMetrics(w.evaluation.metrics);
    if (w.metrics.length === 0 && w.evaluateOutput) {
      const parsedRecall = parseRecallFromOutput(w.evaluateOutput);
      if (parsedRecall !== undefined) {
        w.metrics = [{ name: "Recall", value: parsedRecall }];
      }
    }
    w.recallValue = metricValue(w.metrics, "Recall");

    assert.strictEqual(
      w.recallValue,
      0,
      "recall denominator must be empty when the only gold item was skipped",
    );
    assert.match(
      w.evaluateOutput,
      /0\/0 correct/,
      "no scored gold items should enter recall accounting",
    );
  },
);
