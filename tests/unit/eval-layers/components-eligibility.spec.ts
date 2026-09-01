import fs from "fs";
import os from "os";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import { buildOrchestratorEvalLedgers } from "../../../src/eval-layers/fixture-scan-ledger";
import { eligibleProcessedPaths } from "../../eval/eligibility/ledger-access";
import { createLayerLedger } from "../../eval/eligibility/types";
import { layerOutcome } from "../../../src/ingest/eligibility";

describe("components layer eligibility", () => {
  it("does not treat ingest-only php as components-eligible without layer success", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-php-elig-"));
    try {
      fs.writeFileSync(
        path.join(tempDir, "index.php"),
        "<?php echo 'hello';\n",
      );
      fs.writeFileSync(path.join(tempDir, "config.json"), '{"name":"app"}\n');

      const config = createDefaultScanConfiguration({ enableAiInference: false });
      const { ledgerContext } = await scan(tempDir, config);
      expect(ledgerContext).toBeDefined();

      const ledgers = buildOrchestratorEvalLedgers(ledgerContext!);
      const componentsLedger = createLayerLedger("components", ledgers.components ?? []);
      const eligible = eligibleProcessedPaths(componentsLedger);

      expect(eligible).toContain("index.php");
      expect(eligible).not.toContain("config.json");

      const ingestOnlyLedger = createLayerLedger("components", [
        layerOutcome("config.json", "successfully_processed"),
      ]);
      expect(eligibleProcessedPaths(ingestOnlyLedger)).toEqual(["config.json"]);
      expect(eligibleProcessedPaths(componentsLedger)).not.toEqual(
        eligibleProcessedPaths(ingestOnlyLedger),
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
