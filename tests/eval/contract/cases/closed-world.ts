import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

export const closedWorldScenarios: ContractScenario[] = [
  {
    name: "closed-world scope counts unmatched findings as precision false positives",
    cases: [
      positiveCase("scoped-hit", "raw-hits", "raw_hit:email", "src/app.yml", 1, 1, [
        "user_email",
      ], {
        exhaustiveScopeFiles: ["src/app.yml"],
      }),
    ],
    scanResults: [
      scanResult(
        [
          finding("raw_hit:email", "src/app.yml", 1, 1, ["user_email"]),
          finding("raw_hit:username", "src/app.yml", 2, 2, ["username"]),
        ],
        "raw-hits",
      ),
    ],
    expect: {
      recall: 1,
      precision: 0.5,
    },
  },
];
