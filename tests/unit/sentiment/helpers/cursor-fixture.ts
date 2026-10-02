import fs from "fs";
import os from "os";
import path from "path";

/**
 * Fixture generator for Cursor state.vscdb databases. Databases are written
 * at test time into a temp dir (binary SQLite fixtures are never committed);
 * generation keeps fixtures diffable and schema-explicit.
 */
export interface FixtureBubble {
  bubbleId: string;
  type: number;
  text: string;
  createdAt: number;
}

export interface FixtureComposer {
  composerId: string;
  bubbles: FixtureBubble[];
  workspaceIdentifier?: string;
  headers?: { bubbleId: string }[];
}

export interface GeneratedCursorProfile {
  /** The User dir (contains globalStorage/ and workspaceStorage/). */
  userDir: string;
  /** The fake ~/.cursor home (agent transcripts). */
  cursorHome: string;
  globalDb: string;
  homeDir: string;
}

type DbHandle = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): { value?: unknown; key?: unknown } | undefined;
  };
  close(): void;
};

function openDb(file: string): DbHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (file: string) => DbHandle };
  return new DatabaseSync(file);
}

function putKV(db: DbHandle, key: string, value: unknown): void {
  db.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
    key,
    JSON.stringify(value),
  );
}

export function generateCursorProfile(options?: {
  shape?: "2x" | "3x";
  globalComposers?: FixtureComposer[];
  workspaceComposers?: FixtureComposer[];
  workspaceFolderUri?: string;
  withWal?: boolean;
  agentTranscripts?: { sanitizedProject: string; sessionId: string; lines: Record<string, unknown>[] }[];
}): GeneratedCursorProfile {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-cursor-"));
  const userDir = path.join(homeDir, "Library", "Application Support", "Cursor", "User");
  const cursorHome = path.join(homeDir, ".cursor");
  const globalDb = path.join(userDir, "globalStorage", "state.vscdb");
  const shape = options?.shape ?? "2x";

  fs.mkdirSync(path.dirname(globalDb), { recursive: true });
  const global = openDb(globalDb);
  for (const composer of options?.globalComposers ?? []) {
    writeComposer(global, composer, shape);
  }
  global.close();

  if (options?.workspaceComposers?.length) {
    const wsDir = path.join(userDir, "workspaceStorage", "abc123def");
    const wsDb = path.join(wsDir, "state.vscdb");
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, "workspace.json"),
      JSON.stringify({ folder: options.workspaceFolderUri ?? "file:///Users/ryan/demo" }),
    );
    const db = openDb(wsDb);
    for (const composer of options.workspaceComposers) {
      writeComposer(db, composer, shape);
    }
    db.close();
  }

  for (const transcript of options?.agentTranscripts ?? []) {
    const sessionDir = path.join(
      cursorHome,
      "projects",
      transcript.sanitizedProject,
      "agent-transcripts",
      transcript.sessionId,
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, `${transcript.sessionId}.jsonl`),
      transcript.lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  }

  if (options?.withWal) {
    // Touch -wal/-shm siblings so tests exercise the WAL-safe read path.
    fs.writeFileSync(`${globalDb}-wal`, "");
    fs.writeFileSync(`${globalDb}-shm`, "");
  }

  return { userDir, cursorHome, globalDb, homeDir };
}

function writeComposer(db: DbHandle, composer: FixtureComposer, shape: "2x" | "3x"): void {
  for (const bubble of composer.bubbles) {
    putKV(db, `bubbleId:${composer.composerId}:${bubble.bubbleId}`, bubble);
  }
  putKV(db, `composer:${composer.composerId}`, {
    composerId: composer.composerId,
    fullConversationHeadersOnly:
      composer.headers ?? composer.bubbles.map((b) => ({ bubbleId: b.bubbleId })),
  });
  if (shape === "2x") {
    // 2.x per-workspace index: one key, allComposers array.
    const existing = readAllComposers(db, "composer.composerData");
    existing.push(
      composer.workspaceIdentifier
        ? { composerId: composer.composerId, workspaceIdentifier: composer.workspaceIdentifier }
        : composer.composerId,
    );
    putKV(db, "composer.composerData", { allComposers: existing });
  } else {
    // 3.x central index: per-composer header keys.
    putKV(db, `composer.composerHeaders:${composer.composerId}`, {
      composerId: composer.composerId,
      workspaceIdentifier: composer.workspaceIdentifier,
    });
  }
}

function readAllComposers(db: DbHandle, key: string): unknown[] {
  const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key);
  if (!row || typeof row.value !== "string") return [];
  try {
    const parsed = JSON.parse(row.value) as { allComposers?: unknown[] };
    return Array.isArray(parsed.allComposers) ? parsed.allComposers : [];
  } catch {
    return [];
  }
}

export function cleanupCursorProfile(profile: GeneratedCursorProfile): void {
  fs.rmSync(profile.homeDir, { recursive: true, force: true });
}
