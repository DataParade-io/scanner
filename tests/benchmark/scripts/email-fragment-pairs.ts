#!/usr/bin/env node
/**
 * Export mention fragments and labeled fragment pairs for merge evaluation (KDATAP-9afaa1).
 *
 *   node dist/tests/benchmark/scripts/email-fragment-pairs.js <grouping-report.json> <out-dir> [repo...]
 *
 * A fragment is one predicted group from deterministic grouping (or a single ungrouped
 * mention). Each fragment's gold label is the majority gold group of its mentions; a
 * fragment whose mentions disagree is flagged `mixed`. Every pair of fragments in a repo
 * is labeled `same` when their gold labels match. The report also gives the oracle-merge
 * ceiling: pairwise precision and recall if fragments were merged exactly by gold label.
 * Each fragment also carries `context`: a numbered code window (4 lines either side)
 * around its first lines, enough for a labeler with no file access.
 * Repos must be materialized.
 */
import fs from "fs";
import path from "path";

import { resolveDefaultBenchmarkRoot } from "../paths";

interface DetailRow {
  id: string;
  location: string;
  goldGroup: string;
  matched: boolean;
  predictedGroup: string | null;
}

interface Fragment {
  id: string;
  repo: string;
  name: string | null;
  gold: string;
  mixed: boolean;
  mentions: number;
  files: string[];
  lines: Array<{ location: string; code: string }>;
  context: Array<{ location: string; window: string }>;
}

const CONTEXT_LINES = 4;
const CONTEXT_WINDOWS = 4;

function pairwise(items: Array<[string, string | null]>): { tp: number; predicted: number; gold: number } {
  let tp = 0;
  let predicted = 0;
  let gold = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const sameGold = items[i][0] === items[j][0];
      const samePredicted = items[i][1] !== null && items[i][1] === items[j][1];
      if (sameGold) gold += 1;
      if (samePredicted) predicted += 1;
      if (sameGold && samePredicted) tp += 1;
    }
  }
  return { tp, predicted, gold };
}

function main(): void {
  const [reportPath, outDir, ...repoArgs] = process.argv.slice(2);
  if (!reportPath || !outDir) {
    console.error("Usage: email-fragment-pairs.js <grouping-report.json> <out-dir> [repo...]");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, { groupingDetail: DetailRow[] }>;
  const cacheRoot = path.join(resolveDefaultBenchmarkRoot(__dirname), ".cache", "repos");
  fs.mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown> = {};

  for (const repo of repoArgs.length > 0 ? repoArgs : Object.keys(report)) {
    const checkout = fs.readdirSync(cacheRoot).find((entry) => entry.startsWith(`${repo}@`));
    if (!checkout) throw new Error(`Repo ${repo} is not materialized under ${cacheRoot}`);
    const sources = new Map<string, string[]>();
    const sourceAt = (location: string): { lines: string[]; line: number } => {
      const at = location.lastIndexOf(":");
      const file = location.slice(0, at);
      if (!sources.has(file)) {
        sources.set(file, fs.readFileSync(path.join(cacheRoot, checkout, file), "utf8").split(/\r?\n/));
      }
      return { lines: sources.get(file)!, line: Number(location.slice(at + 1)) };
    };
    const codeAt = (location: string): string => {
      const { lines, line } = sourceAt(location);
      return (lines[line - 1] ?? "").trim();
    };
    const windowAt = (location: string): string => {
      const { lines, line } = sourceAt(location);
      const start = Math.max(1, line - CONTEXT_LINES);
      const end = Math.min(lines.length, line + CONTEXT_LINES);
      return lines
        .slice(start - 1, end)
        .map((text, offset) => `${start + offset}: ${text}`)
        .join("\n");
    };

    const rows = report[repo].groupingDetail.filter((row) => row.matched);
    const byFragment = new Map<string, DetailRow[]>();
    rows.forEach((row, index) => {
      const key = row.predictedGroup ?? `single:${index}`;
      byFragment.set(key, [...(byFragment.get(key) ?? []), row]);
    });

    const fragments: Fragment[] = [...byFragment.entries()].map(([key, members], index) => {
      const counts = new Map<string, number>();
      for (const member of members) counts.set(member.goldGroup, (counts.get(member.goldGroup) ?? 0) + 1);
      const [gold] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const files = [...new Set(members.map((member) => member.location.slice(0, member.location.lastIndexOf(":"))))];
      return {
        id: `${repo}-f${String(index + 1).padStart(3, "0")}`,
        repo,
        name: key.startsWith("single:") ? null : key,
        gold,
        mixed: counts.size > 1,
        mentions: members.length,
        files: files.sort(),
        lines: members.slice(0, 8).map((member) => ({ location: member.location, code: codeAt(member.location) })),
        context: members
          .slice(0, CONTEXT_WINDOWS)
          .map((member) => ({ location: member.location, window: windowAt(member.location) })),
      };
    });

    const pairs: Array<{ a: string; b: string; same: boolean }> = [];
    for (let i = 0; i < fragments.length; i += 1) {
      for (let j = i + 1; j < fragments.length; j += 1) {
        pairs.push({ a: fragments[i].id, b: fragments[j].id, same: fragments[i].gold === fragments[j].gold });
      }
    }

    fs.writeFileSync(path.join(outDir, `${repo}-fragments.jsonl`), fragments.map((f) => JSON.stringify(f)).join("\n") + "\n");
    fs.writeFileSync(path.join(outDir, `${repo}-fragment-pairs.jsonl`), pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");

    const fragmentOf = new Map<DetailRow, Fragment>();
    for (const fragment of fragments) {
      for (const member of byFragment.get(fragment.name ?? "") ?? []) fragmentOf.set(member, fragment);
    }
    const now = pairwise(rows.map((row) => [row.goldGroup, row.predictedGroup]));
    const oracle = pairwise(
      rows.map((row, index) => {
        const fragment = fragmentOf.get(row) ?? fragments.find((f) => f.name === null && f.lines[0]?.location === row.location);
        return [row.goldGroup, fragment ? `gold:${fragment.gold}` : `single:${index}`];
      }),
    );
    summary[repo] = {
      fragments: fragments.length,
      goldGroups: new Set(rows.map((row) => row.goldGroup)).size,
      mixedFragments: fragments.filter((f) => f.mixed).length,
      pairs: pairs.length,
      samePairs: pairs.filter((p) => p.same).length,
      now: { precision: now.tp / Math.max(now.predicted, 1), recall: now.tp / now.gold },
      oracleMerge: { precision: oracle.tp / Math.max(oracle.predicted, 1), recall: oracle.tp / oracle.gold },
    };
    console.log(`${repo}: ${JSON.stringify(summary[repo])}`);
  }
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

main();
