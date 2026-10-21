/**
 * Writes vocabulary.json: the closed vocabularies for agent `facts.json`.
 *
 * INTERIM. The ontology export (DATAP-740) will replace this file. Until then:
 *  - component types and flow types are read from the scanner's own type unions
 *    (src/core/types/component.ts, data-flow.ts);
 *  - component subTypes have no enum in the scanner, so they are the distinct
 *    (type, subType) pairs that appear in the accepted benchmark gold labels.
 *
 * Run: node dist/tests/benchmark/agents/export-vocabulary.js
 */
import fs from "fs";
import path from "path";

import { findPackageRoot } from "../paths";
import { listBenchmarkRepoKeys } from "../run-benchmark";
import { loadAnnotations } from "../manifest";

function unionMembers(source: string, typeName: string): string[] {
  const match = new RegExp(`export type ${typeName}\\s*=([^;]+);`).exec(source);
  if (!match) {
    throw new Error(`type ${typeName} not found`);
  }
  return [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

export function buildVocabulary(root: string): Record<string, unknown> {
  const componentSrc = fs.readFileSync(path.join(root, "src/core/types/component.ts"), "utf8");
  const flowSrc = fs.readFileSync(path.join(root, "src/core/types/data-flow.ts"), "utf8");
  const componentTypes = unionMembers(componentSrc, "ComponentType");
  const flowTypes = unionMembers(flowSrc, "DataFlowType");

  const subTypes: Record<string, Set<string>> = {};
  for (const type of componentTypes) {
    subTypes[type] = new Set();
  }
  const reposRoot = path.join(root, "tests/benchmark/repos");
  for (const key of listBenchmarkRepoKeys()) {
    const repoDir = path.join(reposRoot, key);
    for (const annotation of loadAnnotations(repoDir, "components")) {
      if (annotation.provenance.review_state !== "accepted") continue;
      const [type] = annotation.subject.key.split(":");
      const sub = annotation.canonical?.component_subtype;
      if (sub && subTypes[type]) subTypes[type].add(sub);
    }
  }

  return {
    status: "interim - replaced by the ontology export (DATAP-740)",
    componentTypes,
    componentSubTypes: Object.fromEntries(
      Object.entries(subTypes).map(([type, set]) => [type, [...set].sort()]),
    ),
    flowTypes,
  };
}

if (require.main === module) {
  const root = findPackageRoot(__dirname);
  const out = path.join(root, "tests/benchmark/agents/vocabulary.json");
  fs.writeFileSync(out, `${JSON.stringify(buildVocabulary(root), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
