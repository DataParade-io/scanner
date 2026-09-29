import type { FileLanguage } from "../../core/types/file";
import { stripCommentsPreservingLayout, type StripCommentsOptions } from "./strip-comments";

/**
 * Per-language comment stripping options, matching the ones each analyzer uses.
 * Config formats (json, yaml, env, terraform, dockerfile) are left unchanged: an
 * unquoted `#` inside a YAML value is not a comment, and these files carry no code.
 */
const OPTIONS: Partial<Record<FileLanguage, StripCommentsOptions>> = {
  typescript: { backtickStrings: true },
  javascript: { backtickStrings: true },
  python: { hashComments: true, tripleQuoteStrings: true },
  go: { backtickStrings: true },
  java: { tripleQuotedStrings: true },
  kotlin: { tripleQuotedStrings: true, nestedBlockComments: true },
  php: { hashComments: true },
  csharp: { verbatimStrings: true },
  cpp: { rawStrings: true },
  ruby: { hashComments: true },
  rust: { nestedBlockComments: true },
  swift: { nestedBlockComments: true },
};

const DOCSTRING_OPEN = /^[ \t]*[rRuU]?("""|''')/;

function blankRange(chars: string[], from: number, to: number): void {
  for (let i = from; i < to; i += 1) {
    if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
}

/**
 * Blank Python docstrings: a triple-quoted string that starts a line and is either
 * the first statement in the file or follows a line ending in `:` (a def, class,
 * or other block opener). Other triple-quoted strings, such as SQL passed to a
 * call, are kept. Layout is preserved, so line numbers do not change.
 */
export function blankPythonDocstrings(source: string): string {
  const chars = source.split("");
  const lines = source.split("\n");
  let offset = 0;
  let previousSignificant: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const open = DOCSTRING_OPEN.exec(line);
    const atDocstringPosition =
      previousSignificant === undefined || previousSignificant.trimEnd().endsWith(":");
    if (open && atDocstringPosition) {
      const delimiter = open[1];
      const start = offset + open[0].length - delimiter.length;
      const close = source.indexOf(delimiter, start + delimiter.length);
      const end = close === -1 ? source.length : close + delimiter.length;
      blankRange(chars, start, end);
      // Skip the lines the docstring covers.
      const covered = source.slice(start, end).split("\n").length - 1;
      for (let skip = 0; skip < covered; skip += 1) {
        offset += lines[index].length + 1;
        index += 1;
      }
      offset += lines[index].length + 1;
      previousSignificant = '""""""';
      continue;
    }
    if (line.trim().length > 0) {
      previousSignificant = line;
    }
    offset += line.length + 1;
  }
  return chars.join("");
}

/** Layout-preserving comment stripping for a file's language; unknown languages are unchanged. */
export function stripCommentsForLanguage(source: string, language: FileLanguage | undefined): string {
  const options = language ? OPTIONS[language] : undefined;
  if (!options) {
    return source;
  }
  const stripped = stripCommentsPreservingLayout(source, options);
  return language === "python" ? blankPythonDocstrings(stripped) : stripped;
}
