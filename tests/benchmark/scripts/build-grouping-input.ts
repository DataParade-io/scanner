#!/usr/bin/env node
/**
 * Build <concept>-grouping-input.yaml from labeled packets (KDATAP-3ccf91).
 *
 *   node dist/tests/benchmark/scripts/build-grouping-input.js <repo> <concept> <packet-prefix>
 *   node dist/tests/benchmark/scripts/build-grouping-input.js saleor phone KDATAP-3ccf91
 *
 * Reads every `<packet-prefix>*.yaml` packet in annotations/packets/ and clusters the
 * positive occurrences by shared declaration (file:line). Positive occurrences with no
 * declaration (field-name strings, keys) are single-occurrence clusters. Clusters are
 * numbered c001... in declaration file and line order.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

import { resolveDefaultBenchmarkRoot } from "../paths";

interface PacketRecord {
  id: string;
  subject: { name: string };
  evidence: { file_path: string; start_line: number };
  expected: { status: string };
  occurrence_attributes?: {
    syntax_kind?: string;
    declaration?: { file_path: string; line: number } | "unresolved";
  };
}

interface Entry {
  key: string;
  file: string;
  line: number;
  occurrence: Record<string, unknown>;
}

function main(): void {
  const [repo, concept, prefix] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!repo || !concept || !prefix) {
    console.error("Usage: build-grouping-input <repo> <concept> <packet-prefix>");
    process.exit(1);
  }
  const root = resolveDefaultBenchmarkRoot(__dirname);
  const packetsDir = path.join(root, "repos", repo, "annotations", "packets");
  const batches = fs
    .readdirSync(packetsDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".yaml"))
    .sort();

  const entries: Entry[] = [];
  for (const batch of batches) {
    const parsed = YAML.parse(fs.readFileSync(path.join(packetsDir, batch), "utf8")) as {
      annotations: PacketRecord[];
    };
    const batchName = batch.replace(/\.yaml$/, "");
    for (const record of parsed.annotations) {
      if (record.expected.status !== "positive") continue;
      const attrs = record.occurrence_attributes ?? {};
      const decl = attrs.declaration;
      const hasDecl = decl !== undefined && decl !== "unresolved";
      const file = hasDecl ? decl.file_path : record.evidence.file_path;
      const line = hasDecl ? decl.line : record.evidence.start_line;
      const key = hasDecl ? `${file}:${line}` : `${file}:${line} (no shared declaration)`;
      const lineText = fs
        .readFileSync(path.join(root, ".cache", "repos", `${repo}@${commitOf(root, repo)}`, record.evidence.file_path), "utf8")
        .split("\n")[record.evidence.start_line - 1]
        .trim();
      entries.push({
        key: hasDecl ? key : `${key}#${record.id}`,
        file,
        line,
        occurrence: {
          id: record.id,
          batch: batchName,
          file: record.evidence.file_path,
          line: record.evidence.start_line,
          name: record.subject.name,
          syntax_kind: attrs.syntax_kind,
          text: lineText,
        },
      });
    }
  }

  const byKey = new Map<string, Entry[]>();
  for (const entry of entries) {
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  }
  const ordered = [...byKey.values()].sort(
    (a, b) => a[0].file.localeCompare(b[0].file) || a[0].line - b[0].line,
  );
  const clusters: Record<string, unknown> = {};
  ordered.forEach((members, index) => {
    const first = members[0];
    const shared = members.length > 1 || !first.key.includes("#");
    clusters[`c${String(index + 1).padStart(3, "0")}`] = {
      declaration: shared ? first.key : `${first.file}:${first.line} (no shared declaration)`,
      occurrences: members
        .map((member) => member.occurrence)
        .sort((a, b) => String(a.file).localeCompare(String(b.file)) || Number(a.line) - Number(b.line)),
    };
  });

  const outPath = path.join(packetsDir, `${concept}-grouping-input.yaml`);
  fs.writeFileSync(
    outPath,
    YAML.stringify({ repo, concept, positive_occurrences: entries.length, clusters }),
    "utf8",
  );
  console.log(`${entries.length} positive occurrences in ${ordered.length} clusters -> ${outPath}`);
}

function commitOf(root: string, repo: string): string {
  const manifest = YAML.parse(fs.readFileSync(path.join(root, "repos", repo, "manifest.yaml"), "utf8")) as {
    commit: string;
  };
  return manifest.commit;
}

main();
