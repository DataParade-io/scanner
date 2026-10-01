#!/usr/bin/env node
/**
 * Merge a concept's labeled packets and groups into mentions.yaml and add its
 * concept scope to layer-scopes.yaml (KDATAP-3ccf91; same shape as the email merges).
 *
 *   node dist/tests/benchmark/scripts/merge-concept-gold.js <repo> <concept> <packet-prefix> <subject-key>
 *   node dist/tests/benchmark/scripts/merge-concept-gold.js saleor phone KDATAP-3ccf91 mention:phone_number
 *
 * - Appends the normalized packet records, giving each positive mention in a group
 *   its `mention_attributes.group` from <concept>-groups.yaml. Mentions in
 *   needs_adjudication clusters stay ungrouped.
 * - Removes older mentions.yaml records for the same subject key on a line the
 *   packets label again (they are superseded).
 * - Appends a proposed concept scope to layer-scopes.yaml from <concept>-scope.yaml.
 * - Rewrites the corpus-gold digest pin.
 * Appends as text so existing records keep their formatting.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

import { digestCorpusGold } from "../baseline/digests";
import { resolveDefaultBenchmarkRoot } from "../paths";

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

function main(): void {
  const [repo, concept, prefix, subjectKey] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!repo || !concept || !prefix || !subjectKey) {
    console.error("Usage: merge-concept-gold <repo> <concept> <packet-prefix> <subject-key>");
    process.exit(1);
  }
  const benchmarkRoot = resolveDefaultBenchmarkRoot(__dirname);
  const repoDir = path.join(benchmarkRoot, "repos", repo);
  const packetsDir = path.join(repoDir, "annotations", "packets");
  const mentionsPath = path.join(repoDir, "annotations", "mentions.yaml");

  const input = YAML.parse(fs.readFileSync(path.join(packetsDir, `${concept}-grouping-input.yaml`), "utf8")) as {
    clusters: Record<string, { mentions: { id: string }[] }>;
  };
  const groups = YAML.parse(fs.readFileSync(path.join(packetsDir, `${concept}-groups.yaml`), "utf8")) as {
    groups: { id: string; clusters: string[] }[];
  };
  const groupOfMention = new Map<string, string>();
  for (const group of groups.groups) {
    for (const cluster of group.clusters) {
      for (const mention of input.clusters[cluster].mentions) groupOfMention.set(mention.id, group.id);
    }
  }

  const records: Record<string, any>[] = [];
  for (const name of fs.readdirSync(packetsDir).filter((n) => n.startsWith(prefix) && n.endsWith(".yaml")).sort()) {
    const parsed = YAML.parse(fs.readFileSync(path.join(packetsDir, name), "utf8")) as { annotations: Record<string, any>[] };
    records.push(...parsed.annotations);
  }
  for (const record of records) {
    const group = groupOfMention.get(record.id);
    if (group) record.mention_attributes = { ...record.mention_attributes, group };
  }

  // Supersede older records for the same subject key on lines the packets label again.
  let text = fs.readFileSync(mentionsPath, "utf8");
  const existing = YAML.parse(text) as { annotations: Record<string, any>[] };
  const labeled = new Set(records.map((r) => `${r.evidence.file_path}:${r.evidence.start_line}`));
  const existingIds = new Set(existing.annotations.map((a) => a.id));
  const superseded = existing.annotations.filter(
    (a) => a.subject?.key === subjectKey && labeled.has(`${a.evidence.file_path}:${a.evidence.start_line}`),
  );
  for (const old of superseded) {
    const start = text.indexOf(`  - id: ${old.id}\n`);
    const next = text.indexOf("\n  - id: ", start + 1);
    text = text.slice(0, start) + (next === -1 ? "" : text.slice(next + 1));
    existingIds.delete(old.id);
    console.log(`superseded ${old.id} (${old.provenance?.review_state})`);
  }
  const collisions = records.filter((r) => existingIds.has(r.id)).map((r) => r.id);
  if (collisions.length > 0) throw new Error(`id collisions: ${collisions.join(", ")}`);

  if (!text.endsWith("\n")) text += "\n";
  text += indent(YAML.stringify(records, { lineWidth: 0 }), 2).replace(/\n+$/, "\n");
  fs.writeFileSync(mentionsPath, text, "utf8");

  const scope = YAML.parse(fs.readFileSync(path.join(packetsDir, `${concept}-scope.yaml`), "utf8")) as {
    provenance: Record<string, string>;
    files: { path: string }[];
  };
  const scopesPath = path.join(repoDir, "layer-scopes.yaml");
  let scopes = fs.readFileSync(scopesPath, "utf8");
  if (!scopes.endsWith("\n")) scopes += "\n";
  const entry = [
    {
      subject_keys: [subjectKey],
      exhaustive_scope_files: scope.files.map((f) => f.path),
      provenance: scope.provenance,
    },
  ];
  if (!/^concept_scopes:/m.test(scopes)) scopes += "concept_scopes:\n  mentions:\n";
  scopes += indent(YAML.stringify(entry, { lineWidth: 0 }), 4);
  fs.writeFileSync(scopesPath, scopes, "utf8");

  const digest = digestCorpusGold(benchmarkRoot);
  const pin = path.join(benchmarkRoot, "..", "fixtures", "baseline", "pins", "corpus-gold.digest");
  fs.writeFileSync(pin, `# Pinned digest of all committed corpus gold YAML under tests/benchmark/repos/.\n${digest}\n`, "utf8");

  const positives = records.filter((r) => r.expected.status === "positive").length;
  console.log(`appended ${records.length} records (${positives} positive, ${groupOfMention.size} grouped); digest ${digest}`);
}

main();
