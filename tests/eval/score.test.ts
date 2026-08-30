import { scoreEvalCases } from "./score";
import type { EvalCase, FixtureScanResult, LayerFinding } from "./types";

interface ScoreScenario {
  name: string;
  cases: EvalCase[];
  scanResults: FixtureScanResult[];
  expect: {
    evaluablePositives?: number;
    matchedPositives?: number;
    matchedWithCorrectLabels?: number;
    negativeCases?: number;
    negativeCasesPassed?: number;
    unreadCount?: number;
    recall?: number | null;
    labelAccuracy?: number | null;
    negativeCasePassRate?: number | null;
    precision?: number | null;
    caseChecks?: Array<{
      caseId: string;
      unread?: boolean;
      matched?: boolean;
      labelsCorrect?: boolean;
      negativeClean?: boolean;
      documentedGap?: boolean;
    }>;
  };
}

const FIXTURE = "synthetic-fixture";

function scanResult(
  findings: LayerFinding[],
  scannedFiles: string[] = ["src/app.yml"],
): FixtureScanResult {
  return { fixture: FIXTURE, findings, scannedFiles };
}

function positiveCase(
  id: string,
  layer: EvalCase["layer"],
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  labels: string[],
  extra: Partial<EvalCase> = {},
): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer,
    subject: { key, name: key },
    evidence: { file_path: filePath, start_line: startLine, end_line: endLine },
    expected: { status: "positive", labels },
    rationale: extra.rationale ?? "synthetic positive",
    ...extra,
  };
}

function negativeCase(
  id: string,
  layer: EvalCase["layer"],
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer,
    subject: { key, name: key },
    evidence: { file_path: filePath, start_line: startLine, end_line: endLine },
    expected: { status: "negative", labels: [] },
    rationale: "synthetic negative",
  };
}

function finding(
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  labels: string[],
): LayerFinding {
  return {
    key,
    labels,
    sourceFilePaths: [filePath],
    sourceLines: [{ file_path: filePath, start_line: startLine, end_line: endLine }],
  };
}

const scoreScenarios: ScoreScenario[] = [
  {
    name: "excludes unread positives from recall denominator",
    cases: [
      positiveCase("unread-positive", "raw-hits", "raw_hit:email", "src/missing.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [scanResult([], ["src/other.yml"])],
    expect: {
      evaluablePositives: 0,
      matchedPositives: 0,
      unreadCount: 1,
      recall: null,
      caseChecks: [{ caseId: "unread-positive", unread: true, matched: false }],
    },
  },
  {
    name: "counts documentedGap positives in recall denominator",
    cases: [
      positiveCase("documented-gap", "raw-hits", "raw_hit:email", "src/app.yml", 2, 2, [
        "user_email",
      ], {
        expected: { status: "positive", labels: ["user_email"], documentedGap: true },
        rationale: "known miss still measured",
      }),
    ],
    scanResults: [scanResult([])],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 0,
      unreadCount: 0,
      recall: 0,
      caseChecks: [
        { caseId: "documented-gap", unread: false, matched: false, documentedGap: true },
      ],
    },
  },
  {
    name: "matches data-items by identity without span overlap",
    cases: [
      positiveCase("identity-only", "data-items", "data_item:username", "src/app.yml", 9, 9, [
        "username",
      ]),
    ],
    scanResults: [
      scanResult([finding("data_item:username", "src/app.yml", 3, 3, ["username"])]),
    ],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 1,
      matchedWithCorrectLabels: 1,
      recall: 1,
      labelAccuracy: 1,
      caseChecks: [
        { caseId: "identity-only", unread: false, matched: true, labelsCorrect: true },
      ],
    },
  },
  {
    name: "detects label mismatch on matched positives",
    cases: [
      positiveCase("label-mismatch", "mentions", "mention:email", "src/app.yml", 4, 4, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult([finding("mention:email", "src/app.yml", 4, 4, ["username"])]),
    ],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 1,
      matchedWithCorrectLabels: 0,
      recall: 1,
      labelAccuracy: 0,
      caseChecks: [
        { caseId: "label-mismatch", matched: true, labelsCorrect: false },
      ],
    },
  },
  {
    name: "counts unmatched scanner findings in exhaustive files as precision false positives",
    cases: [
      positiveCase("email-hit", "raw-hits", "raw_hit:email", "src/app.yml", 1, 1, ["user_email"], {
        exhaustiveScopeFiles: ["src/app.yml"],
      }),
    ],
    scanResults: [
      scanResult([
        finding("raw_hit:email", "src/app.yml", 1, 1, ["user_email"]),
        finding("raw_hit:username", "src/app.yml", 2, 2, ["username"]),
      ]),
    ],
    expect: {
      recall: 1,
      precision: 0.5,
    },
  },
  {
    name: "does not require a negative Stripe case to penalize extra Stripe hits",
    cases: [
      positiveCase("openai", "data-flows", "flow:app->third_party:openai", "app.py", 11, 11, [
        "api_call",
      ], {
        exhaustiveScopeFiles: ["app.py"],
      }),
    ],
    scanResults: [
      scanResult(
        [
          finding("flow:app->third_party:openai", "app.py", 11, 11, ["api_call"]),
          finding("flow:app->third_party:stripe", "app.py", 11, 11, ["api_call"]),
        ],
        ["app.py"],
      ),
    ],
    expect: {
      recall: 1,
      precision: 0.5,
    },
  },
  {
    name: "treats exhaustive-scope evidence as read when ingest omitted the file",
    cases: [
      positiveCase("jedis", "components", "asset:jedis", "pom.xml", 1, 1, ["database"], {
        exhaustiveScopeFiles: ["pom.xml"],
      }),
    ],
    scanResults: [
      scanResult([finding("asset:jedis", "pom.xml", 1, 1, ["database"])], []),
    ],
    expect: {
      unreadCount: 0,
      recall: 1,
      precision: 1,
    },
  },
  {
    name: "excludes locationless synthetic findings from the precision denominator",
    cases: [
      positiveCase("db", "components", "asset:pg", "db.ts", 1, 1, ["database"], {
        exhaustiveScopeFiles: ["db.ts"],
      }),
    ],
    scanResults: [
      scanResult([
        finding("asset:pg", "db.ts", 1, 1, ["database"]),
        { key: "actor:user", labels: [], sourceFilePaths: [], sourceLines: [] },
      ]),
    ],
    expect: {
      recall: 1,
      precision: 1,
    },
  },
  {
    name: "does not count unread negatives toward negativeCasePassRate",
    cases: [
      negativeCase("negative-unread", "raw-hits", "raw_hit:email", "src/missing.yml", 1, 1),
    ],
    scanResults: [scanResult([finding("raw_hit:email", "src/app.yml", 1, 1, ["user_email"])])],
    expect: {
      negativeCases: 0,
      negativeCasesPassed: 0,
      unreadCount: 1,
      negativeCasePassRate: null,
      caseChecks: [{ caseId: "negative-unread", unread: true, negativeClean: false }],
    },
  },
];

describe("scoreEvalCases", () => {
  describe.each(scoreScenarios)("$name", (scenario) => {
    it("scores cases as expected", () => {
      const report = scoreEvalCases(scenario.cases, scenario.scanResults);
      const { denominators } = report.scores;

      if (scenario.expect.evaluablePositives !== undefined) {
        expect(denominators.evaluablePositives).toBe(scenario.expect.evaluablePositives);
      }
      if (scenario.expect.matchedPositives !== undefined) {
        expect(denominators.matchedPositives).toBe(scenario.expect.matchedPositives);
      }
      if (scenario.expect.matchedWithCorrectLabels !== undefined) {
        expect(denominators.matchedWithCorrectLabels).toBe(
          scenario.expect.matchedWithCorrectLabels,
        );
      }
      if (scenario.expect.negativeCases !== undefined) {
        expect(denominators.negativeCases).toBe(scenario.expect.negativeCases);
      }
      if (scenario.expect.negativeCasesPassed !== undefined) {
        expect(denominators.negativeCasesPassed).toBe(scenario.expect.negativeCasesPassed);
      }
      if (scenario.expect.unreadCount !== undefined) {
        expect(report.scores.unreadCount).toBe(scenario.expect.unreadCount);
      }
      if (scenario.expect.recall !== undefined) {
        expect(report.scores.recall).toBe(scenario.expect.recall);
      }
      if (scenario.expect.labelAccuracy !== undefined) {
        expect(report.scores.labelAccuracy).toBe(scenario.expect.labelAccuracy);
      }
      if (scenario.expect.negativeCasePassRate !== undefined) {
        expect(report.scores.negativeCasePassRate).toBe(scenario.expect.negativeCasePassRate);
      }
      if (scenario.expect.precision !== undefined) {
        expect(report.scores.precision).toBe(scenario.expect.precision);
      }

      for (const check of scenario.expect.caseChecks ?? []) {
        const result = report.caseResults.find((entry) => entry.caseId === check.caseId);
        expect(result).toBeDefined();
        if (check.unread !== undefined) {
          expect(result!.unread).toBe(check.unread);
        }
        if (check.matched !== undefined) {
          expect(result!.matched).toBe(check.matched);
        }
        if (check.labelsCorrect !== undefined) {
          expect(result!.labelsCorrect).toBe(check.labelsCorrect);
        }
        if (check.negativeClean !== undefined) {
          expect(result!.negativeClean).toBe(check.negativeClean);
        }
        if (check.documentedGap !== undefined) {
          expect(result!.documentedGap).toBe(check.documentedGap);
        }
      }
    });
  });
});
