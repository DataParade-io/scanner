/**
 * Comment context around a personal-data match (KDATAP-b512a8).
 *
 * Works from a file's raw text and its layout-preserving comment-stripped text:
 * wherever the two differ on a line, that difference is comment text. No parser
 * is needed, so it works for every language the stripper supports.
 */

export interface CommentContext {
  /** Contiguous comment block directly above the match, top to bottom. */
  above?: string[];
  /** Comment text on the match line itself. */
  sameLine?: string;
  /** Contiguous comment-only lines directly below the match, top to bottom. */
  below?: string[];
}

const MAX_CONTEXT_LINES = 30;

/** Decorator and annotation lines that sit between a doc comment and its declaration. */
const DECORATOR_LINE = /^@[\w.]+(\(.*\))?\s*$/;

export class CommentLines {
  private readonly raw: string[];
  private readonly stripped: string[];

  constructor(rawContent: string, strippedContent: string) {
    this.raw = rawContent.split(/\r?\n/);
    this.stripped = strippedContent.split(/\r?\n/);
  }

  /** Comment text on a 1-based line, or undefined when the line has none. */
  commentText(line: number): string | undefined {
    const raw = this.raw[line - 1] ?? "";
    const stripped = this.stripped[line - 1] ?? "";
    let text = "";
    for (let i = 0; i < raw.length; i += 1) {
      if (raw[i] !== (stripped[i] ?? "")) {
        text += raw[i];
      } else if (text.length > 0 && !text.endsWith(" ")) {
        text += " ";
      }
    }
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned.length > 0 ? cleaned : undefined;
  }

  /** True when a 1-based line holds only comment text. */
  isCommentOnly(line: number): boolean {
    const raw = this.raw[line - 1];
    const stripped = this.stripped[line - 1];
    return raw !== undefined && raw.trim().length > 0 && (stripped ?? "").trim().length === 0;
  }

  private isDecorator(line: number): boolean {
    return DECORATOR_LINE.test((this.stripped[line - 1] ?? "").trim());
  }

  /** True when a match on a 1-based line appears only in comment text. */
  lineMatchIsCommentOnly(line: number, matchesInStripped: boolean): boolean {
    return !matchesInStripped && this.commentText(line) !== undefined;
  }

  context(startLine: number, endLine: number): CommentContext | undefined {
    const above: string[] = [];
    let cursor = startLine - 1;
    while (cursor >= 1 && above.length < MAX_CONTEXT_LINES) {
      if (this.isCommentOnly(cursor)) {
        above.unshift(this.commentText(cursor) ?? "");
      } else if (!this.isDecorator(cursor)) {
        break;
      }
      cursor -= 1;
    }
    const below: string[] = [];
    cursor = endLine + 1;
    while (cursor <= this.raw.length && below.length < MAX_CONTEXT_LINES && this.isCommentOnly(cursor)) {
      below.push(this.commentText(cursor) ?? "");
      cursor += 1;
    }
    const sameLine = this.commentText(startLine);
    const result: CommentContext = {};
    if (above.length > 0) result.above = above;
    if (sameLine !== undefined && !this.isCommentOnly(startLine)) result.sameLine = sameLine;
    if (below.length > 0) result.below = below;
    return Object.keys(result).length > 0 ? result : undefined;
  }
}
