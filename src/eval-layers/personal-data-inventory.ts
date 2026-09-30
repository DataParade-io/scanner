import { appendFileSync } from "node:fs";
import type { FileInfo } from "../core/types/file";
import { ingestFileSystemWithOutcomes } from "../ingest/file-system";
import type { PathEligibilityOutcome } from "../ingest/eligibility";
import { stripCommentsForLanguage } from "../analyzers/shared/strip-comments-for-language";
import { CommentLines } from "../pii-signals/comment-context";
import { analyzeSource, initAnalysisEngine, isAnalysisEngineReady } from "../analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../analyze/languages";
import { resolveMentionDeclaration } from "../analyze/mention-declaration";
import { mentionReceiver, type ReceiverVia } from "../analyze/mention-receiver";
import { mentionFieldKeys, passedMentionLines, passedValueDeclarations } from "../analyze/mention-fields";
import {
  addConceptFunctions,
  conceptCallArguments,
  conceptFunctions,
  resolveCallArgument,
  type ConceptCallArgument,
  type ConceptFunctionIndex,
} from "../analyze/call-links";
import { signalTokenMatcher } from "../pii-signals/signal-token";
import { assignDeclarationGroups, classEntity, declarationNodeId, identifierWords, qualify } from "../pii-signals/mention-group";
import type { AnalyzedFile } from "../analyze/engine/analyzed-file";
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
/**
 * Attach same-file declarations to the code hits of one file. Parses only when the file
 * has code hits and a language pack; does nothing when the engine is not initialized or
 * the parse fails (KDATAP-8e47c2).
 */
/** A hit with the call arguments it appears in, before callees are resolved repo-wide. */
type PendingHit = PiiSignalHit & {
  callArguments?: ConceptCallArgument[];
  /** Receiver class or binding names, resolved against the repository's classes later. */
  receiver?: { className?: string; names: string[]; via?: ReceiverVia; legacy: boolean };
};

/** Class names of the analyzed files by lower-cased name: `usersservice` -> `UsersService`. */
type ClassIndex = Map<string, Set<string>>;

function withDeclarations(
  file: FileInfo,
  hits: PiiSignalHit[],
  functions: ConceptFunctionIndex,
  classes: ClassIndex,
  declared: Set<string>,
): PendingHit[] {
  if (!isAnalysisEngineReady() || !hits.some((hit) => hit.location === "code")) return hits;
  const pack = packForFile(file.language, file.path);
  const analyzed = pack ? analyzeSource(pack, file.content) : undefined;
  if (!analyzed) return hits;
  const lines = file.content.split(/\r?\n/);
  analyzed.setKnownClass((name) => declared.has(name));
  try {
    const definitions = analyzed.functionDefinitions();
    for (const name of analyzed.classNames()) {
      const set = classes.get(name.toLowerCase()) ?? new Set<string>();
      set.add(name);
      classes.set(name.toLowerCase(), set);
    }
    for (const id of new Set(hits.filter((hit) => hit.location === "code").map((hit) => hit.id))) {
      addConceptFunctions(functions, id, file.path, conceptFunctions(definitions, signalTokenMatcher(id, file.path)));
    }
    const codeLinesById = new Map<string, Set<number>>();
    for (const hit of hits) {
      if (hit.location !== "code") continue;
      const set = codeLinesById.get(hit.id) ?? new Set<number>();
      set.add(hit.evidence.endLine);
      codeLinesById.set(hit.id, set);
    }
    return hits.map((hit) => {
      if (hit.location !== "code") return hit;
      const isConceptToken = signalTokenMatcher(hit.id, file.path);
      const declaration = resolveMentionDeclaration(analyzed, hit.evidence.endLine, isConceptToken);
      const fieldKeys = mentionFieldKeys(analyzed, hit.evidence.endLine, lines[hit.evidence.endLine - 1] ?? "", isConceptToken);
      const passedDeclarations = passedValueDeclarations(analyzed, hit.evidence.endLine, isConceptToken);
      const passedLines = passedMentionLines(
        analyzed,
        hit.evidence.endLine,
        isConceptToken,
        codeLinesById.get(hit.id) ?? new Set<number>(),
      );
      const callArguments = conceptCallArguments(analyzed, hit.evidence.endLine, isConceptToken);
      const tableEntity = queriedTableEntity(analyzed, lines, hit.evidence.endLine);
      const found = mentionReceiver(analyzed, hit.evidence.endLine, isConceptToken);
      let legacy = false;
      if (process.env.DATAPARADE_RECEIVER_STATS && found.className) {
        analyzed.setFactoryReturnTypes(false);
        legacy = mentionReceiver(analyzed, hit.evidence.endLine, isConceptToken).className === found.className;
        analyzed.setFactoryReturnTypes(true);
      }
      return {
        ...hit,
        ...(found.className || found.names.length > 0 ? { receiver: { ...found, legacy } } : {}),
        ...(callArguments.length > 0 ? { callArguments } : {}),
        ...(declaration ? { declaration } : {}),
        ...(fieldKeys.length > 0 ? { fieldKeys } : {}),
        ...(passedDeclarations.length > 0 ? { passedDeclarations } : {}),
        ...(passedLines.length > 0 ? { passedMentionLines: passedLines } : {}),
        ...(tableEntity ? { tableEntity } : {}),
      };
    });
  } catch {
    return hits;
  } finally {
    analyzed.dispose();
  }
}

/** Query-builder calls that name a table: knex('t'), db('t'), .from('t'), .into('t'), .table('t'), joins. */
const QUERIED_TABLE =
  /(?:\b(?:knex|database|db|trx)|\.(?:from|into|table|join|innerJoin|leftJoin))\s*\(\s*['"`]([A-Za-z_]\w*)['"`]/g;

/**
 * The entity of the one table the function around a line queries through a query
 * builder: `.from('directus_users')` -> `user` (the table name's last word, singular).
 * Undefined when the function queries no table or several.
 */
function queriedTableEntity(analyzed: AnalyzedFile, lines: string[], line: number): string | undefined {
  const scope = analyzed.enclosingFunction(line, 0);
  if (!scope) return undefined;
  const text = lines.slice(scope.startLine - 1, scope.endLine).join("\n");
  const tables = new Set([...text.matchAll(QUERIED_TABLE)].map((match) => match[1]));
  if (tables.size !== 1) return undefined;
  const words = identifierWords([...tables][0]);
  const last = words[words.length - 1];
  if (!last) return undefined;
  return last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
}

const DATA_OWNER_CLASS = /(Service|Services|Repository|Model|Store|Dao|DAO|Entity)$/;

function annotatedHitsForFile(
  file: FileInfo,
  functions: ConceptFunctionIndex,
  classes: ClassIndex,
  declared: Set<string>,
): PendingHit[] {
  return withDeclarations(file, matchedHitsForFile(file), functions, classes, declared);
}

/**
 * Resolve each hit's call arguments to callee parameter declarations across the
 * repository (KDATAP-c8a46a). Returns the hits without the pending arguments.
 */
function withCallLinks(hits: PendingHit[], functions: ConceptFunctionIndex, classes: ClassIndex): PiiSignalHit[] {
  let created = 0;
  let resolved = 0;
  const stats: Record<string, number> = {};
  const out = hits.map(({ callArguments, receiver, receiverNamesEntity, ...pending }) => {
    let hit: PiiSignalHit = pending;
    if (receiver) {
      let className = receiver.className;
      let source = className ? (receiver.legacy ? "typed" : "factory") : "";
      for (const name of className ? [] : receiver.names) {
        const found = classes.get(name.toLowerCase());
        // A name match is only trusted for classes that own data (UsersService,
        // MemberRepository), not for helpers an address is merely passed to
        // (gravatar -> Gravatar, commentEmailRenderer, settingHelper).
        if (found?.size === 1 && DATA_OWNER_CLASS.test([...found][0])) {
          className = [...found][0];
          source = "name";
          break;
        }
      }
      const receiverEntity = className ? classEntity(className) : undefined;
      if (receiverEntity && receiverEntity !== hit.id) {
        hit = { ...hit, receiverEntity };
        // A group that is only the receiver variable's name gives way to the class entity.
        if (receiverNamesEntity && receiver.via === "direct" && process.env.DATAPARADE_RECEIVER_NAMES !== "off") {
          const group = `${hit.id}:${receiverEntity}`;
          if (process.env.DATAPARADE_RECEIVER_NAME_LOG && group !== hit.group) {
            appendFileSync(
              process.env.DATAPARADE_RECEIVER_NAME_LOG,
              `${hit.evidence.filePath}:${hit.evidence.endLine}\t${hit.group}\t${group}\t${source}\n`,
            );
          }
          hit = { ...hit, group };
        }
        const key = `${receiver.via}:${source}`;
        stats[key] = (stats[key] ?? 0) + 1;
      }
    }
    if (!callArguments) return hit;
    const links = new Set<string>();
    for (const argument of callArguments) {
      created += 1;
      const target = resolveCallArgument(functions, hit.id, argument);
      if (!target) continue;
      resolved += 1;
      links.add(declarationNodeId(hit.id, target.filePath, target.line));
    }
    return links.size > 0 ? { ...hit, callLinks: [...links] } : hit;
  });
  if (process.env.DATAPARADE_CALL_LINK_STATS) {
    process.stderr.write(`call-links created=${created} resolved=${resolved}\n`);
  }
  if (process.env.DATAPARADE_RECEIVER_STATS) {
    process.stderr.write(`receiver-entities ${JSON.stringify(stats)}\n`);
  }
  return out;
}

function matchedHitsForFile(file: FileInfo): PiiSignalHit[] {
  const lines = file.content.split(/\r?\n/);
  const withGroup = (hit: PiiSignalHit): PiiSignalHit => {
    const found = qualify(lines[hit.evidence.endLine - 1] ?? "", hit.id);
    if (!found) return hit;
    return {
      ...hit,
      group: `${hit.id}:${found.qualifier}`,
      ...(found.fromReceiver ? { receiverNamesEntity: true } : {}),
    };
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
 * Load the tree-sitter engine used for mention declarations. A failure to load leaves
 * the engine off: hits simply carry no declaration.
 */
export async function ensureDeclarationEngine(): Promise<void> {
  try {
    await initAnalysisEngine(LANGUAGE_PACKS);
  } catch {
    /* declarations are optional */
  }
}

/**
 * Match personal-data signals from an already-ingested file set.
 * Used when the orchestrator scan has already walked the repository tree.
 */
export function buildPersonalDataInventoryFromIngest(
  files: FileInfo[],
  ingestOutcomes: PathEligibilityOutcome[],
): PersonalDataInventory {
  const functions: ConceptFunctionIndex = new Map();
  const classes: ClassIndex = new Map();
  // Every class or interface declared anywhere in the repository, found by keyword so the
  // index is complete before the first file is analyzed.
  const declared = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/\b(?:class|interface)\s+([A-Z][A-Za-z0-9_]*)/g)) declared.add(match[1]);
  }
  const pending = files.flatMap((file) => annotatedHitsForFile(file, functions, classes, declared));
  const hits = assignDeclarationGroups(withCallLinks(pending, functions, classes));

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
  await ensureDeclarationEngine();
  const ingestResult = await ingestFileSystemWithOutcomes(rootPath);
  return buildPersonalDataInventoryFromIngest(
    ingestResult.files,
    ingestResult.outcomes,
  );
}
