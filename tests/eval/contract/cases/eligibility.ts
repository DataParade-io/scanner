import type { EligibilityReason } from "../../../../src/ingest/eligibility";
import type { ContractScenario } from "../types";
import { finding, positiveCase, scanResult } from "../harness";

const EVIDENCE_PATH = "src/target.yml";

function eligibilityScenario(
  reason: EligibilityReason,
  readable: boolean,
): ContractScenario {
  const id = `eligibility-${reason}`;
  return {
    name: `eligibility reason ${reason} ${readable ? "is readable" : "excludes case from recall"}`,
    cases: [
      positiveCase(id, "mentions", "mention:email", EVIDENCE_PATH, 1, 1, ["user_email"]),
    ],
    scanResults: [
      scanResult([], "mentions", [{ path: EVIDENCE_PATH, reason }]),
    ],
    expect: {
      evaluablePositives: readable ? 1 : 0,
      matchedPositives: 0,
      unreadCount: readable ? 0 : 1,
      recall: readable ? 0 : null,
      caseChecks: [
        {
          caseId: id,
          unread: !readable,
          matched: false,
          eligibilityReason: reason,
        },
      ],
    },
  };
}

export const eligibilityScenarios: ContractScenario[] = [
  eligibilityScenario("successfully_processed", true),
  eligibilityScenario("unsupported_file_type_or_language", false),
  eligibilityScenario("excluded_by_configured_policy", false),
  eligibilityScenario("ignored_by_repository_default_policy", false),
  eligibilityScenario("sensitive_path_exclusion", false),
  eligibilityScenario("file_too_large", false),
  eligibilityScenario("file_count_cap_reached", false),
  eligibilityScenario("total_byte_cap_reached", false),
  eligibilityScenario("missing_or_path_contract_mismatch", false),
  eligibilityScenario("read_decode_error", false),
  eligibilityScenario("parse_or_layer_processing_error", false),
];
