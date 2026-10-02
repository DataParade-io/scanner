import fs from "fs";
import os from "os";
import path from "path";

/**
 * Minimal swappable SQLite reader interface for the Cursor adapter.
 * The default implementation uses the built-in node:sqlite (engines >=22.5);
 * a native optional dependency can slot in behind this interface later.
 */
export interface KVRow {
  key: string;
  value: string;
}

export interface SqliteKVDatabase {
  /** Iterate key/value rows whose key starts with the given prefix, in key order. */
  iterateByPrefix(prefix: string): Iterable<KVRow>;
  get(key: string): KVRow | undefined;
  close(): void;
}

export interface OpenOptions {
  /** Fail (or copy-then-read) when a -wal sidecar is present. */
  copyThenRead?: boolean;
  busyTimeoutMs?: number;
}

export class SqliteUnavailableError extends Error {}

interface NodeSqliteStatement {
  iterate(...params: unknown[]): Iterable<{ key: string; value: unknown }>;
  get(...params: unknown[]): { key: string; value: unknown } | undefined;
  all(...params: unknown[]): unknown[];
}

interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

export interface RawSqliteDatabase extends NodeSqliteDb {
  /** Call when done: closes the handle and removes any snapshot copy. */
  dispose(): void;
}

/**
 * Open a read-only SQLite file. When a -wal sidecar is present and
 * copyThenRead is set, the db plus sidecars are copied to a temp dir first so
 * reads see a consistent snapshot even while a writer holds the original.
 */
export function openSqliteFile(file: string, options: OpenOptions = {}): RawSqliteDatabase {
  // Lazy require so importing this module never crashes on Node <22.5.
  let DatabaseSync: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    throw new SqliteUnavailableError(
      "node:sqlite is unavailable; this build requires Node >=22.5",
    );
  }
  const openTarget = fs.existsSync(`${file}-wal`) && options.copyThenRead ? copyDbWithWal(file) : file;
  const copyDir = openTarget !== file ? path.dirname(openTarget) : undefined;
  try {
    const db = new (DatabaseSync as new (
      path: string,
      opts: Record<string, unknown>,
    ) => NodeSqliteDb)(openTarget, { readOnly: true, enableForeignKeyConstraints: false });
    if (options.busyTimeoutMs) {
      db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs}`);
    }
    return wrapRaw(db, copyDir);
  } catch (err) {
    if (copyDir) throw err;
    // A writer may hold the DB; retry on a consistent snapshot copy.
    const retryCopy = copyDbWithWal(file);
    const db = new (DatabaseSync as new (
      path: string,
      opts: Record<string, unknown>,
    ) => NodeSqliteDb)(retryCopy, { readOnly: true, enableForeignKeyConstraints: false });
    return wrapRaw(db, path.dirname(retryCopy));
  }
}

function wrapRaw(db: NodeSqliteDb, copyDir?: string): RawSqliteDatabase {
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    dispose: () => {
      db.close();
      if (copyDir) fs.rmSync(copyDir, { recursive: true, force: true });
    },
  };
}

export function openVscDb(file: string, options: OpenOptions = {}): SqliteKVDatabase {
  const raw = openSqliteFile(file, options);
  return new NodeSqliteKVAdapter(raw);
}

class NodeSqliteKVAdapter implements SqliteKVDatabase {
  constructor(private readonly raw: RawSqliteDatabase) {}

  *iterateByPrefix(prefix: string): Iterable<KVRow> {
    const escaped = prefix.replace(/\*/g, "**");
    const pattern = `${escaped}%`;
    const iterator = this.raw
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ESCAPE '*' ORDER BY key")
      .iterate(pattern);
    for (const row of iterator) {
      yield {
        key: row.key,
        value: typeof row.value === "string" ? row.value : String(row.value ?? ""),
      };
    }
  }

  get(key: string): KVRow | undefined {
    const row = this.raw.prepare("SELECT key, value FROM cursorDiskKV WHERE key = ?").get(key);
    if (!row) return undefined;
    return {
      key: row.key,
      value: typeof row.value === "string" ? row.value : String(row.value ?? ""),
    };
  }

  close(): void {
    this.raw.dispose();
  }
}

export function copyDbWithWal(file: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-vscdb-"));
  const target = path.join(tmpDir, path.basename(file));
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`${file}${suffix}`)) {
      fs.copyFileSync(`${file}${suffix}`, `${target}${suffix}`);
    }
  }
  return target;
}