import type { ContractScenario } from "../types";
import { finding, negativeCase, scanResult } from "../harness";

export const zeroPositiveScopeScenarios: ContractScenario[] = [
  {
    name: "zero-positive reviewed scope still scores precision on scoped findings",
    cases: [
      negativeCase("reviewed-negative", "raw-hits", "raw_hit:email", "src/app.yml", 1, 1, {
        exhaustiveScopeFiles: ["src/app.yml"],
      }),
    ],
    scanResults: [
      scanResult(
        [
          finding("raw_hit:username", "src/app.yml", 2, 2, ["username"]),
          finding("raw_hit:password", "src/app.yml", 3, 3, ["password"]),
        ],
        "raw-hits",
      ),
    ],
    expect: {
      evaluablePositives: 0,
      matchedPositives: 0,
      negativeCases: 1,
      negativeCasesPassed: 1,
      recall: null,
      precision: 0,
      caseChecks: [
        { caseId: "reviewed-negative", unread: false, matched: false, negativeClean: true },
      ],
    },
  },
];
