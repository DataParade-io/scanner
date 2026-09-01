import { contractScenarios } from "./cases";
import { assertContractExpect, runContractScenario } from "./harness";

describe("evaluator contract suite (synthetic golden data)", () => {
  describe.each(contractScenarios)("$name", (scenario) => {
    it("scores cases as expected", () => {
      const report = runContractScenario(scenario);
      assertContractExpect(report, scenario.expect, scenario.cases, scenario.scanResults);
    });
  });
});
