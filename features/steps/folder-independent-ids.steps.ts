import assert from "node:assert";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { After, Given, Then, When } from "@cucumber/cucumber";

import { createDefaultScanConfiguration, scan } from "../../src/core/pipeline/orchestrator";
import type { OrchestratorScanResult } from "../../src/core/pipeline/orchestrator-result";

const fixtureRoot = join(__dirname, "..", "fixtures", "folder-independent-ids");

interface FolderIdsWorld {
  workDir?: string;
  copies: Array<{ name: string; path: string; result?: OrchestratorScanResult }>;
}

function getWorld(context: unknown): FolderIdsWorld {
  const w = context as FolderIdsWorld;
  w.copies ??= [];
  return w;
}

Given("the folder-independent-ids fixture copied into a folder named {string}", function (name: string) {
  const w = getWorld(this);
  w.workDir ??= mkdtempSync(join(tmpdir(), "folder-ids-"));
  // Each copy gets its own parent, so only the folder name differs.
  const path = join(w.workDir, String(w.copies.length), name);
  cpSync(fixtureRoot, path, { recursive: true });
  w.copies.push({ name, path });
});

When("both copies are scanned without a project name", async function () {
  const w = getWorld(this);
  for (const copy of w.copies) {
    copy.result = await scan(copy.path, createDefaultScanConfiguration({ projectName: undefined, enableAiInference: false }));
  }
});

Then("both scans have the same component ids", function () {
  const w = getWorld(this);
  const [first, second] = w.copies.map((c) => c.result!.scanResult.components.map((component) => component.id).sort());
  assert.ok(first.length > 0, "expected components");
  assert.deepStrictEqual(second, first);
});

Then("the root Application component is named after its own folder in each scan", function () {
  const w = getWorld(this);
  for (const copy of w.copies) {
    const names = copy.result!.scanResult.components.map((c) => c.name);
    assert.ok(names.includes(copy.name), `expected a component named "${copy.name}" in ${JSON.stringify(names)}`);
  }
});

After({ tags: "@stable-ids" }, function () {
  const w = getWorld(this);
  if (w.workDir) rmSync(w.workDir, { recursive: true, force: true });
});
