/**
 * Vendor-level third-party report (DATAP-895): scan each materialized packet that has
 * `annotations/third_parties.yaml`, then score the scanner's third-party components
 * against the labels. Diagnostic only; not part of the four-layer scorecard.
 */
import fs from "fs";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../src/core/types/component";
import { normalizeEvalPath } from "../../src/eval/path";
import { componentIdentity } from "../eval/layers/components/adapter";
import { loadBenchmarkManifest } from "./manifest";
import {
  assertMaterialized,
  getBenchmarkRoot,
  getReposMetadataRoot,
  listBenchmarkRepoKeys,
} from "./run-benchmark";
import type { ReviewState } from "./schema";
import {
  loadThirdPartyLabels,
  type PredictedVendor,
  scoreThirdPartyVendors,
  type ThirdPartyLabelsFile,
  type ThirdPartyScore,
  type VendorMissCause,
} from "./third-party-labels";

export const THIRD_PARTY_REPORT_VERSION = "third-party-report/1";

export interface ThirdPartyPacketRow {
  repoKey: string;
  commit: string;
  score: ThirdPartyScore;
}

export interface ThirdPartyReport {
  version: string;
  reviewStates: ReviewState[];
  packets: ThirdPartyPacketRow[];
  totals: Omit<ThirdPartyScore, "misses" | "falsePositives" | "declaredOnly"> & {
    declaredOnly: number;
    declaredOnlyReported: number;
  };
}

export function predictedVendorsFromComponents(components: DetectedComponent[]): PredictedVendor[] {
  return components
    .filter((component) => component.type === "third_party")
    .map((component) => ({
      key: componentIdentity(component),
      locations: component.sourceLocations.map((location) => ({
        file_path: normalizeEvalPath(location.filePath),
        line: location.startLine ?? 1,
      })),
    }));
}

/** Packets with a third_parties.yaml file. */
export function listThirdPartyPackets(benchmarkRoot?: string): string[] {
  return listBenchmarkRepoKeys(benchmarkRoot).filter((key) =>
    fs.existsSync(path.join(getReposMetadataRoot(benchmarkRoot), key, "annotations", "third_parties.yaml")),
  );
}

/** Problems with a packet's labels against its pinned clone: missing files and lines past the end. */
export function checkLabelsAgainstClone(labels: ThirdPartyLabelsFile, cloneRoot: string): string[] {
  const problems: string[] = [];
  const lineCounts = new Map<string, number | null>();
  const lines = (file: string) => {
    if (!lineCounts.has(file)) {
      const full = path.join(cloneRoot, file);
      lineCounts.set(file, fs.existsSync(full) ? fs.readFileSync(full, "utf8").split("\n").length : null);
    }
    return lineCounts.get(file)!;
  };
  for (const vendor of labels.vendors) {
    const { manifest, imports, call_sites } = vendor.provenance;
    for (const loc of [...manifest, ...imports, ...call_sites]) {
      const count = lines(loc.file_path);
      if (count === null) {
        problems.push(`${vendor.subject_key}: ${loc.file_path} is not in the clone`);
      } else if (loc.line > count) {
        problems.push(`${vendor.subject_key}: ${loc.file_path}:${loc.line} is past the end (${count} lines)`);
      }
    }
  }
  return problems;
}

export async function runThirdPartyPacket(
  repoKey: string,
  options: { benchmarkRoot?: string; reviewStates?: ReviewState[] } = {},
): Promise<ThirdPartyPacketRow> {
  const repoDir = path.join(getReposMetadataRoot(options.benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const labels = loadThirdPartyLabels(repoDir);
  if (!labels) {
    throw new Error(`${repoKey} has no annotations/third_parties.yaml`);
  }
  const cloneRoot = assertMaterialized(repoKey, options.benchmarkRoot);
  const problems = checkLabelsAgainstClone(labels, cloneRoot);
  if (problems.length > 0) {
    throw new Error(`${repoKey} labels do not match the clone:\n  ${problems.join("\n  ")}`);
  }
  const { scanResult } = await scan(cloneRoot, createDefaultScanConfiguration({ enableAiInference: false }));
  const score = scoreThirdPartyVendors(labels, predictedVendorsFromComponents(scanResult.components), manifest, {
    reviewStates: options.reviewStates,
  });
  return { repoKey, commit: manifest.commit, score };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function buildThirdPartyReport(rows: ThirdPartyPacketRow[], reviewStates: ReviewState[]): ThirdPartyReport {
  const sum = (pick: (score: ThirdPartyScore) => number) => rows.reduce((total, row) => total + pick(row.score), 0);
  const goldVendors = sum((s) => s.goldVendors);
  const predictedVendors = sum((s) => s.predictedVendors);
  const hits = sum((s) => s.hits);
  const vendorHits = sum((s) => s.vendorHits);
  const certainGoldVendors = sum((s) => s.certainGoldVendors);
  const certainHits = sum((s) => s.certainHits);
  const truePositives = sum((s) => s.predictedVendors - s.falsePositives.length);
  const causes: VendorMissCause[] = ["no_sdk_mapping", "raw_http_missed", "provenance_wrong"];
  const missesByCause = Object.fromEntries(
    causes.map((cause) => [cause, sum((s) => s.missesByCause[cause])]),
  ) as Record<VendorMissCause, number>;
  return {
    version: THIRD_PARTY_REPORT_VERSION,
    reviewStates,
    packets: rows,
    totals: {
      goldVendors,
      predictedVendors,
      hits,
      vendorHits,
      recall: rate(hits, goldVendors),
      certainGoldVendors,
      certainHits,
      certainRecall: rate(certainHits, certainGoldVendors),
      vendorRecall: rate(vendorHits, goldVendors),
      precision: rate(truePositives, predictedVendors),
      missesByCause,
      declaredOnly: sum((s) => s.declaredOnly.length),
      declaredOnlyReported: sum((s) => s.declaredOnly.filter((d) => d.reported).length),
    },
  };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function renderThirdPartyReportMarkdown(report: ThirdPartyReport): string {
  const out: string[] = [];
  out.push("# Third-party vendor report");
  out.push("");
  out.push(
    `Version \`${report.version}\`. Review states counted: ${report.reviewStates.join(", ")}. ` +
      "Recall counts a vendor only when the scanner reports it at a labelled manifest entry, import or call site; " +
      "vendor recall counts it wherever it is reported; certain recall leaves out labels marked uncertain. Precision is vendor level, over in-scope predictions. " +
      "Declared dependencies that send no data are listed apart and not scored.",
  );
  out.push("");
  out.push("| Packet | Gold | Predicted | Recall | Certain recall | Vendor recall | Precision | No SDK mapping | Raw HTTP missed | Provenance wrong | Declared only (reported) |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of report.packets) {
    const s = row.score;
    out.push(
      `| ${row.repoKey} | ${s.goldVendors} | ${s.predictedVendors} | ${pct(s.recall)} | ${pct(s.certainRecall)} | ${pct(s.vendorRecall)} | ${pct(s.precision)} | ` +
        `${s.missesByCause.no_sdk_mapping} | ${s.missesByCause.raw_http_missed} | ${s.missesByCause.provenance_wrong} | ` +
        `${s.declaredOnly.length} (${s.declaredOnly.filter((d) => d.reported).length}) |`,
    );
  }
  const t = report.totals;
  out.push(
    `| **All** | ${t.goldVendors} | ${t.predictedVendors} | ${pct(t.recall)} | ${pct(t.certainRecall)} | ${pct(t.vendorRecall)} | ${pct(t.precision)} | ` +
      `${t.missesByCause.no_sdk_mapping} | ${t.missesByCause.raw_http_missed} | ${t.missesByCause.provenance_wrong} | ` +
      `${t.declaredOnly} (${t.declaredOnlyReported}) |`,
  );
  out.push("");
  out.push("## Misses and false positives");
  out.push("");
  for (const row of report.packets) {
    const s = row.score;
    if (s.misses.length === 0 && s.falsePositives.length === 0) {
      continue;
    }
    out.push(`### ${row.repoKey}`);
    out.push("");
    for (const miss of s.misses) {
      out.push(`- miss \`${miss.subject_key}\` (${miss.route}): ${miss.cause}${miss.uncertain ? ", label uncertain" : ""}`);
    }
    for (const key of s.falsePositives) {
      out.push(`- false positive \`${key}\``);
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function writeThirdPartyReport(report: ThirdPartyReport, benchmarkRoot?: string) {
  const dir = path.join(getBenchmarkRoot(benchmarkRoot), "reports");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "third-party-vendors.json");
  const markdownPath = path.join(dir, "third-party-vendors.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderThirdPartyReportMarkdown(report));
  return { jsonPath, markdownPath };
}
