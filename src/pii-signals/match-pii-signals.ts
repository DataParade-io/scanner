import type { PiiSignalRule } from "./pii-signal-rules";
import type { CommentContext } from "./comment-context";
import { loadPiiSignalRules } from "./pii-signal-rules";
import type { MentionDeclaration } from "../analyze/mention-declaration";
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
  /**
   * Where the match sits: in code, or only in a comment or docstring. Comment
   * matches are kept as context; mention and data-item layers use code matches.
   */
  location?: "code" | "comment";
  /** Comments immediately around a code match (KDATAP-b512a8). */
  commentContext?: CommentContext;
  /** Data item group of a code match, e.g. `email:customer` (KDATAP-c8a46a). */
  group?: string;
  /** The group is only the receiver variable's name; a typed receiver's class may replace it. */
  receiverNamesEntity?: boolean;
  /**
   * The group comes only from a receiver variable's name (`profile.email` -> profile).
   * Grouping applies it after typed-receiver and table evidence (KDATAP-c8a46a).
   */
  weakGroup?: boolean;
  /** Set during matching: the qualifier is only a receiver variable's name. */
  weakName?: boolean;
  /**
   * Same-file declaration of the mentioned name, or `unresolved` (KDATAP-8e47c2).
   * Absent when the line has no code occurrence to declare or the file is not analyzed.
   */
  declaration?: MentionDeclaration;
  /**
   * Entity fields the line defines or reads, as `entity.field` (`order.user_email`).
   * `definition` is true where the line declares the field (KDATAP-c8a46a).
   */
  fieldKeys?: Array<{ key: string; definition: boolean }>;
  /** Entity of the class the mention is reached through (`usersService.createOne({ email })` -> `user`). */
  receiverEntity?: string;
  /** Same-file declaration lines of variables passed into a key on this line. */
  passedDeclarations?: Array<{ line: number; name: string }>;
  /**
   * Parameter declarations in other (or the same) files that a call argument on this
   * line passes into, as `${signalId}@${filePath}:${line}` (KDATAP-c8a46a).
   */
  callLinks?: string[];
  /** Entity of the one table the enclosing function queries through a query builder. */
  tableEntity?: string;
  /** Lines of other mentions whose variable is passed into a concept key on this line. */
  passedMentionLines?: number[];
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
