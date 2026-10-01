import type { ColumnEntry } from "./column-catalog";
import { classEntity, entityName } from "../pii-signals/occurrence-group";

/**
 * Which catalogued stored column a occurrence names (KDATAP-7a094c). Two occurrences that name
 * different columns are never one data item, whatever their names have in common: the
 * phone declarations of `cart_address` and `order_address` are both "address" phones.
 *
 * A occurrence names a column when (in this order):
 *   - its line is a catalog declaration location;
 *   - the line defines a key or keyword that is a catalog column's name, on a table the
 *     line names (or the only table with that column);
 *   - the line writes a member that resolves to a catalog column (`order.user_email = ...`).
 * A line that defines a key naming column C while reading another column carries C: the
 * defined key decides (`from_email: member._previousAttributes.email`).
 */

interface ColumnRef {
  /** Identity of the column: `table.column`. */
  key: string;
  column: string;
  /** Normalized names of the table and model, to match against entities a line names. */
  entities: Set<string>;
}

export interface ColumnIndex {
  byLocation: Map<string, string>;
  byName: Map<string, ColumnRef[]>;
  /** Record columns of keys written into JSON fields, by `file:line` then key (KDATAP-fb8019). */
  recordKeys: Map<string, Record<string, string>>;
}

/** The column identity of a catalog entry: its table, else its model. */
export function columnKey(entry: Pick<ColumnEntry, "table" | "model" | "column">): string {
  return `${entry.table ?? entry.model ?? "?"}.${entry.column}`;
}

function entitiesOf(entry: ColumnEntry): Set<string> {
  const out = new Set<string>();
  for (const name of [entry.table, entry.model]) {
    if (!name) continue;
    for (const entity of [entityName(name), classEntity(name)]) if (entity) out.add(entity);
  }
  return out;
}

export function columnIndex(entries: readonly ColumnEntry[], recordKeys: Map<string, Record<string, string>> = new Map()): ColumnIndex {
  const byLocation = new Map<string, string>();
  const byName = new Map<string, ColumnRef[]>();
  const refs = new Map<string, ColumnRef>();
  for (const entry of entries) {
    const key = columnKey(entry);
    const ref = refs.get(key) ?? { key, column: entry.column, entities: new Set<string>() };
    for (const entity of entitiesOf(entry)) ref.entities.add(entity);
    if (!refs.has(key)) {
      refs.set(key, ref);
      const list = byName.get(entry.column) ?? [];
      list.push(ref);
      byName.set(entry.column, list);
    }
    for (const location of entry.locations) {
      if (!byLocation.has(`${location.file}:${location.line}`)) byLocation.set(`${location.file}:${location.line}`, key);
    }
  }
  return { byLocation, byName, recordKeys };
}

/** What a occurrence knows that can narrow a column name shared by several tables. */
export interface ColumnEvidence {
  filePath: string;
  line?: number;
  group?: string;
  receiverEntity?: string;
  tableEntity?: string;
  columnHints?: { keys: string[]; writes: Array<{ name: string; receiverClass?: string; receiverName?: string }> };
}

/** The one column of that name the entities single out, or undefined. */
function resolve(candidates: readonly ColumnRef[] | undefined, entities: ReadonlySet<string>): string | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].key;
  const narrowed = candidates.filter((candidate) => [...candidate.entities].some((entity) => entities.has(entity)));
  return narrowed.length === 1 ? narrowed[0].key : undefined;
}

/** The column a occurrence names, or undefined (most occurrences name none). */
export function occurrenceColumn(index: ColumnIndex, occurrence: ColumnEvidence): string | undefined {
  // Only what the line itself says about its model narrows a column name shared by several
  // tables: the class of its receiver and the table its function queries. A group
  // qualifier or a file name is too weak (`address` is the qualifier of five tables' phones).
  const entities = new Set<string>();
  for (const name of [occurrence.receiverEntity, occurrence.tableEntity]) {
    if (!name) continue;
    entities.add(name);
    const normalized = entityName(name);
    if (normalized) entities.add(normalized);
  }
  // A key written into a JSON record column is that record column (`Model.field.key`).
  const record = occurrence.line !== undefined ? index.recordKeys.get(`${occurrence.filePath}:${occurrence.line}`) : undefined;
  if (record) {
    for (const key of occurrence.columnHints?.keys ?? []) if (record[key]) return record[key];
  }
  // A catalog declaration location is the column itself, whatever else the line says.
  if (occurrence.line !== undefined) {
    const declared = index.byLocation.get(`${occurrence.filePath}:${occurrence.line}`);
    if (declared) return declared;
  }
  // A key defined on the line decides over a column the line only reads.
  for (const key of occurrence.columnHints?.keys ?? []) {
    const found = resolve(index.byName.get(key), entities);
    if (found) return found;
  }
  for (const write of occurrence.columnHints?.writes ?? []) {
    const writeEntities = new Set(entities);
    for (const name of [write.receiverClass ? classEntity(write.receiverClass) : undefined, write.receiverName ? entityName(write.receiverName) : undefined]) {
      if (name) writeEntities.add(name);
    }
    const found = resolve(index.byName.get(write.name), writeEntities);
    if (found) return found;
  }
  return undefined;
}

/** Whether the occurrence's column is the catalog declaration its own line is, the strongest evidence. */
export function isDeclaredColumn(index: ColumnIndex, occurrence: Pick<ColumnEvidence, "filePath" | "line">, column: string): boolean {
  return occurrence.line !== undefined && index.byLocation.get(`${occurrence.filePath}:${occurrence.line}`) === column;
}

/** Whether the column is a key written into a JSON record column rather than a catalog column. */
export function isRecordColumn(index: ColumnIndex, occurrence: Pick<ColumnEvidence, "filePath" | "line">, column: string): boolean {
  const record = occurrence.line !== undefined ? index.recordKeys.get(`${occurrence.filePath}:${occurrence.line}`) : undefined;
  return record !== undefined && Object.values(record).includes(column);
}
