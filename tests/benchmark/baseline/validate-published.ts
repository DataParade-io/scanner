import fs from "fs";
import path from "path";

import { digestCorpusGold, digestFile } from "./digests";
import { resolveScannerAdapterMapVersion } from "../../eval/canonical/scanner/manifest";
import { findPackageRoot } from "../paths";
import { parseBaselineArtifact, renderBaselineMarkdown, type BaselineArtifact } from "./index";

export interface ValidatePublishedBaselineOptions {
  jsonPath: string;
  benchmarkRoot?: string;
  packageRoot?: string;
  requireValidMaterializations?: boolean;
  verifyDigests?: boolean;
  verifyMarkdown?: boolean;
}

export interface ValidatePublishedBaselineResult {
  artifact: BaselineArtifact;
  markdownPath: string | null;
}

export class PublishedBaselineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedBaselineValidationError";
  }
}

function resolveMarkdownPath(jsonPath: string): string | null {
  if (jsonPath.endsWith(".json")) {
    const sibling = jsonPath.slice(0, -".json".length) + ".md";
    return fs.existsSync(sibling) ? sibling : null;
  }
  return null;
}

function assertValidMaterializations(artifact: BaselineArtifact): void {
  const failures = artifact.fingerprint.materializedSources.filter(
    (source) => source.validationStatus !== "valid",
  );
  if (failures.length === 0) {
    return;
  }

  const details = failures
    .map(
      (source) =>
        `${source.repoKey} (${source.validationStatus}${source.reason ? `: ${source.reason}` : ""})`,
    )
    .join("; ");
  throw new PublishedBaselineValidationError(
    `Published baseline requires valid materializations for every packet; failures: ${details}`,
  );
}

function assertFingerprintDigests(
  artifact: BaselineArtifact,
  benchmarkRoot: string,
  packageRoot: string,
): void {
  const expected = {
    corpusGoldDigest: digestCorpusGold(benchmarkRoot),
    taxonomyDigest: digestFile(path.join(packageRoot, "patterns", "component-taxonomy.yaml")),
    conceptMapDigest: digestFile(
      path.join(packageRoot, "patterns", "personal-data-concept-map.yaml"),
    ),
    adapterMapDigest: resolveScannerAdapterMapVersion(),
  };

  const mismatches: string[] = [];
  for (const [field, computed] of Object.entries(expected)) {
    const embedded = artifact.fingerprint[field as keyof typeof expected];
    if (embedded !== computed) {
      mismatches.push(`${field}: artifact=${embedded} current=${computed}`);
    }
  }

  if (mismatches.length > 0) {
    throw new PublishedBaselineValidationError(
      `Baseline fingerprint digests do not match current repository state:\n${mismatches.join("\n")}`,
    );
  }
}

function assertMarkdownRoundTrip(
  artifact: BaselineArtifact,
  markdownPath: string,
): void {
  const rendered = renderBaselineMarkdown(artifact);
  const committed = fs.readFileSync(markdownPath, "utf8");
  if (rendered !== committed) {
    throw new PublishedBaselineValidationError(
      `Rendered Markdown does not match committed file at ${markdownPath}`,
    );
  }
}

export function validatePublishedBaseline(
  options: ValidatePublishedBaselineOptions,
): ValidatePublishedBaselineResult {
  const packageRoot = options.packageRoot ?? findPackageRoot(__dirname);
  const benchmarkRoot =
    options.benchmarkRoot ?? path.join(packageRoot, "tests", "benchmark");
  const raw = JSON.parse(fs.readFileSync(options.jsonPath, "utf8"));
  const artifact = parseBaselineArtifact(raw);

  if (options.requireValidMaterializations) {
    assertValidMaterializations(artifact);
  }

  if (options.verifyDigests) {
    assertFingerprintDigests(artifact, benchmarkRoot, packageRoot);
  }

  const markdownPath = resolveMarkdownPath(options.jsonPath);
  if (options.verifyMarkdown) {
    if (!markdownPath) {
      throw new PublishedBaselineValidationError(
        `Markdown sibling not found for baseline JSON at ${options.jsonPath}`,
      );
    }
    assertMarkdownRoundTrip(artifact, markdownPath);
  }

  return {
    artifact,
    markdownPath,
  };
}
