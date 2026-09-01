import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "../types";
import { attributeGraphMatch } from "./attribution";

export function graphStrictCorrectness(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  return attributeGraphMatch(expectation, finding).strictCorrect;
}
