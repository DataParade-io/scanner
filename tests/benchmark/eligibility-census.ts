import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import type { EvalLayer } from "../eval/types";
import {
  countReasons,
  emptyReasonCounts,
  type EligibilityReasonCounts,
} from "../eval/eligibility/types";
import { eligibleProcessedPaths } from "../eval/eligibility/ledger-access";
import { loadBenchmarkManifest } from "./manifest";
import {
  assertMaterialized,
  listBenchmarkRepoKeys,
  MaterializationMissingError,
} from "./run-benchmark";
import { scanRepoByManifestLayers } from "./scan-repo";
import { resolveDefaultBenchmarkRoot } from "./paths";

export interface EligibilityCensusLayerRow {
  layer: EvalLayer;
  reasonCounts: EligibilityReasonCounts;
  eligiblePathCount: number;
}

export interface EligibilityCensusPacketRow {
  repoKey: string;
  commit: string;
  layers: EligibilityCensusLayerRow[];
  fileCountCapHits: number;
  totalByteCapHits: number;
}

export interface EligibilityCensusReport {
  generatedAt: string;
  scannerGitSha: string;
  command: string;
  packets: EligibilityCensusPacketRow[];
  totals: {
    packets: number;
    fileCountCapHits: number;
    totalByteCapHits: number;
    reasonCounts: EligibilityReasonCounts;
  };
}

export interface RunEligibilityCensusOptions {
  benchmarkRoot?: string;
  repoKeys?: string[];
}

function scannerGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export async function runEligibilityCensus(
  options: RunEligibilityCensusOptions = {},
): Promise<EligibilityCensusReport> {
  const benchmarkRoot = options.benchmarkRoot ?? resolveDefaultBenchmarkRoot();
  const repoKeys = options.repoKeys ?? listBenchmarkRepoKeys(benchmarkRoot);
  const packets: EligibilityCensusPacketRow[] = [];
  const totals = {
    packets: 0,
    fileCountCapHits: 0,
    totalByteCapHits: 0,
    reasonCounts: emptyReasonCounts(),
  };

  for (const repoKey of repoKeys) {
    let materializedPath: string;
    try {
      materializedPath = assertMaterialized(repoKey, benchmarkRoot);
    } catch (error) {
      if (error instanceof MaterializationMissingError) {
        continue;
      }
      throw error;
    }

    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const manifest = loadBenchmarkManifest(repoDir);
    const scanResult = await scanRepoByManifestLayers(
      repoKey,
      materializedPath,
      manifest.coverage.layers,
    );

    const layerRows: EligibilityCensusLayerRow[] = [];
    let packetFileCountCapHits = 0;
    let packetTotalByteCapHits = 0;

    for (const [layer, ledger] of Object.entries(scanResult.eligibilityLedgers ?? {})) {
      if (!ledger) continue;
      const reasonCounts = countReasons(ledger.outcomes);
      packetFileCountCapHits += reasonCounts.file_count_cap_reached;
      packetTotalByteCapHits += reasonCounts.total_byte_cap_reached;
      layerRows.push({
        layer: layer as EvalLayer,
        reasonCounts,
        eligiblePathCount: eligibleProcessedPaths(ledger).length,
      });
      for (const reason of Object.keys(reasonCounts) as (keyof EligibilityReasonCounts)[]) {
        totals.reasonCounts[reason] += reasonCounts[reason];
      }
    }

    packets.push({
      repoKey,
      commit: manifest.commit,
      layers: layerRows,
      fileCountCapHits: packetFileCountCapHits,
      totalByteCapHits: packetTotalByteCapHits,
    });
    totals.fileCountCapHits += packetFileCountCapHits;
    totals.totalByteCapHits += packetTotalByteCapHits;
    totals.packets += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    scannerGitSha: scannerGitSha(),
    command: "benchmark:eligibility-census",
    packets,
    totals,
  };
}

export async function writeEligibilityCensusReport(
  report: EligibilityCensusReport,
  outputPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
