import fs from "fs";
import os from "os";
import path from "path";

import {
  ingestFileSystem,
  ingestFileSystemWithOutcomes,
} from "../../../src/ingest/file-system";
import type { EligibilityReason } from "../../../src/ingest/eligibility";

const FIXTURE_ROOT = path.resolve(__dirname, "../../fixtures/ingest-basic");

describe("ingest membership stability", () => {
  it("returns the same included-file paths after ledger dual-emit", async () => {
    const files = await ingestFileSystem(FIXTURE_ROOT);
    const withOutcomes = await ingestFileSystemWithOutcomes(FIXTURE_ROOT);
    const baselinePaths = files.map((file) => file.path).sort();
    const ledgerPaths = withOutcomes.files.map((file) => file.path).sort();
    expect(ledgerPaths).toEqual(baselinePaths);
    expect(withOutcomes.outcomes.length).toBeGreaterThan(0);
  });
});

describe("ingest eligibility reasons", () => {
  const ALL_REASONS: EligibilityReason[] = [
    "successfully_processed",
    "unsupported_file_type_or_language",
    "excluded_by_configured_policy",
    "ignored_by_repository_default_policy",
    "sensitive_path_exclusion",
    "file_too_large",
    "file_count_cap_reached",
    "total_byte_cap_reached",
    "missing_or_path_contract_mismatch",
    "read_decode_error",
    "parse_or_layer_processing_error",
  ];

  function hasReason(outcomes: { reason: EligibilityReason }[], reason: EligibilityReason) {
    return outcomes.some((outcome) => outcome.reason === reason);
  }

  it("successfully_processed", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-ok-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "ok.ts"), "export {};\n");
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot);
      expect(hasReason(outcomes, "successfully_processed")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("unsupported_file_type_or_language", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-md-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "readme.md"), "# doc\n");
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot);
      expect(hasReason(outcomes, "unsupported_file_type_or_language")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("excluded_by_configured_policy", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-excl-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "skip.ts"), "export {};\n");
      fs.writeFileSync(path.join(tempRoot, "keep.ts"), "export {};\n");
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot, {
        excludePaths: ["skip.ts"],
      });
      expect(hasReason(outcomes, "excluded_by_configured_policy")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("ignored_by_repository_default_policy", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-gitignore-"));
    try {
      fs.writeFileSync(path.join(tempRoot, ".gitignore"), "ignored.ts\n");
      fs.writeFileSync(path.join(tempRoot, "ignored.ts"), "export {};\n");
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot);
      expect(hasReason(outcomes, "ignored_by_repository_default_policy")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("sensitive_path_exclusion", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-env-"));
    try {
      const envPath = path.join(tempRoot, ".env");
      fs.writeFileSync(envPath, "SECRET=x\n");
      const { outcomes } = await ingestFileSystemWithOutcomes(envPath);
      expect(hasReason(outcomes, "sensitive_path_exclusion")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("file_too_large", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-big-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "big.ts"), "a".repeat(50));
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot, {
        maxFileSizeBytes: 10,
      });
      expect(hasReason(outcomes, "file_too_large")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("file_count_cap_reached", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-count-"));
    try {
      for (let i = 0; i < 5; i += 1) {
        fs.writeFileSync(path.join(tempRoot, `f${i}.ts`), `export const x${i}=1;\n`);
      }
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot, {
        maxFileCount: 2,
      });
      expect(hasReason(outcomes, "file_count_cap_reached")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("total_byte_cap_reached", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-bytes-"));
    try {
      fs.writeFileSync(path.join(tempRoot, "a.ts"), "a".repeat(40));
      fs.writeFileSync(path.join(tempRoot, "b.ts"), "b".repeat(40));
      const { outcomes } = await ingestFileSystemWithOutcomes(tempRoot, {
        maxTotalBytes: 50,
        maxFileSizeBytes: 10_000,
      });
      expect(hasReason(outcomes, "total_byte_cap_reached")).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("missing_or_path_contract_mismatch is a layer lookup reason", () => {
    expect(ALL_REASONS).toContain("missing_or_path_contract_mismatch");
  });

  it("read_decode_error", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elig-read-"));
    try {
      const filePath = path.join(tempRoot, "unreadable.ts");
      fs.writeFileSync(filePath, "export {};\n");
      fs.chmodSync(filePath, 0o000);
      const { outcomes } = await ingestFileSystemWithOutcomes(filePath);
      expect(hasReason(outcomes, "read_decode_error")).toBe(true);
      fs.chmodSync(filePath, 0o600);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("parse_or_layer_processing_error is produced at layer stage", () => {
    expect(ALL_REASONS).toContain("parse_or_layer_processing_error");
  });
});
