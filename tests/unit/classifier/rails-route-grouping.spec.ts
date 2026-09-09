import type { RawFinding } from "../../../src/core/types/detection";
import { classifyRawFindings } from "../../../src/classifier/component-factory";

function railsRoute(
  name: string,
  line: number,
  path = "session/sso",
): RawFinding {
  return {
    pattern: "express_route",
    name,
    confidence: 0.9,
    location: {
      filePath: "config/routes.rb",
      startLine: line,
      endLine: line,
      code: `get "${path}" => "session#sso"`,
    },
    properties: {
      framework: "rails",
      httpMethods: ["GET"],
      path,
      section_id: "root",
      section_label: "root",
    },
  };
}

describe("classifier Rails route grouping", () => {
  it("keeps each Rails routes.rb declaration as its own API component", () => {
    const components = classifyRawFindings([
      railsRoute("GET session/sso", 594, "session/sso"),
      railsRoute("GET session/sso_login", 595, "session/sso_login"),
    ]);

    expect(components).toHaveLength(2);
    expect(components.map((c) => c.sourceLocations[0]?.startLine).sort()).toEqual([
      594,
      595,
    ]);
    expect(components.every((c) => c.subType === "api")).toBe(true);
  });
});
