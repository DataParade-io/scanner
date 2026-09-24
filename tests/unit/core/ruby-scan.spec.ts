import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

const FIXTURE_ROOT = path.join(__dirname, "..", "..", "fixtures", "ruby-basic");

describe("structural scan - Ruby on Rails", () => {
  it("models runtime boundaries without turning MVC classes into components", async () => {
    const { scanResult } = await scan(
      FIXTURE_ROOT,
      createDefaultScanConfiguration({ enableAiInference: false }),
    );

    const databases = scanResult.components.filter(
      (component) =>
        component.type === "asset" && component.subType === "database",
    );
    expect(databases).toHaveLength(1);
    expect(databases[0].properties.databaseType).toBe("postgres");

    const caches = scanResult.components.filter(
      (component) =>
        component.type === "asset" && component.subType === "cache",
    );
    expect(caches).toHaveLength(1);
    expect(caches[0].properties.databaseType).toBe("redis");

    const apiComponents = scanResult.components.filter(
      (component) => component.type === "asset" && component.subType === "api",
    );
    expect(apiComponents).toHaveLength(1);

    const thirdParties = scanResult.components
      .filter((component) => component.type === "third_party")
      .map((component) => component.properties.serviceName);
    expect(thirdParties).toEqual(expect.arrayContaining(["aws", "stripe"]));

    const componentNames = scanResult.components.map((component) =>
      component.name.toLowerCase(),
    );
    expect(componentNames).not.toEqual(
      expect.arrayContaining([
        "user",
        "post",
        "searchable",
        "users controller",
        "payment sync",
      ]),
    );

    expect(
      scanResult.dataFlows.some(
        (flow) => flow.sourceComponentId === flow.targetComponentId,
      ),
    ).toBe(false);
    expect(
      scanResult.dataFlows.some(
        (flow) =>
          flow.targetComponentId === databases[0].id &&
          flow.type === "database_query",
      ),
    ).toBe(true);
    expect(
      scanResult.dataFlows.some(
        (flow) =>
          thirdParties.includes(
            scanResult.components.find(
              (component) => component.id === flow.targetComponentId,
            )?.properties.serviceName,
          ) && flow.type === "api_call",
      ),
    ).toBe(true);
  });

  it("keeps component count stable when another ActiveRecord model is added", async () => {
    const { scanResult } = await scan(
      FIXTURE_ROOT,
      createDefaultScanConfiguration({ enableAiInference: false }),
    );

    expect(scanResult.components.length).toBeLessThanOrEqual(8);
    expect(
      scanResult.components.filter(
        (component) =>
          component.type === "asset" && component.subType === "database",
      ),
    ).toHaveLength(1);
  });
});
