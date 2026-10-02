import path from "path";
import type { FileInfo } from "../core/types/file";
import { loadPiiSignalRules } from "../pii-signals/pii-signal-rules";
import { signalTokenMatcher } from "../pii-signals/signal-token";
import { conceptProfile, normalizeTypeName } from "./concept-profile";
import type { AnalyzedFile } from "./engine/analyzed-file";
import { analyzeSource } from "./engine/engine";
import type { FieldDeclaration, KeyDeclaration } from "./engine/types";
import { packForFile } from "./languages";
import { recordFacts, type RecordFacts } from "./json-record-keys";
import { schemaFileKind, type SchemaFile } from "../ingest/schema-files";

/**
 * Catalog of the stored columns a repository declares (KDATAP-33da4c): the closed set of
 * "where can this concept be stored" that a decision model chooses from, and that
 * grouping can link occurrences to. Deterministic, no model calls.
 *
 * Declarations come from four sources, each found on the parse tree (the engine's
 * class-field, key and call listings), not on raw text:
 *   - `orm-field`: Django `models.*Field` class attributes, TypeORM `@Column` properties,
 *     Sequelize `define` / `init` attribute objects, Mongoose `Schema` keys;
 *   - `schema-object`: ghost-style objects, `members: { email: { type: 'string' } }`;
 *   - `migration`: knex `createTable` / `table` / `alterTable` column calls, and helper
 *     calls that take a table and a column name (`helper.changeToType('users', 'email')`,
 *     `addColumn`);
 *   - `content-type`: strapi content types, a `collectionName` with `attributes`, in
 *     source or in a `schema.json` read with `JSON.parse` (ingestion keeps JSON files);
 *   - `record-type` (KDATAP-e3ff3c): TypeScript record types, an `interface` or object type
 *     alias with an `id` member and a created or updated timestamp member, the rows a client
 *     SDK or service reads and writes (`interface User { id; email; new_email; created_at }`).
 *     Parameter and option types, which carry neither, are not records. Record types are a
 *     fallback: where a repository declares storage for the concept (any source above), the
 *     stored columns decide and its DTO and response types, views of them, are left out.
 *
 * Storage schema files (KDATAP-fded10), read beside the source and passed in as
 * `SchemaFile`s, add two more:
 *   - `prisma-model`: `model User { email String @unique }` in `*.prisma`, the table from
 *     `@@map`, the column from `@map`; only `String` fields, never relations;
 *   - `sql-ddl`: `CREATE TABLE` column definitions and `ALTER TABLE ... ADD COLUMN` in
 *     `*.sql` (schema.sql, structure.sql, generated migrations). Used only for columns no
 *     other source declares, so a Prisma or ORM model and its generated SQL are one column.
 *
 * With `include: "configured"` the catalog also lists configured address keys
 * (KDATAP-6661dd): places a site keeps an address it configures for itself, named by a
 * literal key. Their `table` is `settings`, `config` or `env` and `evidence` is `setting`,
 * `config` or `env`:
 *   - literal-key reads: `settingsCache.get('members_support_address')`,
 *     `config.get('mail:from')`, `getSetting('x')`, `os.getenv('X')`;
 *   - member reads of a settings, config or env object: `process.env.EMAIL_FROM`,
 *     `env['EMAIL_FROM']`, `os.environ['X']`, Django `settings.DEFAULT_FROM_EMAIL`;
 *   - assignments in a settings module (`DEFAULT_FROM_EMAIL = ...` in settings.py), keys of
 *     config and default-settings files, including `default-settings.json`.
 */

export type ColumnEvidence =
  | "orm-field"
  | "schema-object"
  | "migration"
  | "content-type"
  | "record-type"
  | "prisma-model"
  | "sql-ddl"
  | "setting"
  | "config"
  | "env";

/** Evidence kinds of configured address keys, which the catalog lists only on request. */
const CONFIGURED_EVIDENCE: ReadonlySet<ColumnEvidence> = new Set(["setting", "config", "env"]);

export interface ColumnLocation {
  file: string;
  line: number;
}

/** One declared column. `file` and `line` are the first location; `locations` lists all. */
export interface ColumnEntry {
  /** The table or collection name when known, else the model class. */
  table?: string;
  /** The class or content-type name when known. */
  model?: string;
  column: string;
  file: string;
  line: number;
  evidence: ColumnEvidence;
  /** The declared column type as written (`EmailField`, `string`, `varchar`), when known. */
  type?: string;
  locations: ColumnLocation[];
}

/** A declaration found in one file, before the concept filter and the collapse. */
export type ColumnCandidate = Omit<ColumnEntry, "locations">;

/** Column types that cannot hold an address; such columns are not catalogued. */
const NON_TEXT_TYPE =
  /^(?:int|integer|bigint|biginteger|smallint|tinyint|mediumint|serial|float|double|real|decimal|numeric|number|boolean|bool|bit|date|datetime|datetime2|timestamp|timestamptz|time|increments|bigincrements|uuid|binary|blob|enum|bignumber|hasone|hasmany|belongsto|manytomany|id|boolean(?:field)?|(?:positive|small|big)?(?:integer|auto)field|decimalfield|floatfield|datefield|datetimefield|timefield|durationfield|uuidfield|foreignkey|onetoonefield|manytomanyfield|relation|media|component|dynamiczone|password|uid)$/i;

/** Knex column builder methods; the first argument is the column name. */
const KNEX_COLUMN_METHODS = new Set([
  "string", "text", "integer", "bigInteger", "boolean", "date", "dateTime", "datetime", "timestamp",
  "time", "json", "jsonb", "uuid", "binary", "float", "double", "decimal", "enu", "enum", "specificType",
  "tinyint", "smallint", "mediumint", "bigint", "increments", "bigIncrements", "char", "varchar",
]);

/** Knex calls that open a table; the first argument is the table name. */
const KNEX_TABLE_CALLS = new Set(["createTable", "createTableIfNotExists", "table", "alterTable", "createTableLike"]);

/** Helper calls taking a table and a column name as their first two string arguments. */
const COLUMN_HELPER = /(?:column|totype)/i;
const DESTRUCTIVE_HELPER = /^(?:drop|remove|delete|rename)/i;
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** ORM field class names that point at another model rather than store a value. */
const DJANGO_RELATION = /^(?:ForeignKey|OneToOneField|ManyToManyField|GenericForeignKey)$/;

function isNonText(type: string | undefined): boolean {
  if (type === undefined) return false;
  // A nullable union (`number | null`) is its non-null member.
  const members = type.split("|").map((t) => t.trim()).filter((t) => t && !/^(?:null|undefined)$/.test(t));
  const single = members.length === 1 ? members[0] : type;
  return NON_TEXT_TYPE.test(single.replace(/^.*\./, "").trim());
}

/** Column candidates declared in one analyzed file, for any concept. */
export function columnCandidates(file: AnalyzedFile, filePath: string): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  for (const field of file.fieldDeclarations()) out.push(...ormFieldCandidates(field, filePath));
  for (const key of file.keyDeclarations()) out.push(...keyCandidates(key, filePath));
  out.push(...migrationCandidates(file, filePath));
  out.push(...recordTypeCandidates(file, filePath));
  out.push(...configuredCandidates(file, filePath));
  return out;
}

// ---- configured address keys (KDATAP-6661dd) ------------------------------------------

type ConfiguredTable = "settings" | "config" | "env";
const TABLE_EVIDENCE: Record<ConfiguredTable, ColumnEvidence> = { settings: "setting", config: "config", env: "env" };

/** Words of an identifier, split at case changes and non-alphanumerics: `mail:from` -> mail, from. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** Which kind of configuration a receiver or callee name stands for, or undefined. */
function configuredTable(name: string | undefined): ConfiguredTable | undefined {
  if (!name) return undefined;
  const words = wordsOf(name);
  if (words.some((word) => /^(?:env|environ|environment|getenv)$/.test(word))) return "env";
  if (words.some((word) => /^settings?$/.test(word))) return "settings";
  if (words.some((word) => /^(?:config|conf|configuration)$/.test(word))) return "config";
  return undefined;
}

/** Functions that read a setting by a literal key: `getSetting('k')`, `os.getenv('X')`. */
const SETTING_READER = /^(?:get_?(?:setting|config|conf|env|environment)s?|getenv)$/i;

/**
 * Whether a source token (a column name, a settings key) is an occurrence of the concept.
 * It uses the scanner's own signal rules for the concept id (`phone_number`: phone,
 * telephone, tel, mobile, cell, msisdn): the signal's token rule, and the rule's patterns
 * against the token's words, so `billing_phone` and `shippingPhone` match as well as `phone`.
 */
export function conceptNameMatcher(concept: string, filePath: string): (token: string) => boolean {
  const signal = signalTokenMatcher(concept, filePath);
  const patterns = loadPiiSignalRules().find((rule) => rule.id === concept)?.patterns ?? [];
  return (token) => {
    if (signal(token)) return true;
    const spaced = wordsOf(token).join(" ");
    return patterns.some((pattern) => pattern.test(spaced));
  };
}

/**
 * Whether a configured key is a value of the concept (KDATAP-6661dd, KDATAP-0df343). The
 * concept's profile (patterns/concept-profiles.yaml) supplies the rest. A key counts when
 * it names the concept as its last word (`ADMIN_EMAIL`, `SUPPORT_PHONE`), or names it
 * earlier and ends in a tail word (`EMAIL_FROM`, `PHONE_NUMBER`); or, when the profile
 * says role words suffice (email), it carries a role word (from, sender, reply_to,
 * support, noreply) on its own; otherwise a role word must come with the concept
 * (`SMS_PHONE`). A key ending in a negative word (`email_track_enabled`, `sender_name`)
 * is not one. Words are split at case changes and at `:`, `.`, `_`, `-`.
 */
function namesConceptValue(name: string, concept: string, filePath: string): boolean {
  const words = wordsOf(name);
  if (words.length === 0) return false;
  const isConcept = conceptNameMatcher(concept, filePath);
  const last = words[words.length - 1];
  return isConcept(last) || (words.slice(0, -1).some((word) => isConcept(word)) && conceptProfile(concept).tailWords.has(last));
}

export function isConfiguredAddressKey(key: string, concept: string, filePath: string): boolean {
  const words = wordsOf(key);
  if (words.length === 0) return false;
  const last = words[words.length - 1];
  const profile = conceptProfile(concept);
  const isConcept = conceptNameMatcher(concept, filePath);
  if (isConcept(last)) return true;
  const namesConcept = words.slice(0, -1).some((word) => isConcept(word));
  if (namesConcept && profile.tailWords.has(last)) return true;
  if (profile.negativeWords.has(last)) return false;
  const hasRole = words.some((word) => profile.roleWords.has(word)) || profile.roleRuns.some((run) => words.join("").includes(run));
  return hasRole && (profile.roleWordsSuffice || namesConcept);
}

/** A settings module (`settings.py`, `settings/base.py`) whose module variables are settings. */
function isPythonSettingsModule(filePath: string): boolean {
  return /(?:^|\/)settings(?:\/[^/]+)?\.py$/.test(filePath) || /(?:^|\/)settings\.py$/.test(filePath);
}

/** A config or default-settings source file, whose object keys are configured values. */
/** Build, test and lint tool configs (`jest.config.js`): they configure tooling, not the app's addresses. */
const TOOL_CONFIG = /(?:^|\/)(?:jest|vitest|vite|webpack|rollup|babel|eslint|prettier|tailwind|postcss|tsup|karma|playwright|cypress|commitlint|lint-staged|stylelint)\.config\./i;

function isConfigFile(filePath: string): boolean {
  if (TOOL_CONFIG.test(filePath)) return false;
  return /(?:^|\/)(?:config|settings|default[-_.]?settings|defaults?)(?:\.[\w-]+)*\.(?:js|ts|mjs|cjs)$/i.test(filePath) || /\.config\.(?:js|ts|mjs|cjs)$/i.test(filePath);
}

/** Literal-key reads, env and settings member reads, settings-module variables, config keys. */
function configuredCandidates(file: AnalyzedFile, filePath: string): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  const add = (table: ConfiguredTable, column: string, line: number): void => {
    out.push({ table, column, file: filePath, line, evidence: TABLE_EVIDENCE[table] });
  };
  for (const access of file.memberAccesses()) {
    const table = configuredTable(access.receiverName);
    if (table && !access.called) add(table, access.name, access.line);
  }
  for (const call of file.invocations()) {
    const key = stringArgument(call.arguments[0]);
    if (key !== undefined && SETTING_READER.test(call.callee)) add(configuredTable(call.callee) ?? "settings", key, call.line);
  }
  if (isPythonSettingsModule(filePath)) {
    for (const variable of file.moduleVariables()) add("settings", variable.name, variable.line);
  }
  if (isConfigFile(filePath)) {
    for (const key of file.keyDeclarations()) if (key.value.kind !== "object") add("config", key.name, key.line);
  }
  return out;
}

/**
 * Default-settings JSON (ghost `default-settings.json`): groups of settings, each a key
 * with a `defaultValue` or a `type`. Returns nothing for other JSON.
 */
export function defaultSettingsCandidates(file: FileInfo): ColumnCandidate[] {
  if (!/default[-_.]?settings[^/]*\.json$/i.test(file.path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return [];
  }
  const lines = file.content.split(/\r?\n/);
  const out: ColumnCandidate[] = [];
  for (const group of Object.values(parsed as Record<string, unknown>)) {
    if (typeof group !== "object" || group === null) continue;
    for (const [key, setting] of Object.entries(group as Record<string, unknown>)) {
      if (typeof setting !== "object" || setting === null || !("defaultValue" in setting || "type" in setting)) continue;
      const line = lines.findIndex((text) => text.includes(`"${key}"`)) + 1;
      out.push({ table: "settings", column: key, file: file.path, line: Math.max(line, 1), evidence: "setting" });
    }
  }
  return out;
}

/** Django `models.*Field` attributes and TypeORM `@Column` properties. */
function ormFieldCandidates(field: FieldDeclaration, filePath: string): ColumnCandidate[] {
  const where = { file: filePath, line: field.line, evidence: "orm-field" as const };
  const init = field.initializer;
  if (init && /Field$/.test(init.callee) && !DJANGO_RELATION.test(init.callee)) {
    // A model's field is `models.X`, or a bare imported field class (`PhoneNumberField`) on a
    // class with a base; `forms.X` and `serializers.X` are not columns.
    const qualified = init.calleeText.includes(".");
    const isModel = init.calleeText.startsWith("models.") || field.ownerBases.some((base) => /Model$/.test(base)) || (!qualified && field.ownerBases.some((base) => !/(?:Form|Serializer|Filter|Schema|Input|ObjectType|Mutation)$/.test(base)));
    if (!isModel || isNonText(init.callee)) return [];
    return [{ ...(field.owner ? { table: field.owner, model: field.owner } : {}), column: field.name, type: init.callee, ...where }];
  }
  const column = field.decorators.find((decorator) => /^(?:Column|PrimaryColumn)$/.test(decorator.name));
  if (!column) return [];
  const type = column.options["type"] ?? column.strings[0] ?? field.typeAnnotation;
  if (isNonText(type)) return [];
  const entity = field.ownerDecorators.find((decorator) => decorator.name === "Entity");
  const table = entity?.strings[0] ?? entity?.options["name"] ?? field.owner;
  return [
    {
      ...(table ? { table } : {}),
      ...(field.owner ? { model: field.owner } : {}),
      column: column.options["name"] ?? field.name,
      ...(type ? { type } : {}),
      ...where,
    },
  ];
}

/** Ghost-style schema objects, Sequelize and Mongoose attribute objects, strapi content types. */
function keyCandidates(key: KeyDeclaration, filePath: string): ColumnCandidate[] {
  const base = { column: key.name, file: filePath, line: key.line };
  const typeText = key.value.strings["type"];
  const container = key.container;
  if (key.path[0] === "attributes" && key.ownerSiblings["collectionName"] !== undefined && key.value.kind === "object") {
    if (typeText === undefined || isNonText(typeText)) return [];
    const model = key.ownerSiblings["info.name"] ?? key.ownerSiblings["info.displayName"] ?? key.ownerSiblings["info.singularName"];
    return [{ table: key.ownerSiblings["collectionName"], ...(model ? { model } : {}), type: typeText, evidence: "content-type", ...base }];
  }
  // Medusa DML: `model.define('customer', { phone: model.text().nullable() })`; the chain's
  // first call names the type, the define name is the table.
  if (container && key.path.length === 0 && container.callee === "define" && key.value.callRoot?.receiver === "model") {
    const type = key.value.callRoot.method;
    if (isNonText(type)) return [];
    const table = container.strings[0] ?? container.options["tableName"] ?? container.options["name"];
    const model = container.assignedTo ?? table;
    return [{ ...(table ? { table } : {}), ...(model ? { model } : {}), type, evidence: "orm-field", ...base }];
  }
  if (container && key.path.length === 0) {
    const sequelizeDefine = container.callee === "define" && container.position === 1 && container.strings.length > 0;
    const sequelizeInit = container.callee === "init" && container.position === 0 && !container.constructed;
    const mongoose = container.callee === "Schema" && container.constructed && container.position === 0;
    if (!sequelizeDefine && !sequelizeInit && !mongoose) return [];
    // A Mongoose key is `email: String` or `email: { type: String }`; Sequelize needs `type`.
    const type = key.value.kind === "object" ? typeText : mongoose && key.value.kind === "name" ? key.value.text : undefined;
    if (type === undefined || isNonText(type)) return [];
    const model = sequelizeDefine
      ? container.strings[0]
      : sequelizeInit
        ? (container.options["modelName"] ?? container.receiver)
        : container.assignedTo;
    const table = sequelizeDefine
      ? (container.options["tableName"] ?? container.strings[0])
      : sequelizeInit
        ? (container.options["tableName"] ?? container.options["modelName"] ?? container.receiver)
        : container.assignedTo;
    return [{ ...(table ? { table } : {}), ...(model ? { model } : {}), type, evidence: "orm-field", ...base }];
  }
  // Ghost-style: a table key at the top of the object, whose column keys carry a string `type`.
  if (key.path.length === 1 && !container && key.value.kind === "object" && typeText !== undefined) {
    if (isNonText(typeText) || key.value.keys.includes("references")) return [];
    return [{ table: key.path[0], type: typeText, evidence: "schema-object", ...base }];
  }
  return [];
}

/** A record's row timestamps: `created_at`, `updatedAt`, `inserted_at`. */
const ROW_TIMESTAMP = /^(?:created|updated|inserted)(?:_at|At)$/;

/** Members of TypeScript record types: named object types with an `id` and a row timestamp. */
function recordTypeCandidates(file: AnalyzedFile, filePath: string): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  for (const record of file.recordTypes()) {
    const names = new Set(record.members.map((member) => member.name));
    if (!names.has("id") || ![...names].some((name) => ROW_TIMESTAMP.test(name))) continue;
    for (const member of record.members) {
      // Timestamps typed as strings (`email_confirmed_at`) hold no address.
      if (member.name === "id" || /(?:_at|At)$/.test(member.name) || isNonText(member.type)) continue;
      out.push({ table: record.name, model: record.name, column: member.name, ...(member.type ? { type: member.type } : {}), file: filePath, line: member.line, evidence: "record-type" });
    }
  }
  return out;
}

// ---- storage schema files (KDATAP-fded10) -------------------------------------------

/** Prisma scalar types that cannot hold an address; only `String` fields are columns here. */
const PRISMA_TEXT = /^String\??$/;

/** `model X { ... }` blocks of a Prisma schema: `String` fields, with `@map` and `@@map` names. */
export function prismaCandidates(file: SchemaFile): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  const lines = file.content.split(/\r?\n/);
  let model: string | undefined;
  let fields: Array<{ name: string; column: string; line: number }> = [];
  let table: string | undefined;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const open = /^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(line);
    if (open) {
      model = open[1];
      fields = [];
      table = undefined;
      return;
    }
    if (!model) return;
    if (line.startsWith("}")) {
      for (const field of fields) {
        out.push({ table: table ?? model, model, column: field.column, type: "String", file: file.path, line: field.line, evidence: "prisma-model" });
      }
      model = undefined;
      return;
    }
    const mapped = /^@@map\(\s*["']([^"']+)["']/.exec(line);
    if (mapped) {
      table = mapped[1];
      return;
    }
    const field = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*\??(?:\[\])?)(.*)$/.exec(line);
    if (!field || !PRISMA_TEXT.test(field[2]) || field[3].includes("@relation")) return;
    const column = /@map\(\s*["']([^"']+)["']/.exec(field[3])?.[1] ?? field[1];
    fields.push({ name: field[1], column, line: index + 1 });
  });
  return out;
}

/** Words that open a table constraint, not a column, inside `CREATE TABLE (...)`. */
const SQL_CONSTRAINT = /^(?:constraint|primary|unique|foreign|key|index|check|exclude|fulltext|spatial|period|like)\b/i;

function sqlName(text: string): string {
  // `"public"."users"`, `` `users` ``, `[dbo].[users]` -> users
  const parts = text.split(".");
  return parts[parts.length - 1].replace(/^["`\[]|["`\]]$/g, "");
}

/** `CREATE TABLE` column definitions and `ALTER TABLE ... ADD [COLUMN]` in SQL DDL. */
export function sqlCandidates(file: SchemaFile): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  const NAME = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
  const QUALIFIED = `${NAME}(?:\\s*\\.\\s*${NAME})*`;
  const createTable = new RegExp(`^\\s*create\\s+(?:(?:global\\s+|local\\s+)?(?:temporary|temp|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})\\s*\\(?`, "i");
  const columnDef = new RegExp(`^\\s*(${NAME})\\s+([A-Za-z_][A-Za-z0-9_ ]*?)(?:\\s*\\(|\\s|,|$)`, "i");
  const addColumn = new RegExp(`^\\s*alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QUALIFIED})\\s+add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?(${NAME})\\s+([A-Za-z_][A-Za-z0-9_ ]*)`, "i");
  const lines = file.content.split(/\r?\n/);
  let table: string | undefined;
  let depth = 0;
  lines.forEach((raw, index) => {
    const line = raw.replace(/--.*$/, "");
    if (table === undefined) {
      const created = createTable.exec(line);
      if (created) {
        table = sqlName(created[1]);
        depth = (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
        return;
      }
      const added = addColumn.exec(line);
      if (added) {
        const type = added[3].trim().split(/\s+/)[0];
        if (!isNonText(type)) out.push({ table: sqlName(added[1]), column: sqlName(added[2]), type, file: file.path, line: index + 1, evidence: "sql-ddl" });
      }
      return;
    }
    // Inside `CREATE TABLE name (`: one column per definition at depth 1.
    const atTop = depth === 1;
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    if (atTop) {
      const def = columnDef.exec(line);
      if (def && !SQL_CONSTRAINT.test(def[1])) {
        const type = def[2].trim().split(/\s+/)[0];
        if (!isNonText(type)) out.push({ table, column: sqlName(def[1]), type, file: file.path, line: index + 1, evidence: "sql-ddl" });
      }
    }
    if (depth <= 0 && /\)/.test(line)) table = undefined;
  });
  return out;
}

/** Rails and Laravel column types that hold text. */
const MIGRATION_TEXT = /^(?:string|text|citext|char|varchar|mediumtext|longtext|tinytext)$/i;

/**
 * Rails `create_table :users do |t| t.string :email` and `add_column :users, :email, :string`;
 * Laravel `Schema::create('users', function (Blueprint $table) { $table->string('email') })`
 * and `Schema::table`. One table block at a time, by indentation-free brace or `do`/`end`
 * tracking of the opening call only: a column call names the table opened before it.
 */
export function migrationFileCandidates(file: SchemaFile): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  const name = String.raw`["':]?([A-Za-z_][A-Za-z0-9_]*)["']?`;
  const openTable =
    file.kind === "rails"
      ? new RegExp(String.raw`^\s*create_table\s*\(?\s*${name}`)
      : new RegExp(String.raw`Schema::(?:create|table)\s*\(\s*${name}`);
  const column =
    file.kind === "rails"
      ? new RegExp(String.raw`^\s*t\.([a-z_]+)\s*\(?\s*${name}`)
      : new RegExp(String.raw`\$table->([A-Za-z_]+)\s*\(\s*${name}`);
  const addColumn = file.kind === "rails" ? new RegExp(String.raw`^\s*add_column\s*\(?\s*${name}\s*,\s*${name}\s*,\s*${name}`) : undefined;
  let table: string | undefined;
  file.content.split(/\r?\n/).forEach((line, index) => {
    const opened = openTable.exec(line);
    if (opened) {
      table = opened[1];
      return;
    }
    const added = addColumn?.exec(line);
    if (added && MIGRATION_TEXT.test(added[3])) {
      out.push({ table: added[1], column: added[2], type: added[3], file: file.path, line: index + 1, evidence: "migration" });
      return;
    }
    const def = table !== undefined ? column.exec(line) : null;
    if (def && MIGRATION_TEXT.test(def[1])) {
      out.push({ table, column: def[2], type: def[1], file: file.path, line: index + 1, evidence: "migration" });
    }
  });
  return out;
}

/** Migration scratch tables (`__new_users` in Drizzle sqlite rebuilds, `_prisma_migrations`). */
const SCRATCH_TABLE = /^_/;

/** Candidates of one storage schema file. */
export function schemaFileCandidates(file: SchemaFile): ColumnCandidate[] {
  const candidates =
    file.kind === "prisma" ? prismaCandidates(file) : file.kind === "sql" ? sqlCandidates(file) : migrationFileCandidates(file);
  return candidates.filter((candidate) => !SCRATCH_TABLE.test(candidate.table ?? ""));
}

/** Knex column calls inside a table call, and helpers taking a table and a column name. */
function migrationCandidates(file: AnalyzedFile, filePath: string): ColumnCandidate[] {
  const out: ColumnCandidate[] = [];
  for (const call of file.invocations()) {
    const first = stringArgument(call.arguments[0]);
    if (first === undefined) continue;
    const where = { file: filePath, line: call.line, evidence: "migration" as const };
    if (KNEX_COLUMN_METHODS.has(call.callee)) {
      const table = call.ancestors?.find((ancestor) => KNEX_TABLE_CALLS.has(ancestor.callee) && ancestor.firstString !== undefined);
      if (!table || isNonText(call.callee === "specificType" ? stringArgument(call.arguments[1]) : call.callee)) continue;
      out.push({ table: table.firstString, column: first, type: call.callee, ...where });
    } else if (COLUMN_HELPER.test(call.callee) && !DESTRUCTIVE_HELPER.test(call.callee)) {
      const column = stringArgument(call.arguments[1]);
      // Table and column names are identifiers; a label and a dotted path
      // (`CsvColumn("Employee email", "employee.email")`) name a report column, not storage.
      if (column === undefined || !SQL_IDENTIFIER.test(first) || !SQL_IDENTIFIER.test(column)) continue;
      // `addColumn('t', 'c', 'string')`, `createAddColumnMigration('t', 'c', { type: 'integer' })`.
      const type = stringArgument(call.arguments[2]) ?? call.options?.["type"];
      if (call.options && "references" in call.options) continue;
      if (isNonText(type)) continue;
      out.push({ table: first, column, ...(type ? { type } : {}), ...where });
    }
  }
  return out;
}

function stringArgument(argument: { text: string } | undefined): string | undefined {
  const match = argument ? /^(["'`])([^"'`\\]*)\1$/.exec(argument.text.trim()) : null;
  return match ? match[2] : undefined;
}

/**
 * Strapi content-type `schema.json`: `collectionName`, `info`, and `attributes` whose keys
 * carry a `type`. Returns nothing for JSON that is not a content type.
 */
export function contentTypeCandidates(file: FileInfo): ColumnCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return [];
  }
  const schema = parsed as { collectionName?: unknown; info?: { displayName?: unknown; name?: unknown; singularName?: unknown }; attributes?: unknown };
  if (typeof schema?.collectionName !== "string" || typeof schema.attributes !== "object" || schema.attributes === null) return [];
  const model = [schema.info?.displayName, schema.info?.name, schema.info?.singularName].find((name): name is string => typeof name === "string");
  const lines = file.content.split(/\r?\n/);
  const out: ColumnCandidate[] = [];
  for (const [column, attribute] of Object.entries(schema.attributes as Record<string, unknown>)) {
    const type = (attribute as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || isNonText(type)) continue;
    const line = lines.findIndex((text) => text.includes(`"${column}"`)) + 1;
    out.push({ table: schema.collectionName, ...(model ? { model } : {}), column, type, file: file.path, line: Math.max(line, 1), evidence: "content-type" });
  }
  return out;
}

/** Candidates of one file, whatever its language: parsed source, or a `schema.json`. */
export function candidatesForFile(file: FileInfo, analyzed: AnalyzedFile | undefined): ColumnCandidate[] {
  if (file.language === "json") {
    return path.basename(file.path) === "schema.json" ? contentTypeCandidates(file) : defaultSettingsCandidates(file);
  }
  return analyzed ? columnCandidates(analyzed, file.path) : [];
}

/**
 * Whether a column is an occurrence of the concept: its name matches the concept's signal
 * rules (`email`, `sender_email`, `customerEmail`; `phone`, `billing_phone`), or its declared
 * type settles the concept in the concept's profile (`EmailField`, strapi `type: 'email'`,
 * `PossiblePhoneNumberField`).
 */
export function matchesConcept(candidate: ColumnCandidate, concept: string): boolean {
  if (CONFIGURED_EVIDENCE.has(candidate.evidence)) return isConfiguredAddressKey(candidate.column, concept, candidate.file);
  // A schema file's column names the value itself: the concept is its last word, or comes
  // before an address word (`contact_email`, `phone_number`; not `mobile_footer`,
  // `phone_number_health_error`).
  if (schemaFileKind(candidate.file)) return namesConceptValue(candidate.column, concept, candidate.file);
  if (conceptNameMatcher(concept, candidate.file)(candidate.column)) return true;
  return candidate.type !== undefined && conceptProfile(concept).typeHints.has(normalizeTypeName(candidate.type));
}

/** `include: "configured"` adds the configured address keys to the declared columns. */
export interface CatalogOptions {
  include?: "configured";
}

/**
 * Filter candidates by concept and collapse duplicates: the same table and column from the
 * same kind of evidence is one entry that lists every location (a column touched by many
 * migrations). Sorted by table, column, then file.
 */
export function collapseColumns(candidates: readonly ColumnCandidate[], concept: string, options: CatalogOptions = {}): ColumnEntry[] {
  const byKey = new Map<string, ColumnEntry>();
  for (const candidate of candidates) {
    if (CONFIGURED_EVIDENCE.has(candidate.evidence) && options.include !== "configured") continue;
    if (!matchesConcept(candidate, concept)) continue;
    const key = [candidate.evidence, candidate.table ?? "", candidate.model ?? "", candidate.column].join("\u0000");
    const location = { file: candidate.file, line: candidate.line };
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, { ...candidate, locations: [location] });
    } else if (!known.locations.some((l) => l.file === location.file && l.line === location.line)) {
      known.locations.push(location);
    }
  }
  const entries = [...byKey.values()];
  const declaresStorage = entries.some((entry) => entry.evidence !== "record-type" && !CONFIGURED_EVIDENCE.has(entry.evidence));
  // SQL DDL fills in columns no model declares; a model and its generated SQL are one column.
  const fold = (entry: ColumnEntry): string => `${(entry.table ?? "").toLowerCase()}.${entry.column.toLowerCase()}`;
  const modelled = new Set(
    entries.filter((entry) => entry.evidence !== "sql-ddl" && entry.evidence !== "record-type" && !CONFIGURED_EVIDENCE.has(entry.evidence)).map(fold),
  );
  return entries
    .filter((entry) => !declaresStorage || entry.evidence !== "record-type")
    .filter((entry) => entry.evidence !== "sql-ddl" || !modelled.has(fold(entry)))
    .map((entry) => {
      const locations = [...entry.locations].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
      return { ...entry, file: locations[0].file, line: locations[0].line, locations };
    })
    .sort((a, b) => (a.table ?? "").localeCompare(b.table ?? "") || a.column.localeCompare(b.column) || a.file.localeCompare(b.file));
}

/**
 * The stored columns the files declare for a concept (`email`). Parses each file with a
 * language pack and reads `schema.json` content types; the analysis engine must be
 * initialized (`initAnalysisEngine`).
 */
export function declaredColumns(
  files: readonly FileInfo[],
  concept: string,
  options: CatalogOptions = {},
  schemaFiles: readonly SchemaFile[] = [],
): ColumnEntry[] {
  return collapseColumns(collectColumnCandidates(files, schemaFiles), concept, options);
}

/**
 * The column candidates of every file, for any concept: parse once, then `collapseColumns`
 * per concept (KDATAP-7a094c). The analysis engine must be initialized.
 */
export function collectColumnCandidates(files: readonly FileInfo[], schemaFiles: readonly SchemaFile[] = []): ColumnCandidate[] {
  return collectColumnFacts(files, schemaFiles).candidates;
}

/**
 * Candidates and record-key facts (KDATAP-fb8019) in one parse of every file. The facts
 * say where object literals and function parameters flow, for `recordKeyColumns`.
 */
export function collectColumnFacts(
  files: readonly FileInfo[],
  schemaFiles: readonly SchemaFile[] = [],
): { candidates: ColumnCandidate[]; facts: RecordFacts } {
  const candidates: ColumnCandidate[] = schemaFiles.flatMap(schemaFileCandidates);
  const facts: RecordFacts = { keyFlows: [], sinks: [] };
  for (const file of files) {
    const pack = packForFile(file.language, file.path);
    const analyzed = pack ? analyzeSource(pack, file.content) : undefined;
    try {
      candidates.push(...candidatesForFile(file, analyzed));
      if (analyzed) {
        const found = recordFacts(analyzed, file.path);
        facts.keyFlows.push(...found.keyFlows);
        facts.sinks.push(...found.sinks);
      }
    } finally {
      analyzed?.dispose();
    }
  }
  return { candidates, facts };
}
