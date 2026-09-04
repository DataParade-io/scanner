import { rollupEntityCoverage } from "./rollup";
import { createLayerLedger } from "./types";
import { layerOutcome } from "../../../src/ingest/eligibility";

describe("entity evidence coverage rollup", () => {
  const ledger = createLayerLedger("components", [
    layerOutcome("a.ts", "successfully_processed"),
    layerOutcome("b.ts", "unsupported_file_type_or_language"),
    layerOutcome("c.ts", "successfully_processed"),
  ]);

  it("reports full coverage when all locations processed", () => {
    const rollup = rollupEntityCoverage("asset:db", "components", ["a.ts", "c.ts"], ledger);
    expect(rollup.coverage).toBe("full");
    expect(rollup.eligible).toBe(true);
  });

  it("reports partial coverage when some locations processed", () => {
    const rollup = rollupEntityCoverage("asset:db", "components", ["a.ts", "b.ts"], ledger);
    expect(rollup.coverage).toBe("partial");
    expect(rollup.eligible).toBe(true);
  });

  it("reports none when no locations processed", () => {
    const rollup = rollupEntityCoverage("asset:db", "components", ["b.ts"], ledger);
    expect(rollup.coverage).toBe("none");
    expect(rollup.eligible).toBe(false);
  });
});
