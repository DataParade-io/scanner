import { promises as fs } from "fs";
import * as path from "path";
import { shouldSkipDirectoryName } from "../patterns/scan-exclusions";
import { toPosixPath } from "./gitignore";

/**
 * Storage schema files (KDATAP-fded10): Prisma schemas, SQL DDL, and Rails and Laravel
 * migrations, the places many
 * repositories declare their tables when no ORM model in code does. They are read for the
 * column catalog only, never ingested for detection, so they add declared columns without
 * adding occurrences to any layer.
 */
export interface SchemaFile {
  /** Path relative to the scan root, POSIX separators. */
  path: string;
  content: string;
  kind: "prisma" | "sql" | "rails" | "laravel";
}

const MAX_SCHEMA_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_FILES = 5_000;

/**
 * Test, fixture, seed, example and infrastructure directories hold sample or test-server
 * schemas (supabase-js `infra/db/00-schema.sql` is the auth server's test database), not
 * the storage the application declares.
 */
const NON_APP_DIR = /^(?:tests?|__tests__|spec|fixtures?|e2e|seeds?|examples?|docs?|infra)$/i;

export function schemaFileKind(filePath: string): SchemaFile["kind"] | undefined {
  const posix = toPosixPath(filePath);
  const ext = path.extname(posix).toLowerCase();
  if (ext === ".prisma") return "prisma";
  if (ext === ".sql") return "sql";
  // Rails: db/schema.rb and db/migrate/*.rb; Laravel: database/migrations/*.php.
  if (/(?:^|\/)db\/(?:schema\.rb|migrate\/[^/]+\.rb)$/.test(posix)) return "rails";
  if (/(?:^|\/)database\/migrations\/[^/]+\.php$/.test(posix)) return "laravel";
  return undefined;
}

/** Every `*.prisma` and `*.sql` file under the root, outside excluded, test and fixture directories. */
export async function readSchemaFiles(rootPath: string): Promise<SchemaFile[]> {
  const root = path.resolve(rootPath);
  const out: SchemaFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_SCHEMA_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDirectoryName(entry.name) || NON_APP_DIR.test(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const kind = schemaFileKind(path.relative(root, full));
        if (!kind) continue;
        try {
          const stat = await fs.stat(full);
          if (stat.size > MAX_SCHEMA_FILE_BYTES) continue;
          out.push({ path: toPosixPath(path.relative(root, full)), content: await fs.readFile(full, "utf8"), kind });
        } catch {
          /* unreadable files are skipped */
        }
        if (out.length >= MAX_SCHEMA_FILES) return;
      }
    }
  };
  await walk(root);
  return out;
}
