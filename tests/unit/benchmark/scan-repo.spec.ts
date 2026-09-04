import fs from "fs";
import os from "os";
import path from "path";

import * as personalDataInventory from "../../../src/eval-layers/personal-data-inventory";
import * as matchPiiSignals from "../../../src/pii-signals/match-pii-signals";
import { scanRepoByManifestLayers } from "../../benchmark/scan-repo";

describe("benchmark/scanRepoByManifestLayers personal-data inventory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-scan-repo-"));
    fs.writeFileSync(path.join(tempDir, "a.yml"), "username: app\n");
    fs.writeFileSync(path.join(tempDir, "b.yml"), "password: secret\n");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("matches personal-data signals once and projects all requested layers", async () => {
    const inventorySpy = jest.spyOn(personalDataInventory, "buildPersonalDataInventory");
    const matchSpy = jest.spyOn(matchPiiSignals, "matchPiiSignalsInFiles");

    const result = await scanRepoByManifestLayers("fixture", tempDir, [
      "mentions",
      "raw_hits",
      "data_items",
    ]);

    expect(inventorySpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).toHaveBeenCalledTimes(1);

    const mentions = result.findings.filter((finding) => finding.layer === "mentions");
    const rawHits = result.findings.filter((finding) => finding.layer === "raw-hits");
    const dataItems = result.findings.filter((finding) => finding.layer === "data-items");

    expect(mentions.length).toBeGreaterThan(0);
    expect(rawHits.length).toBeGreaterThan(0);
    expect(dataItems.length).toBeGreaterThan(0);

    const usernameItem = dataItems.find((finding) => finding.key === "data_item:username");
    expect(usernameItem?.sourceLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file_path: "a.yml", start_line: 1, end_line: 1 }),
      ]),
    );
  });
});
