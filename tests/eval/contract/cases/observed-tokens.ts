import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

export const observedTokenScenarios: ContractScenario[] = [
  {
    name: "observed subject name does not rescue identity mismatch in evaluateCanonical",
    cases: [
      positiveCase("gold-email", "mentions", "mention:email", "src/app.yml", 4, 4, [
        "user_email",
      ], {
        subject: { key: "mention:email", name: "sharedLegacyName" },
      }),
    ],
    scanResults: [
      scanResult(
        [finding("mention:username", "src/app.yml", 4, 4, ["username"], "mentions")],
        "mentions",
      ),
    ],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 0,
      recall: 0,
      caseChecks: [{ caseId: "gold-email", unread: false, matched: false }],
    },
  },
];
