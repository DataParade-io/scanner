import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

export const duplicateFindingsScenarios: ContractScenario[] = [
  {
    name: "duplicate findings matching one gold row leave assignment ambiguous",
    cases: [
      positiveCase("gold-email", "occurrences", "occurrence:email", "src/app.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [
          finding("occurrence:email", "src/app.yml", 1, 1, ["user_email"], "occurrences"),
          finding("occurrence:email", "src/app.yml", 1, 1, ["user_email"], "occurrences"),
        ],
        "occurrences",
      ),
    ],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 0,
      matchedWithCorrectLabels: 0,
      recall: 0,
      caseChecks: [
        { caseId: "gold-email", unread: false, matched: false, labelsCorrect: false },
      ],
    },
  },
];
