import {
  enforceComponentTaxonomy,
  isValidSubtypeForType,
} from "../../../src/classifier/component-taxonomy";
import type { DetectedComponent } from "../../../src/core/types/component";

function component(
  overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

describe("classifier/component-taxonomy", () => {
  it("preserves declared subtypes", () => {
    const input = component({
      id: "c1",
      name: "pg",
      type: "asset",
      subType: "database",
    });
    const [output] = enforceComponentTaxonomy([input]);
    expect(output.subType).toBe("database");
    expect(isValidSubtypeForType("asset", "database")).toBe(true);
  });

  it("strips undeclared subtypes without dropping the component", () => {
    const input = component({
      id: "c2",
      name: "mystery",
      type: "asset",
      subType: "not_in_taxonomy",
    });
    const [output] = enforceComponentTaxonomy([input]);
    expect(output.subType).toBeUndefined();
    expect(output.name).toBe("mystery");
    expect(output.type).toBe("asset");
  });
});
