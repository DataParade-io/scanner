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

export function openVscDb(file: string, options: OpenOptions = {}): SqliteKVDatabase {
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
    return new NodeSqliteKVAdapter(db, copyDir);
  } catch (err) {
    if (copyDir) throw err;
    // A writer may hold the DB; retry on a consistent snapshot copy.
    const retryDir = path.dirname(copyDbWithWal(file));
    const copy = path.join(retryDir, path.basename(file));
    const db = new (DatabaseSync as new (
      path: string,
      opts: Record<string, unknown>,
    ) => NodeSqliteDb)(copy, { readOnly: true, enableForeignKeyConstraints: false });
    return new NodeSqliteKVAdapter(db, retryDir);
  }
}

interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    iterate(...params: unknown[]): Iterable<{ key: string; value: unknown }>;
    get(...params: unknown[]): { key: string; value: unknown } | undefined;
  };
  close(): void;
}

class NodeSqliteKVAdapter implements SqliteKVDatabase {
  constructor(
    private readonly db: NodeSqliteDb,
    private readonly copyDir?: string,
  ) {}

  *iterateByPrefix(prefix: string): Iterable<KVRow> {
    const escaped = prefix.replace(/\*/g, "**");
    const pattern = `${escaped}%`;
    const iterator = this.db
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
    const row = this.db.prepare("SELECT key, value FROM cursorDiskKV WHERE key = ?").get(key);
    if (!row) return undefined;
    return {
      key: row.key,
      value: typeof row.value === "string" ? row.value : String(row.value ?? ""),
    };
  }

  close(): void {
    this.db.close();
    if (this.copyDir) {
      fs.rmSync(this.copyDir, { recursive: true, force: true });
    }
  }
}

function copyDbWithWal(file: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-vscdb-"));
  const target = path.join(tmpDir, path.basename(file));
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`${file}${suffix}`)) {
      fs.copyFileSync(`${file}${suffix}`, `${target}${suffix}`);
    }
  }
  return target;
}
