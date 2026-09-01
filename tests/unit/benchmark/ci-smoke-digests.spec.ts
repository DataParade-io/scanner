import fs from "fs";
import path from "path";

import { digestCorpusGold, digestFile } from "../../benchmark/baseline/digests";
import { resolveScannerAdapterMapVersion } from "../../eval/canonical/scanner/manifest";

const PINS_DIR = path.join(__dirname, "../../fixtures/baseline/pins");
const PACKAGE_ROOT = path.join(__dirname, "../../..");
const BENCHMARK_ROOT = path.join(PACKAGE_ROOT, "tests/benchmark");

function readPinnedDigest(fileName: string): string {
  const raw = fs.readFileSync(path.join(PINS_DIR, fileName), "utf8");
  const line = raw
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("sha256:"));
  if (!line) {
    throw new Error(`Missing sha256 pin in ${fileName}`);
  }
  return line;
}

describe("ci smoke digest pins", () => {
  it("matches pinned corpus gold digest", () => {
    expect(digestCorpusGold(BENCHMARK_ROOT)).toBe(readPinnedDigest("corpus-gold.digest"));
  });

  it("matches pinned component taxonomy digest", () => {
    const taxonomyPath = path.join(PACKAGE_ROOT, "patterns/component-taxonomy.yaml");
    expect(digestFile(taxonomyPath)).toBe(readPinnedDigest("taxonomy.digest"));
  });

  it("matches pinned personal-data concept map digest", () => {
    const conceptMapPath = path.join(PACKAGE_ROOT, "patterns/personal-data-concept-map.yaml");
    expect(digestFile(conceptMapPath)).toBe(readPinnedDigest("concept-map.digest"));
  });

  it("matches pinned scanner adapter map digest", () => {
    expect(resolveScannerAdapterMapVersion()).toBe(readPinnedDigest("adapter-map.digest"));
  });
});
