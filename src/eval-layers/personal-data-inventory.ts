import { appendFileSync, readFileSync } from "node:fs";
import type { FileInfo } from "../core/types/file";
import { ingestFileSystemWithOutcomes } from "../ingest/file-system";
import type { PathEligibilityOutcome } from "../ingest/eligibility";
import { stripCommentsForLanguage } from "../analyzers/shared/strip-comments-for-language";
import { CommentLines } from "../pii-signals/comment-context";
import { analyzeSource, initAnalysisEngine, isAnalysisEngineReady } from "../analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../analyze/languages";
import { resolveOccurrenceDeclaration } from "../analyze/occurrence-declaration";
import { occurrenceReceiver, type ReceiverVia } from "../analyze/occurrence-receiver";
import { collapseColumns, collectColumnFacts } from "../analyze/column-catalog";
import { readSchemaFiles, type SchemaFile } from "../ingest/schema-files";
import { recordKeyColumns } from "../analyze/json-record-keys";
import { hasConceptProfile } from "../analyze/concept-profile";
import { columnIndex, isDeclaredColumn, isRecordColumn, occurrenceColumn } from "../analyze/column-identity";
import { occurrenceFieldKeys, passedOccurrenceLines, passedValueDeclarations } from "../analyze/occurrence-fields";
import {
  addConceptFunctions,
  conceptCallArguments,
  conceptFunctions,
  resolveCallArgument,
  type ConceptCallArgument,
  type ConceptFunctionIndex,
} from "../analyze/call-links";
import { signalTokenMatcher } from "../pii-signals/signal-token";
import { applyGroupLabels, assignDeclarationGroups, classEntity, declarationNodeId, identifierWords, qualify } from "../pii-signals/occurrence-group";
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
    const memberWrites = analyzed.memberAccesses().filter((access) => access.write);
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
      const declaration = resolveOccurrenceDeclaration(analyzed, hit.evidence.endLine, isConceptToken);
      const fieldKeys = occurrenceFieldKeys(analyzed, hit.evidence.endLine, lines[hit.evidence.endLine - 1] ?? "", isConceptToken);
      const passedDeclarations = passedValueDeclarations(analyzed, hit.evidence.endLine, isConceptToken);
      const passedLines = passedOccurrenceLines(
        analyzed,
        hit.evidence.endLine,
        isConceptToken,
        codeLinesById.get(hit.id) ?? new Set<number>(),
      );
      const callArguments = conceptCallArguments(analyzed, hit.evidence.endLine, isConceptToken);
      const tableEntity = queriedTableEntity(analyzed, lines, hit.evidence.endLine);
      const columnHints = columnHintsOnLine(analyzed, memberWrites, hit.evidence.endLine, isConceptToken);
      const found = occurrenceReceiver(analyzed, hit.evidence.endLine, isConceptToken, lines[hit.evidence.endLine - 1]);
      let legacy = false;
      if (process.env.DATAPARADE_RECEIVER_STATS && found.className) {
        analyzed.setFactoryReturnTypes(false);
        legacy = occurrenceReceiver(analyzed, hit.evidence.endLine, isConceptToken).className === found.className;
        analyzed.setFactoryReturnTypes(true);
      }
      return {
        ...hit,
        ...(found.className || found.names.length > 0 ? { receiver: { ...found, legacy } } : {}),
        ...(callArguments.length > 0 ? { callArguments } : {}),
        ...(declaration ? { declaration } : {}),
        ...(fieldKeys.length > 0 ? { fieldKeys } : {}),
        ...(passedDeclarations.length > 0 ? { passedDeclarations } : {}),
        ...(passedLines.length > 0 ? { passedOccurrenceLines: passedLines } : {}),
        ...(tableEntity ? { tableEntity } : {}),
        ...(columnHints ? { columnHints } : {}),
      };
    });
  } catch {
    return hits;
  } finally {
    analyzed.dispose();
  }
}

/**
 * Keys and keyword arguments the line defines, and member writes on it, that name the
 * concept: what the line says about which stored column it fills (KDATAP-7a094c).
 */
function columnHintsOnLine(
  analyzed: AnalyzedFile,
  writes: ReadonlyArray<{ name: string; line: number; receiverClass?: string; receiverName?: string }>,
  line: number,
  isConceptToken: (token: string) => boolean,
): PiiSignalHit["columnHints"] {
  const keys = [
    ...new Set(
      analyzed
        .sitesOnLine(line)
        .filter((site) => site.role === "definition" && site.kind === "key" && isConceptToken(site.name))
        .map((site) => site.name),
    ),
  ];
  const written = writes
    .filter((access) => access.line === line && isConceptToken(access.name))
    .map((access) => ({
      name: access.name,
      ...(access.receiverClass ? { receiverClass: access.receiverClass } : {}),
      ...(access.receiverName ? { receiverName: access.receiverName } : {}),
    }));
  return keys.length > 0 || written.length > 0 ? { keys, writes: written } : undefined;
}

/** Query-builder calls that name a table: knex('t'), db('t'), .from('t'), .into('t'), .table('t'), joins. */
const QUERIED_TABLE =
  /(?:\b(?:knex|database|db|trx)|\.(?:from|into|table|join|innerJoin|leftJoin))\s*\(\s*['"`]([A-Za-z_]\w*)['"`]/g;
/** ORM query entry points that name a model: `.query('admin::user')`, `getRepository('User')`. */
const QUERIED_MODEL = /\.(?:query|getRepository|model)\s*\(\s*['"`]([A-Za-z_][\w:.\-]*)['"`]/g;

/**
 * The entity of the one table the function around a line queries through a query
 * builder: `.from('directus_users')` -> `user` (the table name's last word, singular).
 * Undefined when the function queries no table or several.
 */
function queriedTableEntity(analyzed: AnalyzedFile, lines: string[], line: number): string | undefined {
  const scope = analyzed.enclosingFunction(line, 0);
  if (!scope) return undefined;
  const prisma = enclosingPrismaModel(lines, scope.startLine, line);
  if (prisma) return prisma;
  const text = lines.slice(scope.startLine - 1, scope.endLine).join("\n");
  // Query-builder table calls count across the function; ORM model entry points only in
  // the occurrence's own statement (two lines either side), since a function may touch
  // several models (`this.model('Role')` next to a user lookup).
  const near = lines.slice(Math.max(scope.startLine, line - 2) - 1, Math.min(scope.endLine, line + 2)).join("\n");
  const tables = new Set([
    ...[...text.matchAll(QUERIED_TABLE)].map((match) => match[1]),
    ...[...near.matchAll(QUERIED_MODEL)].map((match) => match[1]),
  ]);
  if (tables.size !== 1) return undefined;
  // `admin::user`, `plugin::users-permissions.user`, `directus_users`: the last segment.
  const words = identifierWords([...tables][0].split(/::|\./).pop() ?? "");
  const last = words[words.length - 1];
  if (!last) return undefined;
  return last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
}

/** A Prisma client model call: `prisma.attendee.create(`, `tx.bookingReport.findMany(`. */
const PRISMA_MODEL_CALL =
  /\.([a-z][A-Za-z0-9]*)\s*\.\s*(?:findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*\(/g;

/**
 * The model of the Prisma client call whose arguments contain a line (KDATAP-fded10):
 * `prisma.attendee.create({ data: { email } })` -> `attendee` for the `email` line, however
 * many lines the call spans. The innermost call still open at the line wins.
 */
function enclosingPrismaModel(lines: string[], start: number, line: number): string | undefined {
  const text = lines.slice(start - 1, line).join("\n");
  let found: string | undefined;
  for (const match of text.matchAll(PRISMA_MODEL_CALL)) {
    let depth = 0;
    for (const char of text.slice((match.index ?? 0) + match[0].length - 1)) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      if (depth === 0) break;
    }
    if (depth > 0) found = match[1];
  }
  if (!found) return undefined;
  const words = identifierWords(found);
  return words.length > 0 ? words.join("_") : undefined;
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
    // A group that is only a receiver variable's name is weak until a class replaces it.
    let weak = pending.weakName === true && pending.group !== undefined;
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
          weak = false;
        }
        const key = `${receiver.via}:${source}`;
        stats[key] = (stats[key] ?? 0) + 1;
      }
    }
    if (weak) hit = { ...hit, weakGroup: true };
    delete hit.weakName;
    if (!callArguments) return hit;
    const links = new Set<string>();
    for (const argument of callArguments) {
      created += 1;
      const target = resolveCallArgument(functions, hit.id, argument);
      if (!target) continue;
      resolved += 1;
      links.add(declarationNodeId(hit.id, target.filePath, target.line, target.name));
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

/**
 * Give each code occurrence the catalogued stored column it names (KDATAP-7a094c). The
 * catalog is per signal: the email and phone signals of one scan each use their own
 * columns. Nothing happens for signals without a concept profile or when the engine is off.
 */
function withColumns(hits: PiiSignalHit[], files: FileInfo[], schemaFiles: readonly SchemaFile[]): PiiSignalHit[] {
  const ids = new Set(hits.filter((hit) => hit.location !== "comment" && hasConceptProfile(hit.id)).map((hit) => hit.id));
  if (ids.size === 0 || !isAnalysisEngineReady()) return hits;
  const { candidates, facts } = collectColumnFacts(files, schemaFiles);
  const recordKeys = recordKeyColumns(facts, candidates);
  const indexes = new Map([...ids].map((id) => [id, columnIndex(collapseColumns(candidates, id), recordKeys)]));
  return hits.map((hit) => {
    const index = indexes.get(hit.id);
    if (!index || hit.location === "comment") return hit;
    const evidence = {
      filePath: hit.evidence.filePath,
      line: hit.evidence.endLine,
      ...(hit.group ? { group: hit.group } : {}),
      ...(hit.receiverEntity ? { receiverEntity: hit.receiverEntity } : {}),
      ...(hit.tableEntity ? { tableEntity: hit.tableEntity } : {}),
      ...(hit.columnHints ? { columnHints: hit.columnHints } : {}),
    };
    const column = occurrenceColumn(index, evidence);
    if (!column) return hit;
    return {
      ...hit,
      column,
      ...(isDeclaredColumn(index, evidence, column) ? { columnDeclared: true } : {}),
      ...(isRecordColumn(index, evidence, column) ? { columnRecord: true } : {}),
    };
  });
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
      ...(found.weak ? { weakName: true } : {}),
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
 * Load the tree-sitter engine used for occurrence declarations. A failure to load leaves
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
  schemaFiles: readonly SchemaFile[] = [],
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
  const grouped = assignDeclarationGroups(withColumns(withCallLinks(pending, functions, classes), files, schemaFiles));
  // Optional data-item labels from a classifier: DATAPARADE_GROUP_LABELS names a JSON file
  // mapping group names to data-item keys.
  const labelsPath = process.env.DATAPARADE_GROUP_LABELS;
  const hits = labelsPath
    ? applyGroupLabels(grouped, JSON.parse(readFileSync(labelsPath, "utf8")) as Record<string, string>)
    : grouped;

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
    await readSchemaFiles(rootPath),
  );
}
