import type { ColumnEntry } from "./column-catalog";
import { classEntity, entityName, modelFileEntity } from "../pii-signals/mention-group";

/**
 * Which catalogued stored column a mention names (KDATAP-7a094c). Two mentions that name
 * different columns are never one data item, whatever their names have in common: the
 * phone declarations of `cart_address` and `order_address` are both "address" phones.
 *
 * A mention names a column when (in this order):
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

export function columnIndex(entries: readonly ColumnEntry[]): ColumnIndex {
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
  return { byLocation, byName };
}

/** What a mention knows that can narrow a column name shared by several tables. */
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

/** The column a mention names, or undefined (most mentions name none). */
export function mentionColumn(index: ColumnIndex, mention: ColumnEvidence): string | undefined {
  const entities = new Set<string>();
  const qualifier = mention.group?.slice(mention.group.indexOf(":") + 1);
  for (const name of [mention.receiverEntity, mention.tableEntity, qualifier, modelFileEntity(mention.filePath)]) {
    if (!name) continue;
    entities.add(name);
    const normalized = entityName(name);
    if (normalized) entities.add(normalized);
  }
  // A catalog declaration location is the column itself, whatever else the line says.
  if (mention.line !== undefined) {
    const declared = index.byLocation.get(`${mention.filePath}:${mention.line}`);
    if (declared) return declared;
  }
  // A key defined on the line decides over a column the line only reads.
  for (const key of mention.columnHints?.keys ?? []) {
    const found = resolve(index.byName.get(key), entities);
    if (found) return found;
  }
  for (const write of mention.columnHints?.writes ?? []) {
    const writeEntities = new Set(entities);
    for (const name of [write.receiverClass ? classEntity(write.receiverClass) : undefined, write.receiverName ? entityName(write.receiverName) : undefined]) {
      if (name) writeEntities.add(name);
    }
    const found = resolve(index.byName.get(write.name), writeEntities);
    if (found) return found;
  }
  return undefined;
}
