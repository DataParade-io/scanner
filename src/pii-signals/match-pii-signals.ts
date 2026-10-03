import type { PiiSignalRule } from "./pii-signal-rules";
import type { CommentContext } from "./comment-context";
import { loadPiiSignalRules } from "./pii-signal-rules";
import type { OccurrenceDeclaration } from "../analyze/occurrence-declaration";
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
   * matches are kept as context; occurrence and data-item layers use code matches.
   */
  location?: "code" | "comment";
  /** Comments immediately around a code match (KDATAP-b512a8). */
  commentContext?: CommentContext;
  /** Data item group of a code match, e.g. `email:customer` (KDATAP-c8a46a). */
  group?: string;
  /**
   * The evidence that named the group: `declaration`, `name` (a qualifier or defined
   * field), `column` (a declared catalog column), `record-key` (a JSON record column key),
   * `receiver-vote`, `table-vote`, `weak-name`, `file-vote`, or `location`.
   */
  groupBasis?: string;
  /** The declared or record column whose evidence holds the group together. */
  groupColumn?: string;
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
  declaration?: OccurrenceDeclaration;
  /**
   * Entity fields the line defines or reads, as `entity.field` (`order.user_email`).
   * `definition` is true where the line declares the field (KDATAP-c8a46a).
   */
  fieldKeys?: Array<{ key: string; definition: boolean }>;
  /** Entity of the class the occurrence is reached through (`usersService.createOne({ email })` -> `user`). */
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
  /** Lines of other occurrences whose variable is passed into a concept key on this line. */
  passedOccurrenceLines?: number[];
  /**
   * Keys and keyword arguments the line defines, and member writes on it, that name the
   * concept (KDATAP-7a094c): the evidence for which stored column the occurrence names.
   */
  columnHints?: { keys: string[]; writes: Array<{ name: string; receiverClass?: string; receiverName?: string }> };
  /**
   * The catalogued stored column the occurrence names, as `table.column` (KDATAP-7a094c).
   * Two different columns are never one data item.
   */
  column?: string;
  /** The column is the catalog declaration the occurrence's own line is (KDATAP-fb8019). */
  columnDeclared?: boolean;
  /**
   * The column is a key written into a JSON record column (`Model.field.key`, KDATAP-fb8019):
   * a copy stored as its own data item, joined to nothing but the same record column.
   */
  columnRecord?: boolean;
}

export interface MatchPiiSignalsFileInput {
  filePath: string;
  content: string;
}

export { piiSignalIdentity, rawHitIdentity, occurrenceIdentity, dataItemIdentity } from "../eval-layers/identities";

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

/**
 * A dotted key passed to a translation call (`I18n.t('conversations.reply.email.header')`,
 * `t("errors.contacts.phone_number.invalid")`): a message, not a value. Other dotted keys
 * (`config('mail.from.address')`) can name a configured address and are kept.
 */
const TRANSLATION_KEY = /(\b(?:I18n\.t|i18n\.t|translate|t|__|\$t)\(\s*)(['"`])[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}\2/g;

/**
 * A module path or URL path (`'../../services/email-service'`) or a prose message
 * (`'Email not found.'`): it names a file or tells a person something, not a value.
 * SQL, other strings and messages that interpolate a value (`"Logout failed for
 * #{channel.email}."`) keep matching.
 */
const PATH_OR_PROSE_STRING =
  /(['"`])(?:[\w.@-]*\/[\w./@-]*|[A-Z](?:(?![$#]\{)[^'"`\n])*\s(?:(?![$#]\{)[^'"`\n])*\s(?:(?![$#]\{)[^'"`\n])*[.!?])\1/g;

/**
 * A capitalized Email or Mail class reference (`Channel::Email`, `models.Email.findOne`,
 * `Email::Cleaner`): a model or module, not an address. Lowercase members (`user.email`)
 * are untouched.
 */
const EMAIL_CLASS_REFERENCE = /(::|\.)(?:Email|Mail)\b/g;
const EMAIL_NAMESPACE = /\b(?:Email|Mail)(?=::)/g;
const NEVER = /(?!)/g;
/** A Ruby predicate (`inbox.email?`, `mail?`) asks a yes/no question; it is not an address. */
const EMAIL_PREDICATE = /(\.|\b)e?mails?\?(?!\?)/g;

export function matchPiiSignalsInFile(
  input: MatchPiiSignalsFileInput,
  rules: PiiSignalRule[] = loadPiiSignalRules(),
): PiiSignalHit[] {
  const lines = input.content.split(/\r?\n/);
  const hits: PiiSignalHit[] = [];
  const rulesById = ruleById(rules);

  // `email?` is a predicate only in Ruby; in TypeScript it is an optional field (`email?: string`).
  const rubyFile = /\.rb$/.test(input.filePath);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    // A translation key names a message, not a value: it is blanked before matching.
    const line = (lines[lineIndex] ?? "")
      .replace(TRANSLATION_KEY, '$1""')
      .replace(PATH_OR_PROSE_STRING, '""')
      .replace(EMAIL_CLASS_REFERENCE, "$1Klass")
      .replace(EMAIL_NAMESPACE, "Klass")
      .replace(rubyFile ? EMAIL_PREDICATE : NEVER, "$1kind?");
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
