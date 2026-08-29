import type { PiiSignalRule } from "./pii-signal-rules";
import { loadPiiSignalRules } from "./pii-signal-rules";

export interface PiiSignalEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
  reason: string;
}

export interface PiiSignalHit {
  id: string;
  category: PiiSignalRule["category"];
  labels: string[];
  evidence: PiiSignalEvidence;
}

export interface MatchPiiSignalsFileInput {
  filePath: string;
  content: string;
}

export { piiSignalIdentity, rawHitIdentity, mentionIdentity, dataItemIdentity } from "../eval-layers/identities";

export function matchPiiSignalsInFile(
  input: MatchPiiSignalsFileInput,
  rules: PiiSignalRule[] = loadPiiSignalRules(),
): PiiSignalHit[] {
  const lines = input.content.split(/\r?\n/);
  const hits: PiiSignalHit[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    for (const rule of rules) {
      if (!rule.patterns.some((pattern) => pattern.test(line))) {
        continue;
      }
      hits.push({
        id: rule.id,
        category: rule.category,
        labels: [...rule.labels],
        evidence: {
          filePath: input.filePath,
          startLine: lineIndex + 1,
          endLine: lineIndex + 1,
          reason: `matched pii:${rule.id} signal`,
        },
      });
    }
  }

  return hits;
}

export function matchPiiSignalsInFiles(
  files: MatchPiiSignalsFileInput[],
  rules: PiiSignalRule[] = loadPiiSignalRules(),
): PiiSignalHit[] {
  return files.flatMap((file) => matchPiiSignalsInFile(file, rules));
}
