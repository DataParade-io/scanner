import type { FileInfo } from "../core/types/file";
import { ingestFileSystemWithOutcomes } from "../ingest/file-system";
import type { PathEligibilityOutcome } from "../ingest/eligibility";
import { stripCommentsForLanguage } from "../analyzers/shared/strip-comments-for-language";
import { CommentLines } from "../pii-signals/comment-context";
import { mentionGroup } from "../pii-signals/mention-group";
import {
  matchPiiSignalsInFile,
  type PiiSignalHit,
} from "../pii-signals/match-pii-signals";

export interface PersonalDataInventory {
  hits: PiiSignalHit[];
  files: FileInfo[];
  ingestOutcomes: PathEligibilityOutcome[];
}

/**
 * Match one file on its raw text and on its layout-preserving comment-stripped text
 * (KDATAP-b512a8). Every match is kept: a match found only in the raw text sits in a
 * comment or docstring and is tagged `comment`; the rest are `code` and carry the
 * comments immediately around them. Line numbers are identical in both texts.
 */
function annotatedHitsForFile(file: FileInfo): PiiSignalHit[] {
  const lines = file.content.split(/\r?\n/);
  const withGroup = (hit: PiiSignalHit): PiiSignalHit => {
    const group = mentionGroup(hit.id, lines[hit.evidence.endLine - 1] ?? "");
    return group ? { ...hit, group } : hit;
  };
  const stripped = stripCommentsForLanguage(file.content, file.language);
  const rawHits = matchPiiSignalsInFile({ filePath: file.path, content: file.content });
  if (stripped === file.content) {
    return rawHits.map((hit) => withGroup({ ...hit, location: "code" as const }));
  }
  const codeKeys = new Set(
    matchPiiSignalsInFile({ filePath: file.path, content: stripped }).map(
      (hit) => `${hit.id}:${hit.evidence.endLine}`,
    ),
  );
  const comments = new CommentLines(file.content, stripped);
  return rawHits.map((hit) => {
    if (!codeKeys.has(`${hit.id}:${hit.evidence.endLine}`)) {
      return { ...hit, location: "comment" as const };
    }
    const commentContext = comments.context(hit.evidence.startLine, hit.evidence.endLine);
    return withGroup({ ...hit, location: "code" as const, ...(commentContext ? { commentContext } : {}) });
  });
}

/**
 * Match personal-data signals from an already-ingested file set.
 * Used when the orchestrator scan has already walked the repository tree.
 */
export function buildPersonalDataInventoryFromIngest(
  files: FileInfo[],
  ingestOutcomes: PathEligibilityOutcome[],
): PersonalDataInventory {
  const hits = files.flatMap((file) => annotatedHitsForFile(file));

  return {
    hits,
    files,
    ingestOutcomes,
  };
}

/**
 * Ingest and match personal-data signals once per repository root.
 * Layer projections and per-layer eligibility ledgers derive from this inventory.
 */
export async function buildPersonalDataInventory(
  rootPath: string,
): Promise<PersonalDataInventory> {
  const ingestResult = await ingestFileSystemWithOutcomes(rootPath);
  return buildPersonalDataInventoryFromIngest(
    ingestResult.files,
    ingestResult.outcomes,
  );
}
