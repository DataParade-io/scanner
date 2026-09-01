import { duplicateFindingsScenarios } from "./duplicate-findings";
import { eligibilityScenarios } from "./eligibility";
import { closedWorldScenarios } from "./closed-world";
import { observedTokenScenarios } from "./observed-tokens";
import { pathContractScenarios } from "./paths";
import { zeroPositiveScopeScenarios } from "./zero-positive-scope";

export const contractScenarios = [
  ...eligibilityScenarios,
  ...duplicateFindingsScenarios,
  ...zeroPositiveScopeScenarios,
  ...pathContractScenarios,
  ...observedTokenScenarios,
  ...closedWorldScenarios,
];
