import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

const VALID_PATH = "src/app.yml";

export const pathContractScenarios: ContractScenario[] = [
  {
    name: "normalizes leading ./ and backslashes for evidence paths",
    cases: [
      positiveCase("normalized-path", "mentions", "mention:email", "./src\\app.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [finding("mention:email", VALID_PATH, 1, 1, ["user_email"], "mentions")],
        "mentions",
        [{ path: VALID_PATH, reason: "successfully_processed" }],
      ),
    ],
    expect: {
      evaluablePositives: 1,
      matchedPositives: 1,
      recall: 1,
      caseChecks: [
        {
          caseId: "normalized-path",
          unread: false,
          matched: true,
          eligibilityReason: "successfully_processed",
        },
      ],
    },
  },
  {
    name: "rejects absolute evidence paths at evaluator boundary",
    cases: [
      positiveCase("absolute-path", "mentions", "mention:email", "/etc/passwd", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [finding("mention:email", VALID_PATH, 1, 1, ["user_email"], "mentions")],
        "mentions",
        [{ path: VALID_PATH, reason: "successfully_processed" }],
      ),
    ],
    expect: {
      evaluablePositives: 0,
      unreadCount: 1,
      recall: null,
      caseChecks: [
        {
          caseId: "absolute-path",
          unread: true,
          matched: false,
          eligibilityReason: "missing_or_path_contract_mismatch",
        },
      ],
    },
  },
  {
    name: "rejects traversing evidence paths at evaluator boundary",
    cases: [
      positiveCase("traversing-path", "mentions", "mention:email", "../secret.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [finding("mention:email", VALID_PATH, 1, 1, ["user_email"], "mentions")],
        "mentions",
        [{ path: VALID_PATH, reason: "successfully_processed" }],
      ),
    ],
    expect: {
      evaluablePositives: 0,
      unreadCount: 1,
      recall: null,
      caseChecks: [
        {
          caseId: "traversing-path",
          unread: true,
          matched: false,
          eligibilityReason: "missing_or_path_contract_mismatch",
        },
      ],
    },
  },
  {
    name: "rejects malformed evidence paths at evaluator boundary",
    cases: [
      positiveCase("malformed-path", "mentions", "mention:email", "src//app.yml", 1, 1, [
        "user_email",
      ]),
    ],
    scanResults: [
      scanResult(
        [finding("mention:email", VALID_PATH, 1, 1, ["user_email"], "mentions")],
        "mentions",
        [{ path: VALID_PATH, reason: "successfully_processed" }],
      ),
    ],
    expect: {
      evaluablePositives: 0,
      unreadCount: 1,
      recall: null,
      caseChecks: [
        {
          caseId: "malformed-path",
          unread: true,
          matched: false,
          eligibilityReason: "missing_or_path_contract_mismatch",
        },
      ],
    },
  },
];
