import assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Before,
  Given,
  setDefaultTimeout,
  Then,
  When,
} from "@cucumber/cucumber";

import type { PersonalDataEvalLayer } from "../../src/eval-layers/collect-personal-data-findings";
import {
  isPlexusScoreClassAvailable,
  resolvePythonForPlexus,
} from "./plexus-runtime";

setDefaultTimeout(120_000);

const repoRoot = join(__dirname, "..", "..");
const scanFixtureRoot = join(repoRoot, "features", "fixtures", "scan-findings");
const jvmManifestsFixtureRoot = join(
  repoRoot,
  "features",
  "fixtures",
  "scanner-recall-eval",
  "repos",
  "jvm-manifests-basic",
);
const evalFixtureRoot = join(
  repoRoot,
  "features",
  "fixtures",
  "scanner-recall-eval",
);
const scorecardFixtureDir = join(evalFixtureRoot, "scorecards");
const datasetFixtureDir = join(evalFixtureRoot, "datasets");
const layerEvalScript = join(repoRoot, "features", "scripts", "run-layer-score-eval.py");

const SCORECARD_NAME = "Local Eval";

type FindingsFormat = "identity" | "span";

interface LayerScoreConfig {
  name: string;
  id: string;
  key: string;
  scoreClass: string;
  findingsLayer: PersonalDataEvalLayer;
  findingsFormat: FindingsFormat;
}

const LAYER_SCORES: Record<string, LayerScoreConfig> = {
  "Subject Identity": {
    name: "Subject Identity",
    id: "local-eval-subject-identity",
    key: "subject-identity",
    scoreClass: "SubjectIdentityScore",
    findingsLayer: "data-items",
    findingsFormat: "identity",
  },
  "Raw Hit Identity": {
    name: "Raw Hit Identity",
    id: "local-eval-raw-hit-identity",
    key: "raw-hit-identity",
    scoreClass: "SubjectIdentityScore",
    findingsLayer: "raw-hits",
    findingsFormat: "identity",
  },
  "Mention Identity": {
    name: "Mention Identity",
    id: "local-eval-mention-identity",
    key: "mention-identity",
    scoreClass: "SubjectIdentityScore",
    findingsLayer: "mentions",
    findingsFormat: "identity",
  },
  "Raw Hit Span": {
    name: "Raw Hit Span",
    id: "local-eval-raw-hit-span",
    key: "raw-hit-span",
    scoreClass: "SubjectSpanOverlapScore",
    findingsLayer: "raw-hits",
    findingsFormat: "span",
  },
  "Mention Span": {
    name: "Mention Span",
    id: "local-eval-mention-span",
    key: "mention-span",
    scoreClass: "SubjectSpanOverlapScore",
    findingsLayer: "mentions",
    findingsFormat: "span",
  },
};

interface EvaluationMetric {
  name: string;
  value: number;
}

interface LayerEvaluationPayload {
  id: string;
  status: string;
  metrics: EvaluationMetric[];
  recall: number;
  output: string;
}

interface ScannerLayerWorld {
  evalWorkDir?: string;
  datasetFile?: string;
  evaluation?: LayerEvaluationPayload;
  metrics?: EvaluationMetric[];
  recallValue?: number;
  evaluateOutput?: string;
  activeScoreName?: string;
}

function getWorld(context: unknown): ScannerLayerWorld {
  return context as ScannerLayerWorld;
}

function materializeDataset(
  templateName: string,
  sourceRoot: string = scanFixtureRoot,
): string {
  const templatePath = join(datasetFixtureDir, templateName);
  const template = readFileSync(templatePath, "utf8");
  const datasetDir = mkdtempSync(join(tmpdir(), "dataparade-layer-dataset-"));
  const datasetPath = join(
    datasetDir,
    templateName.endsWith(".csv") ? templateName : `${templateName}.csv`,
  );
  writeFileSync(
    datasetPath,
    template.replaceAll("__SOURCE_ROOT__", sourceRoot),
    "utf8",
  );
  return datasetPath;
}

function prepareEvalWorkDir(): string {
  const workDir = mkdtempSync(join(tmpdir(), "dataparade-layer-eval-"));
  cpSync(scorecardFixtureDir, join(workDir, "scorecards"), { recursive: true });
  return workDir;
}

function buildFindingsCommand(score: LayerScoreConfig): string {
  const script =
    score.findingsFormat === "span"
      ? "features/scripts/flatten-span-findings.ts"
      : "scripts/scan-layer-findings.ts";
  return `cd ${repoRoot} && node -r ts-node/register ${script} --root {root} --layer ${score.findingsLayer}`;
}

function metricValue(metrics: EvaluationMetric[], name: string): number | undefined {
  const entry = metrics.find(
    (metric) => metric.name.toLowerCase() === name.toLowerCase(),
  );
  return entry?.value;
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

function runLayerScoreEval(w: ScannerLayerWorld): void {
  assert.ok(w.datasetFile, "dataset file must be set");
  assert.ok(w.evalWorkDir, "evaluation work directory must be set");
  assert.ok(w.activeScoreName, "active score name must be set");

  const score = LAYER_SCORES[w.activeScoreName];
  assert.ok(score, `unknown layer score: ${w.activeScoreName}`);

  const python = resolvePythonForPlexus();
  const findingsCommand = buildFindingsCommand(score);
  const result = spawnSync(
    python,
    [
      layerEvalScript,
      "--scorecard-dir",
      join(w.evalWorkDir, "scorecards"),
      "--scorecard-name",
      SCORECARD_NAME,
      "--score-name",
      score.name,
      "--dataset-file",
      w.datasetFile,
      "--findings-command",
      findingsCommand,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  assert.strictEqual(
    result.status,
    0,
    `layer score evaluation failed:\n${combinedOutput}`,
  );

  const payload = JSON.parse(result.stdout) as LayerEvaluationPayload;
  w.evaluation = payload;
  w.metrics = payload.metrics;
  w.recallValue = payload.recall;
  w.evaluateOutput = payload.output;
}

function bootstrapLayerScenario(w: ScannerLayerWorld, scoreName: string): void {
  w.evalWorkDir = prepareEvalWorkDir();
  w.activeScoreName = scoreName;
}

function assertScoreOnScorecard(w: ScannerLayerWorld, scoreName: string): void {
  const score = LAYER_SCORES[scoreName];
  assert.ok(score, `unknown layer score: ${scoreName}`);

  if (!w.evalWorkDir) {
    bootstrapLayerScenario(w, scoreName);
  }
  w.activeScoreName = scoreName;

  const scoreYaml = join(
    w.evalWorkDir!,
    "scorecards",
    SCORECARD_NAME,
    `${score.name}.yaml`,
  );
  const yaml = readFileSync(scoreYaml, "utf8");
  assert.match(yaml, new RegExp(`class:\\s*${score.scoreClass}`));
}

Before({ tags: "@layer-eval" }, function (this: ScannerLayerWorld) {
  try {
    resolvePythonForPlexus();
  } catch {
    return "skipped";
  }
  if (!isPlexusScoreClassAvailable("SubjectIdentityScore")) {
    return "skipped";
  }

  const w = getWorld(this);
  w.evalWorkDir = undefined;
  w.datasetFile = undefined;
  w.evaluation = undefined;
  w.metrics = undefined;
  w.recallValue = undefined;
  w.evaluateOutput = undefined;
  w.activeScoreName = undefined;
});

Given(
  "the Subject Identity score is on the scorecard",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }
    assertScoreOnScorecard(getWorld(this), "Subject Identity");
  },
);

Given(
  "the Raw Hit Identity score is on the scorecard",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Identity");
    if (skip) {
      return skip;
    }
    assertScoreOnScorecard(getWorld(this), "Raw Hit Identity");
  },
);

Given(
  "the Mention Identity score is on the scorecard",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Identity");
    if (skip) {
      return skip;
    }
    assertScoreOnScorecard(getWorld(this), "Mention Identity");
  },
);

Given(
  "the Raw Hit Span score is on the scorecard",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }
    assertScoreOnScorecard(getWorld(this), "Raw Hit Span");
  },
);

Given(
  "the Mention Span score is on the scorecard",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Span");
    if (skip) {
      return skip;
    }
    assertScoreOnScorecard(getWorld(this), "Mention Span");
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
  "a data-item gold dataset with identity-only evidence",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("data-item-identity-only.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /data_item:username/);
    assert.match(dataset, /startLine"":7/);
  },
);

Given(
  "a data-item gold dataset with a multi-file subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset(
      "data-item-multi-file.csv",
      jvmManifestsFixtureRoot,
    );
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /data_item:username/);
    assert.match(dataset, /bootstrap\.yml/);
  },
);

Given(
  "a raw-hit gold dataset with a matching subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("raw-hit-identity-hit.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /raw_hit:username/);
  },
);

Given(
  "a raw-hit gold dataset with a missing subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("raw-hit-identity-miss.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /raw_hit:passport/);
  },
);

Given(
  "a mention gold dataset with a matching subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("mention-identity-hit.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /mention:username/);
  },
);

Given(
  "a mention gold dataset with a missing subjectKey",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.datasetFile = materializeDataset("mention-identity-miss.csv");
    const dataset = readFileSync(w.datasetFile, "utf8");
    assert.match(dataset, /mention:passport/);
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
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Subject Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Subject Identity";
    runLayerScoreEval(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Raw Hit Identity score",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Raw Hit Identity";
    runLayerScoreEval(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Mention Identity score",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Mention Identity";
    runLayerScoreEval(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Raw Hit Span score",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Raw Hit Span";
    runLayerScoreEval(w);
  },
);

When(
  "I run plexus evaluate accuracy for the Mention Span score",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Mention Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    w.activeScoreName = "Mention Span";
    runLayerScoreEval(w);
  },
);

Then("an Evaluation record is stored for layer evaluation", function (this: ScannerLayerWorld) {
  const w = getWorld(this);
  assert.ok(w.evaluation, "evaluation must be loaded after score run");
  assert.strictEqual(w.evaluation.status, "COMPLETED");
  assert.ok(w.evaluation.id.length > 0, "Evaluation id must be present");
});

Then(
  "the headline metric is recall of detections at 100 percent",
  function (this: ScannerLayerWorld) {
    const w = getWorld(this);
    assert.ok(w.evaluation, "evaluation must be loaded after score run");

    w.metrics = w.evaluation.metrics;
    w.recallValue = metricValue(w.metrics, "Recall");

    assert.ok(
      w.recallValue !== undefined,
      `Recall metric must be present: ${JSON.stringify(w.metrics)}`,
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
  assert.ok(w.evaluation, "evaluation must be loaded after score run");

  w.metrics = w.evaluation.metrics;
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

function bootstrapRawHitSpanScenario(
  w: ScannerLayerWorld,
  datasetTemplate: string,
): void {
  bootstrapLayerScenario(w, "Raw Hit Span");
  w.datasetFile = materializeDataset(datasetTemplate);
}

function bootstrapRawHitIdentityScenario(
  w: ScannerLayerWorld,
  datasetTemplate: string,
): void {
  bootstrapLayerScenario(w, "Raw Hit Identity");
  w.datasetFile = materializeDataset(datasetTemplate);
}

Given(
  "a gold Item whose evidence file the layer scanner did not ingest",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    bootstrapRawHitSpanScenario(w, "raw-hit-unread.csv");
  },
);

Given(
  "a raw-hit identity gold Item whose evidence file was not ingested",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Identity");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    bootstrapRawHitIdentityScenario(w, "raw-hit-identity-unread.csv");
  },
);

Given(
  "a gold Item whose evidence file the layer scanner ingested",
  function (this: ScannerLayerWorld) {
    const skip = skipUnlessScoreAvailable("Raw Hit Span");
    if (skip) {
      return skip;
    }

    const w = getWorld(this);
    bootstrapRawHitSpanScenario(w, "raw-hit-miss.csv");
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
  assert.ok(w.evaluateOutput, "evaluation output must be captured");

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
    assert.ok(w.evaluateOutput, "evaluation output must be captured");
    assert.ok(w.evaluation, "evaluation must be loaded after score run");

    w.metrics = w.evaluation.metrics;
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
