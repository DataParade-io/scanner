import type { FileInfo } from "../core/types/file";
import { ingestFileSystemWithOutcomes } from "../ingest/file-system";
import type { PathEligibilityOutcome } from "../ingest/eligibility";
import {
  matchPiiSignalsInFiles,
  type PiiSignalHit,
} from "../pii-signals/match-pii-signals";

export interface PersonalDataInventory {
  hits: PiiSignalHit[];
  files: FileInfo[];
  ingestOutcomes: PathEligibilityOutcome[];
}

/**
 * Ingest and match personal-data signals once per repository root.
 * Layer projections and per-layer eligibility ledgers derive from this inventory.
 */
export async function buildPersonalDataInventory(
  rootPath: string,
): Promise<PersonalDataInventory> {
  const ingestResult = await ingestFileSystemWithOutcomes(rootPath);
  const hits = matchPiiSignalsInFiles(
    ingestResult.files.map((file) => ({ filePath: file.path, content: file.content })),
  );

  return {
    hits,
    files: ingestResult.files,
    ingestOutcomes: ingestResult.outcomes,
  };
}
