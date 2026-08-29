import { ingestFileSystem } from "../ingest/file-system";
import {
  matchPiiSignalsInFiles,
  type PiiSignalHit,
} from "../pii-signals/match-pii-signals";
import {
  dataItemIdentity,
  mentionIdentity,
  rawHitIdentity,
} from "./identities";

export interface PersonalDataFinding {
  subjectKey: string;
  labels: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface PersonalDataFindingsPayload {
  findings: PersonalDataFinding[];
  filesScanned: string[];
}

function hitToRawFinding(hit: PiiSignalHit): PersonalDataFinding {
  return {
    subjectKey: rawHitIdentity(hit.id),
    labels: [...hit.labels],
    filePath: hit.evidence.filePath,
    startLine: hit.evidence.startLine,
    endLine: hit.evidence.endLine,
  };
}

function hitToMentionFinding(hit: PiiSignalHit): PersonalDataFinding {
  return {
    subjectKey: mentionIdentity(hit.id),
    labels: [...hit.labels],
    filePath: hit.evidence.filePath,
    startLine: hit.evidence.startLine,
    endLine: hit.evidence.endLine,
  };
}

function hitsToDataItemFindings(hits: PiiSignalHit[]): PersonalDataFinding[] {
  const byKey = new Map<string, PersonalDataFinding>();

  for (const hit of hits) {
    const key = dataItemIdentity(hit.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        subjectKey: key,
        labels: [...hit.labels],
        filePath: hit.evidence.filePath,
        startLine: hit.evidence.startLine,
        endLine: hit.evidence.endLine,
      });
      continue;
    }

    const labels = new Set([...existing.labels, ...hit.labels]);
    existing.labels = [...labels];
    if (hit.evidence.filePath < existing.filePath) {
      existing.filePath = hit.evidence.filePath;
      existing.startLine = hit.evidence.startLine;
      existing.endLine = hit.evidence.endLine;
    }
  }

  return [...byKey.values()].sort((a, b) => a.subjectKey.localeCompare(b.subjectKey));
}

export type PersonalDataEvalLayer = "raw-hits" | "mentions" | "data-items";

export async function collectPersonalDataFindings(
  rootPath: string,
  layer: PersonalDataEvalLayer,
): Promise<PersonalDataFindingsPayload> {
  const files = await ingestFileSystem(rootPath);
  const hits = matchPiiSignalsInFiles(
    files.map((file) => ({ filePath: file.path, content: file.content })),
  );

  let findings: PersonalDataFinding[];
  switch (layer) {
    case "raw-hits":
      findings = hits.map(hitToRawFinding);
      break;
    case "mentions":
      findings = hits.map(hitToMentionFinding);
      break;
    case "data-items":
      findings = hitsToDataItemFindings(hits);
      break;
  }

  return {
    findings,
    filesScanned: files.map((file) => file.path),
  };
}
