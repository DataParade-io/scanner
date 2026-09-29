#!/usr/bin/env node
/**
 * Email-only provisional baseline with a per-case breakdown (KDATAP-1c4998).
 *
 *   node dist/tests/benchmark/scripts/email-baseline-breakdown.js <out.json> [repo...]
 *
 * Scores only the email labeling packet records against only the email concept
 * scope (layer-wide scopes are ignored), then breaks results down by syntax kind,
 * status, and declaration group. Repos must be materialized.
 */
import fs from "fs";

import { runBenchmarkRepo } from "../run-benchmark";
import { scoreEvalCases } from "../../eval/score";
import type { EvalCase } from "../../eval/types";

type Counts = Record<string, { total: number; hit: number }>;

function bump(counts: Counts, key: string, hit: boolean): void {
  counts[key] ??= { total: 0, hit: 0 };
  counts[key].total += 1;
  if (hit) counts[key].hit += 1;
}

async function main(): Promise<void> {
  const [outPath, ...repoArgs] = process.argv.slice(2);
  const repos = repoArgs.length > 0 ? repoArgs : ["ghost", "saleor"];
  const summary: Record<string, unknown> = {};

  for (const repoKey of repos) {
    const result = await runBenchmarkRepo(repoKey, { includeProposed: true });
    // After the KDATAP-1c4998 correction, every mention:email label in these repos comes from the packets.
    const cases: EvalCase[] = result.evalCases
      .filter((c) => c.layer === "mentions" && c.subject.key === "mention:email")
      .map((c) => ({ ...c, exhaustiveScopeFiles: undefined }));
    const emailFindings = result.scanResult.findings.filter(
      (finding) => (finding.layer === undefined || finding.layer === "mentions") && (finding.key === "mention:email" || finding.key.startsWith("mention:email:")),
    );
    const report = scoreEvalCases(cases, [{ ...result.scanResult, findings: emailFindings }]);

    const byKind: Counts = {};
    const negativesFlaggedByKind: Counts = {};
    const recallByGroup: Counts = {};
    const outcome = new Map(report.caseResults.map((r) => [r.caseId, r]));
    for (const c of cases) {
      const r = outcome.get(c.id);
      if (!r) continue;
      const kind = c.mentionAttributes?.syntax_kind ?? "unknown";
      if (c.expected.status === "positive") {
        bump(byKind, kind, r.matched);
        bump(recallByGroup, c.mentionAttributes?.group ?? "(no group)", r.matched);
      } else if (c.expected.status === "negative") {
        bump(negativesFlaggedByKind, kind, !r.negativeClean);
      }
    }
    // Per positive mention: gold group and the scanner's group on the same line.
    const findingGroupByLine = new Map<string, string | null>();
    for (const finding of emailFindings) {
      for (const line of finding.sourceLines ?? []) {
        findingGroupByLine.set(`${line.file_path}:${line.start_line}`, finding.mentionAttributes?.group ?? null);
      }
    }
    const groupingDetail = cases
      .filter((c) => c.expected.status === "positive" && c.mentionAttributes?.group)
      .map((c) => {
        const location = `${c.evidence?.file_path}:${c.evidence?.start_line}`;
        return {
          id: c.id,
          location,
          goldGroup: c.mentionAttributes?.group,
          matched: outcome.get(c.id)?.matched ?? false,
          predictedGroup: findingGroupByLine.get(location) ?? null,
        };
      });
    summary[repoKey] = {
      cases: cases.length,
      emailFindings: emailFindings.length,
      scores: {
        recall: report.scores.recall,
        precision: report.scores.precision,
        negativeCasePassRate: report.scores.negativeCasePassRate,
        denominators: report.scores.denominators,
        mentionAttributes: report.scores.mentionAttributes,
        grouping: report.scores.grouping,
      },
      recallBySyntaxKind: byKind,
      negativesFlaggedBySyntaxKind: negativesFlaggedByKind,
      recallByGroup,
      groupingDetail,
    };
    console.log(`${repoKey}: ${cases.length} email cases, ${emailFindings.length} email findings, recall ${report.scores.recall}, precision ${report.scores.precision}`);
  }

  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
