#!/usr/bin/env node
import { componentEvalCases } from "../tests/eval/layers/components/cases";
import { scanFixtureComponents } from "../tests/eval/layers/components/adapter";
import { dataFlowEvalCases } from "../tests/eval/layers/data-flows/cases";
import { scanFixtureDataFlows } from "../tests/eval/layers/data-flows/adapter";
import { rawHitEvalCases } from "../tests/eval/layers/raw-hits/cases";
import { scanFixtureRawHits } from "../tests/eval/layers/raw-hits/adapter";
import { mentionEvalCases } from "../tests/eval/layers/mentions/cases";
import { scanFixtureMentions } from "../tests/eval/layers/mentions/adapter";
import { dataItemEvalCases } from "../tests/eval/layers/data-items/cases";
import { scanFixtureDataItems } from "../tests/eval/layers/data-items/adapter";
import { scoreEvalCases } from "../tests/eval/score";
import type {
  EvalCase,
  EvalCaseResult,
  EvalLayer,
  EvalScoreReport,
  FixtureScanResult,
} from "../tests/eval/types";

type FixtureScanner = (fixture: string) => Promise<FixtureScanResult>;

interface EvalLayerConfig {
  layer: EvalLayer;
  cases: EvalCase[];
  scanFixture: FixtureScanner;
}

export interface LayerEvalSummary {
  layer: EvalLayer;
  fixtureCount: number;
  positiveCount: number;
  negativeCount: number;
  documentedGapCount: number;
  report: EvalScoreReport;
  cases: EvalCase[];
}

export interface EvalSuiteResult {
  totalUniqueFixtures: number;
  totalAssertions: number;
  layers: LayerEvalSummary[];
  passed: boolean;
}

const EVAL_LAYERS: EvalLayerConfig[] = [
  { layer: "components", cases: componentEvalCases, scanFixture: scanFixtureComponents },
  { layer: "data-flows", cases: dataFlowEvalCases, scanFixture: scanFixtureDataFlows },
  { layer: "raw-hits", cases: rawHitEvalCases, scanFixture: scanFixtureRawHits },
  { layer: "mentions", cases: mentionEvalCases, scanFixture: scanFixtureMentions },
  { layer: "data-items", cases: dataItemEvalCases, scanFixture: scanFixtureDataItems },
];

function uniqueFixtures(cases: EvalCase[]): string[] {
  return [...new Set(cases.map((caseRecord) => caseRecord.fixture))];
}

function countByStatus(cases: EvalCase[], status: EvalCase["expected"]["status"]): number {
  return cases.filter((caseRecord) => caseRecord.expected.status === status).length;
}

function countDocumentedGaps(cases: EvalCase[]): number {
  return cases.filter((caseRecord) => caseRecord.expected.documentedGap).length;
}

export function hasGatedPositiveFailure(
  cases: EvalCase[],
  caseResults: EvalCaseResult[],
): boolean {
  return caseResults.some((result) => {
    const caseRecord = cases.find((entry) => entry.id === result.caseId);
    if (!caseRecord) {
      return false;
    }
    return (
      caseRecord.expected.status === "positive" &&
      !caseRecord.expected.documentedGap &&
      !result.unread &&
      !result.matched
    );
  });
}

export async function runEvalSuite(): Promise<EvalSuiteResult> {
  const allFixtures = new Set<string>();
  const layers: LayerEvalSummary[] = [];

  for (const config of EVAL_LAYERS) {
    const fixtures = uniqueFixtures(config.cases);
    for (const fixture of fixtures) {
      allFixtures.add(fixture);
    }

    const scanResults = await Promise.all(fixtures.map(config.scanFixture));
    const report = scoreEvalCases(config.cases, scanResults);

    layers.push({
      layer: config.layer,
      fixtureCount: fixtures.length,
      positiveCount: countByStatus(config.cases, "positive"),
      negativeCount: countByStatus(config.cases, "negative"),
      documentedGapCount: countDocumentedGaps(config.cases),
      report,
      cases: config.cases,
    });
  }

  const totalAssertions = EVAL_LAYERS.reduce(
    (sum, config) => sum + config.cases.length,
    0,
  );
  const passed = layers.every(
    (layerSummary) => !hasGatedPositiveFailure(layerSummary.cases, layerSummary.report.caseResults),
  );

  return {
    totalUniqueFixtures: allFixtures.size,
    totalAssertions,
    layers,
    passed,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function formatLayerTable(result: EvalSuiteResult): string {
  const headers = [
    "layer",
    "fixtures",
    "positives",
    "negatives",
    "documentedGaps",
    "recall",
    "labelAccuracy",
    "correctLabelRecall",
    "precision",
    "negativeCasePassRate",
    "unread",
  ];

  const rows = result.layers.map((layerSummary) => {
    const { scores } = layerSummary.report;
    return [
      layerSummary.layer,
      String(layerSummary.fixtureCount),
      String(layerSummary.positiveCount),
      String(layerSummary.negativeCount),
      String(layerSummary.documentedGapCount),
      formatPercent(scores.recall),
      formatPercent(scores.labelAccuracy),
      formatPercent(scores.correctLabelRecall),
      formatPercent(scores.precision),
      formatPercent(scores.negativeCasePassRate),
      String(scores.unreadCount),
    ];
  });

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );

  const formatRow = (cells: string[]) =>
    cells.map((cell, index) => pad(cell, widths[index]!)).join("  ");

  return [formatRow(headers), formatRow(widths.map((width) => "-".repeat(width))), ...rows.map(formatRow)].join(
    "\n",
  );
}

function formatCaseDetails(result: EvalSuiteResult): string {
  const sections: string[] = [];

  for (const layerSummary of result.layers) {
    const lines = [
      `=== ${layerSummary.layer} ===`,
      pad("caseId", 48) +
        pad("status", 12) +
        pad("matched", 10) +
        pad("labelsCorrect", 16) +
        pad("unread", 8) +
        "documentedGap",
    ];

    for (const caseRecord of layerSummary.cases) {
      const caseResult = layerSummary.report.caseResults.find(
        (entry) => entry.caseId === caseRecord.id,
      );
      if (!caseResult) {
        continue;
      }

      lines.push(
        pad(caseRecord.id, 48) +
          pad(caseRecord.expected.status, 12) +
          pad(String(caseResult.matched), 10) +
          pad(String(caseResult.labelsCorrect), 16) +
          pad(String(caseResult.unread), 8) +
          String(caseResult.documentedGap),
      );
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

export function formatEvalSuiteReport(result: EvalSuiteResult): string {
  const lines = [
    "Fixture evaluation suite",
    `Repositories (unique fixtures): ${result.totalUniqueFixtures}`,
    `Assertions (all layers): ${result.totalAssertions}`,
    "",
    formatLayerTable(result),
    "",
    formatCaseDetails(result),
    "",
    result.passed ? "PASS — no gated positive recall failures" : "FAIL — gated positive recall failures",
  ];

  return lines.join("\n");
}

async function main(): Promise<void> {
  const result = await runEvalSuite();
  process.stdout.write(`${formatEvalSuiteReport(result)}\n`);
  process.exit(result.passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
