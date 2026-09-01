import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

export const duplicateFindingsScenarios: ContractScenario[] = [
  {
    name: "duplicate findings matching one gold row leave assignment ambiguous",
    cases: [
      positiveCase("gold-email", "mentions", "mention:email", "src/app.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [
          finding("mention:email", "src/app.yml", 1, 1, ["user_email"], "mentions"),
          finding("mention:email", "src/app.yml", 1, 1, ["user_email"], "mentions"),
        ],
        "mentions",
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
