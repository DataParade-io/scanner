import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import type { DetectedComponent } from "../../src/core/types/component";
import { componentIdentity } from "../eval/layers/components/adapter";
import type { FixtureScanResult, LayerFinding } from "../eval/types";
import { parseIdentityKey } from "../eval/identity";
import { loadAnnotations, loadBenchmarkManifest } from "./manifest";
import type { AnnotationRecord } from "./schema";
import {
  assertMaterialized,
  getReposMetadataRoot,
  listBenchmarkRepoKeys,
  MaterializationMissingError,
} from "./run-benchmark";
import { scanRepoByManifestLayers } from "./scan-repo";

const CENSUS_LAYERS = ["components", "data_flows"] as const;

export type ComponentIdentityScheme = "type_name" | "type_subtype" | "hybrid";

export interface DetectionCensusRow {
  repoKey: string;
  commit: string;
  scopePaths: string[];
  filesIngested: number;
  componentsEmitted: number;
  dataFlowsEmitted: number;
  componentGoldPositives: number;
  matchedTypeName: number;
  matchedTypeSubtype: number;
  matchedHybrid: number;
  zeroComponents: boolean;
  subTypeFallbackCount: number;
}

export interface DetectionCensusReport {
  generatedAt: string;
  scannerGitSha: string;
  command: string;
  packets: DetectionCensusRow[];
  totals: {
    packets: number;
    filesIngested: number;
    componentsEmitted: number;
    dataFlowsEmitted: number;
    componentGoldPositives: number;
    matchedTypeName: number;
    matchedTypeSubtype: number;
    matchedHybrid: number;
    zeroComponentPackets: number;
  };
}

export interface RunDetectionCensusOptions {
  benchmarkRoot?: string;
  repoKeys?: string[];
  scanRepo?: (
    repoKey: string,
    repoRoot: string,
  ) => Promise<FixtureScanResult>;
}

export interface PreflightMaterializationResult {
  materialized: string[];
  missing: MaterializationMissingError[];
}

/** Scheme A — `${type}:${name.toLowerCase()}` (today's production identity). */
export function componentIdentityTypeName(component: DetectedComponent): string {
  return componentIdentity(component);
}

/** Scheme B — `${type}:${subType}`; falls back to scheme A when subType is absent. */
export function componentIdentityTypeSubType(component: DetectedComponent): string {
  if (component.subType) {
    return `${component.type}:${component.subType.toLowerCase()}`;
  }
  return componentIdentityTypeName(component);
}

/** Scheme C — third_party by name; assets, actors, and other types by subtype. */
export function componentIdentityHybrid(component: DetectedComponent): string {
  if (component.type === "third_party") {
    return componentIdentityTypeName(component);
  }
  return componentIdentityTypeSubType(component);
}

function componentTypeFromFinding(finding: LayerFinding): string {
  return finding.labels[0] ?? parseIdentityKey(finding.key).prefix;
}

function componentSubTypeFromFinding(finding: LayerFinding): string | undefined {
  if (finding.labels.length > 1) {
    return finding.labels[1];
  }
  return undefined;
}

/** Scheme A key for a component finding (stored on finding.key). */
export function componentFindingIdentityTypeName(finding: LayerFinding): string {
  return finding.key;
}

/** Scheme B key derived from a component finding's labels. */
export function componentFindingIdentityTypeSubType(finding: LayerFinding): string {
  const type = componentTypeFromFinding(finding);
  const subType = componentSubTypeFromFinding(finding);
  if (subType) {
    return `${type}:${subType.toLowerCase()}`;
  }
  return finding.key;
}

/** Scheme C key derived from a component finding. */
export function componentFindingIdentityHybrid(finding: LayerFinding): string {
  const type = componentTypeFromFinding(finding);
  if (type === "third_party") {
    return finding.key;
  }
  return componentFindingIdentityTypeSubType(finding);
}

function identityKeyForScheme(
  finding: LayerFinding,
  scheme: ComponentIdentityScheme,
): string {
  switch (scheme) {
    case "type_name":
      return componentFindingIdentityTypeName(finding);
    case "type_subtype":
      return componentFindingIdentityTypeSubType(finding);
    case "hybrid":
      return componentFindingIdentityHybrid(finding);
  }
}

export function buildComponentIdentitySet(
  findings: LayerFinding[],
  scheme: ComponentIdentityScheme,
): Set<string> {
  const keys = new Set<string>();
  for (const finding of findings) {
    if (finding.layer !== undefined && finding.layer !== "components") {
      continue;
    }
    keys.add(identityKeyForScheme(finding, scheme));
  }
  return keys;
}

export function loadAcceptedComponentGoldPositives(
  repoKey: string,
  benchmarkRoot?: string,
): AnnotationRecord[] {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const annotations = loadAnnotations(repoDir, "components");
  return annotations.filter(
    (annotation) =>
      annotation.provenance.review_state === "accepted" &&
      annotation.expected.status === "positive",
  );
}

export function countMatchedGoldPositives(
  goldPositives: AnnotationRecord[],
  emittedIdentities: Set<string>,
): number {
  let matched = 0;
  for (const annotation of goldPositives) {
    if (emittedIdentities.has(annotation.subject.key)) {
      matched += 1;
    }
  }
  return matched;
}

export function countSubTypeFallbacks(findings: LayerFinding[]): number {
  let count = 0;
  for (const finding of findings) {
    if (finding.layer !== undefined && finding.layer !== "components") {
      continue;
    }
    if (!componentSubTypeFromFinding(finding)) {
      count += 1;
    }
  }
  return count;
}

export function buildDetectionCensusRow(
  repoKey: string,
  scanResult: FixtureScanResult,
  goldPositives: AnnotationRecord[],
  manifestCommit: string,
  scopePaths: string[],
): DetectionCensusRow {
  const componentFindings = scanResult.findings.filter(
    (finding) => finding.layer === "components",
  );
  const dataFlowFindings = scanResult.findings.filter(
    (finding) => finding.layer === "data-flows",
  );

  const identitiesA = buildComponentIdentitySet(componentFindings, "type_name");
  const identitiesB = buildComponentIdentitySet(componentFindings, "type_subtype");
  const identitiesC = buildComponentIdentitySet(componentFindings, "hybrid");

  const componentsEmitted = componentFindings.length;

  return {
    repoKey,
    commit: manifestCommit,
    scopePaths,
    filesIngested: scanResult.scannedFiles.length,
    componentsEmitted,
    dataFlowsEmitted: dataFlowFindings.length,
    componentGoldPositives: goldPositives.length,
    matchedTypeName: countMatchedGoldPositives(goldPositives, identitiesA),
    matchedTypeSubtype: countMatchedGoldPositives(goldPositives, identitiesB),
    matchedHybrid: countMatchedGoldPositives(goldPositives, identitiesC),
    zeroComponents: componentsEmitted === 0,
    subTypeFallbackCount: countSubTypeFallbacks(componentFindings),
  };
}

export function preflightMaterializedRepos(
  repoKeys: string[],
  benchmarkRoot?: string,
): PreflightMaterializationResult {
  const materialized: string[] = [];
  const missing: MaterializationMissingError[] = [];

  for (const repoKey of repoKeys) {
    try {
      assertMaterialized(repoKey, benchmarkRoot);
      materialized.push(repoKey);
    } catch (error) {
      if (error instanceof MaterializationMissingError) {
        missing.push(error);
        continue;
      }
      throw error;
    }
  }

  return { materialized, missing };
}

export function assertAllMaterialized(
  repoKeys: string[],
  benchmarkRoot?: string,
): void {
  const { missing } = preflightMaterializedRepos(repoKeys, benchmarkRoot);
  if (missing.length === 0) {
    return;
  }

  const details = missing
    .map((error) => `- ${error.repoKey}: ${error.expectedPath}`)
    .join("\n");
  throw new Error(
    `Detection census preflight failed for ${missing.length} packet(s). ` +
      `Run: pnpm run benchmark:materialize -- --all\n${details}`,
  );
}

export async function runDetectionCensusRepo(
  repoKey: string,
  options: RunDetectionCensusOptions = {},
): Promise<DetectionCensusRow> {
  const materializedPath = assertMaterialized(repoKey, options.benchmarkRoot);
  const repoDir = path.join(getReposMetadataRoot(options.benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const goldPositives = loadAcceptedComponentGoldPositives(repoKey, options.benchmarkRoot);

  const scanFn =
    options.scanRepo ??
    ((key: string, root: string) =>
      scanRepoByManifestLayers(key, root, [...CENSUS_LAYERS]));

  const scanResult = await scanFn(repoKey, materializedPath);

  return buildDetectionCensusRow(
    repoKey,
    scanResult,
    goldPositives,
    manifest.commit,
    manifest.scope.include,
  );
}

export async function runDetectionCensus(
  options: RunDetectionCensusOptions = {},
): Promise<DetectionCensusReport> {
  const repoKeys =
    options.repoKeys ?? listBenchmarkRepoKeys(options.benchmarkRoot);

  assertAllMaterialized(repoKeys, options.benchmarkRoot);

  const packets: DetectionCensusRow[] = [];
  for (const repoKey of repoKeys) {
    packets.push(await runDetectionCensusRepo(repoKey, options));
  }

  return {
    generatedAt: new Date().toISOString(),
    scannerGitSha: readScannerGitSha(),
    command: "pnpm run benchmark:census",
    packets,
    totals: summarizeDetectionCensus(packets),
  };
}

export function summarizeDetectionCensus(
  packets: DetectionCensusRow[],
): DetectionCensusReport["totals"] {
  return {
    packets: packets.length,
    filesIngested: sumField(packets, "filesIngested"),
    componentsEmitted: sumField(packets, "componentsEmitted"),
    dataFlowsEmitted: sumField(packets, "dataFlowsEmitted"),
    componentGoldPositives: sumField(packets, "componentGoldPositives"),
    matchedTypeName: sumField(packets, "matchedTypeName"),
    matchedTypeSubtype: sumField(packets, "matchedTypeSubtype"),
    matchedHybrid: sumField(packets, "matchedHybrid"),
    zeroComponentPackets: packets.filter((row) => row.zeroComponents).length,
  };
}

function sumField(rows: DetectionCensusRow[], field: keyof DetectionCensusRow): number {
  return rows.reduce((total, row) => total + Number(row[field]), 0);
}

function readScannerGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function formatDetectionCensusTable(report: DetectionCensusReport): string {
  const header = [
    "repo_key",
    "files",
    "components",
    "data_flows",
    "gold+",
    "match:name",
    "match:subtype",
    "match:hybrid",
    "zero_comp",
  ].join("\t");

  const rows = report.packets.map((row) =>
    [
      row.repoKey,
      row.filesIngested,
      row.componentsEmitted,
      row.dataFlowsEmitted,
      row.componentGoldPositives,
      row.matchedTypeName,
      row.matchedTypeSubtype,
      row.matchedHybrid,
      row.zeroComponents ? "yes" : "no",
    ].join("\t"),
  );

  const totals = report.totals;
  const footer = [
    "TOTAL",
    totals.filesIngested,
    totals.componentsEmitted,
    totals.dataFlowsEmitted,
    totals.componentGoldPositives,
    totals.matchedTypeName,
    totals.matchedTypeSubtype,
    totals.matchedHybrid,
    `${totals.zeroComponentPackets}/${totals.packets}`,
  ].join("\t");

  return [header, ...rows, footer].join("\n");
}

export function formatDetectionCensusMarkdown(report: DetectionCensusReport): string {
  const lines: string[] = [
    "# Detection coverage census",
    "",
    `Generated: ${report.generatedAt}`,
    `Scanner git SHA: \`${report.scannerGitSha}\``,
    `Command: \`${report.command}\``,
    "",
    "Identity-only set membership on accepted component gold positives. No spans, no scoring.",
    "",
    "481/563 is vocabulary satisfiability, not detection recall.",
    "",
    "## Corpus totals",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Packets | ${report.totals.packets} |`,
    `| Files ingested | ${report.totals.filesIngested} |`,
    `| Components emitted | ${report.totals.componentsEmitted} |`,
    `| Data flows emitted | ${report.totals.dataFlowsEmitted} |`,
    `| Component gold positives | ${report.totals.componentGoldPositives} |`,
    `| Matched (type:name) | ${report.totals.matchedTypeName} |`,
    `| Matched (type:subType) | ${report.totals.matchedTypeSubtype} |`,
    `| Matched (hybrid) | ${report.totals.matchedHybrid} |`,
    `| Zero-component packets | ${report.totals.zeroComponentPackets}/${report.totals.packets} |`,
    "",
    "## Per-packet rows",
    "",
    "| Repo | Commit | Files | Components | Data flows | Gold+ | Match name | Match subtype | Match hybrid | Zero comp |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const row of report.packets) {
    lines.push(
      `| ${row.repoKey} | \`${row.commit.slice(0, 7)}\` | ${row.filesIngested} | ${row.componentsEmitted} | ${row.dataFlowsEmitted} | ${row.componentGoldPositives} | ${row.matchedTypeName} | ${row.matchedTypeSubtype} | ${row.matchedHybrid} | ${row.zeroComponents ? "yes" : "no"} |`,
    );
  }

  const zeroComponentPackets = report.packets
    .filter((row) => row.zeroComponents)
    .map((row) => row.repoKey);
  if (zeroComponentPackets.length > 0) {
    lines.push("", "## Zero-component packets", "", zeroComponentPackets.join(", "));
  }

  return lines.join("\n");
}

export function writeDetectionCensusReport(
  report: DetectionCensusReport,
  benchmarkRoot?: string,
): { jsonPath: string; markdownPath: string } {
  const reportsDir = path.join(
    benchmarkRoot ?? path.join(__dirname, ".."),
    "reports",
  );
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, "detection-coverage-census.json");
  const markdownPath = path.join(reportsDir, "detection-coverage-census.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, `${formatDetectionCensusMarkdown(report)}\n`, "utf8");

  return { jsonPath, markdownPath };
}
