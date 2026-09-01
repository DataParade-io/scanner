import { HEADLINE_LAYERS } from "../../eval/score";
import {
  formatMetricScore,
  formatRate,
} from "../scorecard-vector";
import type { BaselineArtifact } from "./types";

function renderPredecessor(predecessor: string | null): string {
  return predecessor ?? "none";
}

function renderKeyValueLines(entries: Array<[string, string]>): string[] {
  return entries.map(([key, value]) => `- ${key}: ${value}`);
}

function renderCountTable(
  title: string,
  rows: Array<{ key: string; value: number }>,
): string[] {
  const lines = [`### ${title}`, ""];
  if (rows.length === 0) {
    lines.push("- (none)");
    lines.push("");
    return lines;
  }
  for (const row of rows) {
    lines.push(`- ${row.key}: ${row.value}`);
  }
  lines.push("");
  return lines;
}

export function renderBaselineMarkdown(artifact: BaselineArtifact): string {
  const lines: string[] = [
    `# Corpus baseline — ${artifact.series.seriesLabel}`,
    "",
    "## Series",
    "",
    `- Evaluation contract: ${artifact.series.evaluationContractVersion}`,
    `- Schema: ${artifact.schemaVersion}`,
    `- Predecessor: ${renderPredecessor(artifact.predecessor)}`,
    `- Generated: ${artifact.generatedAt}`,
    "",
    "## Fingerprint",
    "",
    ...renderKeyValueLines([
      ["fingerprintDigest", artifact.fingerprint.fingerprintDigest],
      ["scannerGitSha", artifact.fingerprint.scannerGitSha],
      ["corpusGoldDigest", artifact.fingerprint.corpusGoldDigest],
      ["evaluationContractVersion", artifact.fingerprint.evaluationContractVersion],
      ["scorecardVectorContractVersion", artifact.fingerprint.scorecardVectorContractVersion],
      ["taxonomyDigest", artifact.fingerprint.taxonomyDigest],
      ["conceptMapDigest", artifact.fingerprint.conceptMapDigest],
      ["adapterMapDigest", artifact.fingerprint.adapterMapDigest],
      ["dependencyLockDigest", artifact.fingerprint.dependencyLockDigest],
      [
        "deterministicConfigurationDigest",
        artifact.fingerprint.deterministicConfigurationDigest,
      ],
      ["eligibilityProfileDigest", artifact.fingerprint.eligibilityProfile.profileDigest],
      [
        "enableAiInference",
        String(artifact.fingerprint.deterministicConfiguration.enableAiInference),
      ],
    ]),
    "",
    "### Materialized sources",
    "",
  ];

  const materialized = [...artifact.fingerprint.materializedSources].sort((left, right) =>
    left.repoKey.localeCompare(right.repoKey),
  );
  if (materialized.length === 0) {
    lines.push("- (none)");
  } else {
    for (const source of materialized) {
      const head = source.validatedHeadSha ?? "n/a";
      const reason = source.reason ? `; ${source.reason}` : "";
      lines.push(
        `- ${source.repoKey}: ${source.validationStatus} @ ${head} (manifest ${source.manifestCommit.slice(0, 12)})${reason}`,
      );
    }
  }
  lines.push("");

  lines.push("### Review state counts (total)", "");
  for (const [state, count] of Object.entries(artifact.fingerprint.reviewStateCounts.total).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    lines.push(`- ${state}: ${count}`);
  }
  lines.push("");

  lines.push("## Invariants", "");
  for (const [key, value] of Object.entries(artifact.invariants).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");

  lines.push("## Readiness", "");
  lines.push(`- status: ${artifact.readiness.status}`);
  lines.push(`- evaluatedAt: ${artifact.readiness.evaluatedAt ?? "n/a"}`);
  if (artifact.readiness.blockers.length === 0) {
    lines.push("- blockers: (none)");
  } else {
    for (const blocker of artifact.readiness.blockers) {
      lines.push(`- blocker: ${blocker.code} — ${blocker.message}`);
    }
  }
  lines.push("");

  lines.push("## Gold population", "");
  for (const layer of HEADLINE_LAYERS) {
    const stats = artifact.goldPopulation.byLayer[layer];
    lines.push(`### ${layer}`);
    lines.push(`- acceptedCanonicalCount: ${stats.acceptedCanonicalCount}`);
    lines.push(`- evaluablePositiveCount: ${stats.evaluablePositiveCount}`);
    lines.push(`- distinctConceptLeaves: ${stats.distinctConceptLeaves}`);
    lines.push(
      `- packetDiversity: ${stats.packetDiversity.distinctPackets} (${stats.packetDiversity.packetKeys.join(", ") || "none"})`,
    );
    lines.push("");
  }

  lines.push("## Migration incomplete", "");
  lines.push(`- total: ${artifact.migrationIncomplete.total}`);
  lines.push(
    ...renderCountTable(
      "By reason",
      Object.entries(artifact.migrationIncomplete.byReason)
        .map(([key, value]) => ({ key, value }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).slice(2),
  );
  lines.push(
    ...renderCountTable(
      "By layer",
      Object.entries(artifact.migrationIncomplete.byLayer)
        .map(([key, value]) => ({ key, value }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    ).slice(2),
  );

  lines.push("## Scorecard (scorecard-vector/2)", "");
  lines.push(`- contract: ${artifact.scorecard.contractVersion}`);
  lines.push(`- scanner: ${artifact.scorecard.scannerGitSha}`);
  lines.push(`- review states: ${artifact.scorecard.reviewStates.join(", ")}`);
  lines.push(`- packets: ${artifact.scorecard.packets.length}`);
  lines.push("");

  for (const layer of HEADLINE_LAYERS) {
    const entry = artifact.scorecard.layers[layer];
    lines.push(`### ${layer}`);
    lines.push(`- summary: ${entry.computability.summary}`);
    if (entry.computability.unscorableReason) {
      lines.push(`- unscorable reason: ${entry.computability.unscorableReason}`);
    }
    lines.push(
      `- gate: ${entry.gate.status}${entry.gate.reason ? ` (${entry.gate.reason})` : ""}`,
    );
    lines.push(`- recall: ${formatMetricScore(entry.computability.metrics.recall)}`);
    lines.push(`- precision: ${formatMetricScore(entry.computability.metrics.precision)}`);
    lines.push(
      `- negative pass rate: ${formatMetricScore(entry.computability.metrics.negativeCasePassRate)}`,
    );
    lines.push(
      `- scope: reviewedFiles=${entry.computability.scope.reviewedScopeFileCount}, processedFiles=${entry.computability.scope.processedScopeFileCount}, locationlessFindings=${entry.computability.locationlessFindingCount}`,
    );
    lines.push(
      `- denominators: evaluablePositives=${entry.scores.denominators.evaluablePositives}, exhaustiveScopedFindings=${entry.scores.denominators.exhaustiveScopedFindings}`,
    );
    lines.push("");
  }

  const rawHits = artifact.scorecard.diagnostic["raw-hits"].scores;
  lines.push("### Diagnostic: raw-hits");
  lines.push(`- recall: ${formatRate(rawHits.recall)}`);
  lines.push(`- precision: ${formatRate(rawHits.precision)}`);
  lines.push(
    `- denominators: evaluablePositives=${rawHits.denominators.evaluablePositives}`,
  );
  lines.push("");

  lines.push("## Capability coverage (diagnostic only)", "");
  lines.push(`- disclaimer: ${artifact.capabilityCoverage.disclaimer}`);
  for (const layer of HEADLINE_LAYERS) {
    const coverage = artifact.capabilityCoverage.byLayer[layer];
    if (!coverage) {
      continue;
    }
    lines.push(`### ${layer}`);
    lines.push(`- caseWeighted: ${(coverage.caseWeighted * 100).toFixed(1)}%`);
    lines.push(`- distinctLeaf: ${(coverage.distinctLeaf * 100).toFixed(1)}%`);
    lines.push(`- supportedCount: ${coverage.supportedCount}`);
    lines.push(`- totalAcceptedPositives: ${coverage.totalAcceptedPositives}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
