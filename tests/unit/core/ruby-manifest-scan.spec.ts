import fs from "fs";
import os from "os";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "ruby-dependency-manifests-basic",
);

describe("structural scan - Ruby dependency manifests", () => {
  it("emits canonical components, declared flows, and Ruby parser stats", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-ruby-manifest-"));
    const serviceRoot = path.join(root, "services", "billing");
    fs.mkdirSync(serviceRoot, { recursive: true });
    fs.cpSync(FIXTURE_ROOT, serviceRoot, { recursive: true });

    try {
      const config = createDefaultScanConfiguration({
        enableAiInference: false,
      });
      const { scanResult, findings } = await scan(root, config);

      const stripeFinding = findings.find(
        (finding) =>
          finding.pattern === "external_api_call" &&
          finding.properties.serviceName === "stripe" &&
          finding.properties.sourceContext === "dependency_manifest",
      );
      expect(stripeFinding?.properties.packageVersion).toBe("13.2.0");

      const stripe = scanResult.components.find(
        (component) =>
          component.type === "third_party" &&
          component.properties.serviceName === "stripe",
      );
      expect(stripe).toBeDefined();
      expect(
        scanResult.dataFlows.some(
          (flow) =>
            flow.targetComponentId === stripe?.id,
        ),
      ).toBe(true);

      const rubyStats = scanResult.languageStats?.find(
        (stats) => stats.language === "ruby",
      );
      expect(rubyStats).toEqual(
        expect.objectContaining({
          filesParsed: 1,
          functionsIndexed: 1,
        }),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
