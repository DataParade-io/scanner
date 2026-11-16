import {
  loadStrideRules,
  strideComponentKind,
  strideThreatsForComponent,
  strideThreatsForFlow,
} from "../../../src/threats/stride";

/** STRIDE per element (DATAP-914). */

const categories = (threats: Array<{ category: string }>) => threats.map((t) => t.category);

describe("STRIDE per element", () => {
  it("loads the table", () => {
    const rules = loadStrideRules();
    expect(rules.framework).toBe("stride");
    expect(rules.categories.map((c) => c.id)).toEqual(["S", "T", "R", "I", "D", "E"]);
  });

  it("maps component types to element kinds", () => {
    expect(strideComponentKind({ type: "actor", subType: "customer" })).toBe("external_entity");
    expect(strideComponentKind({ type: "third_party", subType: "ai_provider" })).toBe("external_entity");
    expect(strideComponentKind({ type: "asset", subType: "database" })).toBe("data_store");
    expect(strideComponentKind({ type: "asset", subType: "storage" })).toBe("data_store");
    expect(strideComponentKind({ type: "asset", subType: "application" })).toBe("process");
    expect(strideComponentKind({ type: "asset" })).toBe("process");
  });

  it("gives each kind its categories, all unknown, in S T R I D E order", () => {
    expect(categories(strideThreatsForComponent({ type: "third_party", subType: "saas_service" }))).toEqual(["S", "R"]);
    expect(categories(strideThreatsForComponent({ type: "asset", subType: "service" }))).toEqual([
      "S",
      "T",
      "R",
      "I",
      "D",
      "E",
    ]);
    expect(categories(strideThreatsForComponent({ type: "asset", subType: "database" }))).toEqual(["T", "R", "I", "D"]);
    const flow = strideThreatsForFlow();
    expect(categories(flow)).toEqual(["T", "I", "D"]);
    expect(flow.every((t) => t.status === "unknown" && t.framework === "stride")).toBe(true);
    expect(flow[0]!.ruleId).toBe("stride/v2/data_flow");
  });
});
