import type { PiiSignalRule } from "./pii-signal-rules";
import { loadPiiSignalRules } from "./pii-signal-rules";
import {
  extractLineIdentifierTokens,
  resolveAliasRuleIdsForToken,
} from "./pii-signal-aliases";

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

function ruleById(rules: PiiSignalRule[]): Map<string, PiiSignalRule> {
  return new Map(rules.map((rule) => [rule.id, rule]));
}

function isJavaFieldDeclarationLine(line: string): boolean {
  return /\b(?:private|protected)\s+[\w<>,\s\[\]]+\s+\w+\s*;/.test(line);
}

/**
 * Gold often anchors on the leading @Column line while token matching fires on the
 * field declaration a few lines below; span evidence through the annotation block.
 */
export function javaAnnotationBlockStartLine(
  lines: readonly string[],
  fieldLineIndex: number,
): number {
  let start = fieldLineIndex;
  for (let index = fieldLineIndex - 1; index >= 0 && index >= fieldLineIndex - 12; index -= 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (/^@\w+/.test(trimmed)) {
      start = index;
      continue;
    }
    break;
  }
  return start;
}

function expandJavaAnnotatedFieldEvidence(
  lines: readonly string[],
  hit: PiiSignalHit,
): PiiSignalHit {
  if (!/\.(?:java|kt)$/i.test(hit.evidence.filePath)) {
    return hit;
  }
  const fieldLineIndex = hit.evidence.startLine - 1;
  const line = lines[fieldLineIndex] ?? "";
  if (!isJavaFieldDeclarationLine(line)) {
    return hit;
  }
  const annotationStart = javaAnnotationBlockStartLine(lines, fieldLineIndex);
  if (annotationStart >= fieldLineIndex) {
    return hit;
  }
  return {
    ...hit,
    evidence: {
      ...hit.evidence,
      startLine: annotationStart + 1,
      endLine: hit.evidence.endLine,
      reason: `${hit.evidence.reason};java-annotation-span`,
    },
  };
}

function matchAliasHitsOnLine(
  line: string,
  lineIndex: number,
  filePath: string,
  rulesById: Map<string, PiiSignalRule>,
  matchedRuleIds: Set<string>,
): PiiSignalHit[] {
  const hits: PiiSignalHit[] = [];
  const lineMatched = new Set<string>(matchedRuleIds);

  for (const { token, startIndex } of extractLineIdentifierTokens(line)) {
    for (const ruleId of resolveAliasRuleIdsForToken(
      token,
      line,
      startIndex,
      filePath,
    )) {
      if (lineMatched.has(ruleId)) {
        continue;
      }
      const rule = rulesById.get(ruleId);
      if (!rule) {
        continue;
      }
      lineMatched.add(ruleId);
      hits.push({
        id: rule.id,
        category: rule.category,
        labels: [...rule.labels],
        evidence: {
          filePath,
          startLine: lineIndex + 1,
          endLine: lineIndex + 1,
          reason: `matched pii:${rule.id} alias:${token}`,
        },
      });
    }
  }

  return hits;
}

export function matchPiiSignalsInFile(
  input: MatchPiiSignalsFileInput,
  rules: PiiSignalRule[] = loadPiiSignalRules(),
): PiiSignalHit[] {
  const lines = input.content.split(/\r?\n/);
  const hits: PiiSignalHit[] = [];
  const rulesById = ruleById(rules);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const regexMatchedRuleIds = new Set<string>();

    for (const rule of rules) {
      if (!rule.patterns.some((pattern) => pattern.test(line))) {
        continue;
      }
      regexMatchedRuleIds.add(rule.id);
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

    hits.push(
      ...matchAliasHitsOnLine(
        line,
        lineIndex,
        input.filePath,
        rulesById,
        regexMatchedRuleIds,
      ),
    );
  }

  return hits.map((hit) => expandJavaAnnotatedFieldEvidence(lines, hit));
}

export function matchPiiSignalsInFiles(
  files: MatchPiiSignalsFileInput[],
  rules: PiiSignalRule[] = loadPiiSignalRules(),
): PiiSignalHit[] {
  return files.flatMap((file) => matchPiiSignalsInFile(file, rules));
}
