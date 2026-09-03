import path from "path";

import {
  BASELINE_READINESS_POLICY,
  BASELINE_READINESS_POLICY_VERSION,
  checkLayerPopulationFloors,
  checkLegacyOutcomesResolved,
  checkNoLegacyIdentityOnAccepted,
  collectGoldPopulation,
  evaluateBaselineReadiness,
  toHeadlineLayer,
} from "../../benchmark/baseline";
import type { GoldPopulationStats } from "../../benchmark/baseline/types";

const BENCHMARK_ROOT = path.join(__dirname, "../../benchmark");

describe("baseline readiness policy", () => {
  it("locks the approved policy version and floors", () => {
    expect(BASELINE_READINESS_POLICY_VERSION).toBe("baseline-readiness-policy/1");
    expect(BASELINE_READINESS_POLICY.layerFloors.components).toEqual({
      minAcceptedCanonicalCount: 450,
      minDistinctPackets: 25,
    });
    expect(BASELINE_READINESS_POLICY.layerFloors.mentions).toEqual({
      minAcceptedCanonicalCount: 50,
      minDistinctPackets: 15,
    });
    expect(BASELINE_READINESS_POLICY.layerFloors["data-items"]).toEqual({
      minAcceptedCanonicalCount: 100,
      minDistinctPackets: 12,
    });
    expect(BASELINE_READINESS_POLICY.flowSubset).toEqual({
      eligibleDispositionCandidates: ["graph_edge", "intra_component_lineage"],
      minAcceptedCanonicalCount: 1,
      minDistinctPackets: 1,
      minDistinctFlowTypes: 1,
    });
  });
});

describe("toHeadlineLayer", () => {
  it("maps corpus layer names to headline layers", () => {
    expect(toHeadlineLayer("data_items")).toBe("data-items");
    expect(toHeadlineLayer("data_flows")).toBe("data-flows");
    expect(toHeadlineLayer("pii_signals")).toBe("mentions");
    expect(toHeadlineLayer("components")).toBe("components");
    expect(toHeadlineLayer("raw_hits")).toBeNull();
  });
});

describe("collectGoldPopulation layer mapping", () => {
  it("counts accepted canonical data-items and components on develop", () => {
    const population = collectGoldPopulation(BENCHMARK_ROOT);
    expect(population.byLayer["data-items"].acceptedCanonicalCount).toBeGreaterThanOrEqual(100);
    expect(population.byLayer["data-items"].packetDiversity.distinctPackets).toBeGreaterThanOrEqual(
      12,
    );
    expect(population.byLayer.components.acceptedCanonicalCount).toBeGreaterThanOrEqual(450);
    expect(population.byLayer.components.packetDiversity.distinctPackets).toBeGreaterThanOrEqual(
      25,
    );
    expect(population.byLayer.mentions.acceptedCanonicalCount).toBeGreaterThanOrEqual(50);
  });

  it("counts promoted accepted canonical data-flows", () => {
    const population = collectGoldPopulation(BENCHMARK_ROOT);
    expect(population.byLayer["data-flows"].acceptedCanonicalCount).toBeGreaterThanOrEqual(158);
    expect(population.byLayer["data-flows"].packetDiversity.distinctPackets).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("checkLayerPopulationFloors", () => {
  it("passes when all floors are met", () => {
    const goldPopulation: GoldPopulationStats = {
      byLayer: {
        mentions: {
          acceptedCanonicalCount: 79,
          evaluablePositiveCount: 79,
          packetDiversity: { distinctPackets: 22, packetKeys: ["a"] },
          distinctConceptLeaves: 4,
        },
        "data-items": {
          acceptedCanonicalCount: 113,
          evaluablePositiveCount: 113,
          packetDiversity: { distinctPackets: 20, packetKeys: ["a"] },
          distinctConceptLeaves: 10,
        },
        components: {
          acceptedCanonicalCount: 519,
          evaluablePositiveCount: 519,
          packetDiversity: { distinctPackets: 29, packetKeys: ["a"] },
          distinctConceptLeaves: 13,
        },
        "data-flows": {
          acceptedCanonicalCount: 1,
          evaluablePositiveCount: 1,
          packetDiversity: { distinctPackets: 1, packetKeys: ["a"] },
          distinctConceptLeaves: 1,
        },
      },
    };

    expect(checkLayerPopulationFloors(goldPopulation)).toEqual([]);
  });

  it("reports FLOW_NO_CANONICAL_ACCEPTS when flow subset floor is unmet", () => {
    const goldPopulation: GoldPopulationStats = {
      byLayer: {
        mentions: {
          acceptedCanonicalCount: 79,
          evaluablePositiveCount: 79,
          packetDiversity: { distinctPackets: 22, packetKeys: [] },
          distinctConceptLeaves: 4,
        },
        "data-items": {
          acceptedCanonicalCount: 113,
          evaluablePositiveCount: 113,
          packetDiversity: { distinctPackets: 20, packetKeys: [] },
          distinctConceptLeaves: 10,
        },
        components: {
          acceptedCanonicalCount: 519,
          evaluablePositiveCount: 519,
          packetDiversity: { distinctPackets: 29, packetKeys: [] },
          distinctConceptLeaves: 13,
        },
        "data-flows": {
          acceptedCanonicalCount: 0,
          evaluablePositiveCount: 0,
          packetDiversity: { distinctPackets: 0, packetKeys: [] },
          distinctConceptLeaves: 0,
        },
      },
    };

    const blockers = checkLayerPopulationFloors(goldPopulation);
    expect(blockers.some((blocker) => blocker.code === "FLOW_NO_CANONICAL_ACCEPTS")).toBe(true);
  });
});

describe("checkLegacyOutcomesResolved", () => {
  it("reports no proposed rows on legacy layers in develop", () => {
    expect(checkLegacyOutcomesResolved(BENCHMARK_ROOT)).toEqual([]);
  });
});

describe("checkNoLegacyIdentityOnAccepted", () => {
  it("reports no loader exemptions after negative decoy review_state fix (KDATAP-b702ea)", () => {
    const blockers = checkNoLegacyIdentityOnAccepted(BENCHMARK_ROOT);
    const loaderExemptions = blockers.filter((blocker) => blocker.code === "LOADER_EXEMPTION");
    expect(loaderExemptions).toEqual([]);
  });
});

describe("evaluateBaselineReadiness dry run", () => {
  it("passes on develop without flow canonical blockers after promotion", () => {
    const goldPopulation = collectGoldPopulation(BENCHMARK_ROOT);
    const readiness = evaluateBaselineReadiness({
      benchmarkRoot: BENCHMARK_ROOT,
      goldPopulation,
      migrationIncomplete: { total: 0, byReason: {}, byLayer: {} },
      requireMaterializations: false,
      requireRuntimeChecks: false,
    });

    expect(readiness.status).toBe("pass");
    expect(readiness.evaluatedAt).toBeTruthy();
    expect(readiness.blockers.some((blocker) => blocker.code === "FLOW_NO_CANONICAL_ACCEPTS")).toBe(
      false,
    );
    expect(
      readiness.blockers.some(
        (blocker) => blocker.code === "LOADER_EXEMPTION" && blocker.layer === "data-flows",
      ),
    ).toBe(false);
    expect(readiness.blockers.some((blocker) => blocker.code === "FLOW_NO_ENDPOINTS")).toBe(false);
    expect(
      readiness.blockers.some(
        (blocker) => blocker.code === "LOADER_EXEMPTION" && blocker.layer === "components",
      ),
    ).toBe(false);
    expect(readiness.blockers).toHaveLength(0);
  });
});
