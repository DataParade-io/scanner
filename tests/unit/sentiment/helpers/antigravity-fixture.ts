import fs from "fs";
import os from "os";
import path from "path";

/**
 * Fixture generator for Antigravity conversation DBs. Databases are written
 * at test time into a temp dir (binary SQLite fixtures are never committed);
 * generation keeps fixtures diffable and schema-explicit. Payloads are
 * hand-encoded protobuf matching the pinned real format (KDATAP-91efe7).
 */

type DbHandle = {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
};

function openDb(file: string): DbHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file) as DbHandle;
  return db;
}

function encodeVarint(value: number): Buffer {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v & 0x7f);
  return Buffer.from(out);
}

function tag(field: number, wire: number): Buffer {
  return encodeVarint((field << 3) | wire);
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), encodeVarint(value)]);
}

function lenDelimField(field: number, bytes: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), encodeVarint(bytes.length), bytes]);
}

function submessage(...fields: Buffer[]): Buffer {
  return Buffer.concat(fields);
}

/** A type-14 user-turn payload with text (field 19.2) and a timestamp (5.1). */
export function userTurnPayload(options: {
  text: string;
  timestampMs: number;
}): Buffer {
  const seconds = Math.floor(options.timestampMs / 1000);
  const nanos = (options.timestampMs % 1000) * 1_000_000;
  const ts = submessage(varintField(1, seconds), varintField(2, nanos));
  const meta = submessage(lenDelimField(1, ts));
  const f19 = submessage(lenDelimField(2, Buffer.from(options.text, "utf8")));
  return Buffer.concat([lenDelimField(19, f19), lenDelimField(5, meta)]);
}

/** A type-14 artifact/plan attach send: field 19.7 URI, no text. */
export function artifactAttachPayload(options: { uri: string; timestampMs: number }): Buffer {
  const seconds = Math.floor(options.timestampMs / 1000);
  const ts = submessage(varintField(1, seconds), varintField(2, 0));
  const meta = submessage(lenDelimField(1, ts));
  const f19 = submessage(lenDelimField(7, Buffer.from(options.uri, "utf8")));
  return Buffer.concat([lenDelimField(19, f19), lenDelimField(5, meta)]);
}

/** An agent-narration style payload (some other message shape). */
export function agentPayload(options: { marker: string; timestampMs: number }): Buffer {
  const seconds = Math.floor(options.timestampMs / 1000);
  const ts = submessage(varintField(1, seconds), varintField(2, 0));
  const meta = submessage(lenDelimField(1, ts));
  const body = submessage(lenDelimField(1, Buffer.from(options.marker, "utf8")));
  return Buffer.concat([lenDelimField(20, body), lenDelimField(5, meta)]);
}

export interface FixtureStep {
  stepType: number;
  payload?: Buffer;
}

export interface FixtureConversation {
  conversationId: string;
  steps: FixtureStep[];
  parentConversationId?: string;
  workspaceUris?: string;
  /** Raw malformed payload bytes for a type-14 step. */
  malformedPayload?: Buffer;
}

export interface GeneratedAntigravityRoot {
  home: string;
  desktopRoot: string;
  cliRoot: string;
}

export function generateAntigravityProfile(
  desktopConversations: FixtureConversation[],
  cliConversations: FixtureConversation[],
  tmpDir?: string,
): GeneratedAntigravityRoot {
  const home = tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-antigravity-"));
  const desktopRoot = path.join(home, "antigravity");
  const cliRoot = path.join(home, "antigravity-cli");
  writeRoot(desktopRoot, desktopConversations);
  writeRoot(cliRoot, cliConversations);
  return { home, desktopRoot, cliRoot };
}

function writeRoot(root: string, conversations: FixtureConversation[]): void {
  const convDir = path.join(root, "conversations");
  fs.mkdirSync(convDir, { recursive: true });
  const db = openDb(path.join(root, "conversation_summaries.db"));
  db.exec(
    "CREATE TABLE `conversation_summaries` (`conversation_id` text,`title` text NOT NULL DEFAULT '',`preview` text NOT NULL DEFAULT '',`step_count` integer NOT NULL DEFAULT 0,`last_modified_time` datetime NOT NULL,`workspace_uris` text NOT NULL,`status` text NOT NULL DEFAULT '',`source` text NOT NULL DEFAULT '',`project_id` text NOT NULL DEFAULT '',`agent_name` text NOT NULL DEFAULT '',`parent_conversation_id` text NOT NULL DEFAULT '',`nesting_depth` integer NOT NULL DEFAULT 0,`battle_id` text NOT NULL DEFAULT '',`winning_conversation_id` text NOT NULL DEFAULT '',`not_fully_idle` numeric NOT NULL DEFAULT false,`killed` numeric NOT NULL DEFAULT false,`last_user_input_time` datetime NOT NULL,`last_user_input_step_index` integer NOT NULL DEFAULT -1,`app_data_dir` text NOT NULL DEFAULT '',`raw_summary` blob,`group_id` text NOT NULL DEFAULT '',PRIMARY KEY (`conversation_id`))",
  );
  for (const conv of conversations) {
    const cdb = openDb(path.join(convDir, `${conv.conversationId}.db`));
    cdb.exec(
      "CREATE TABLE `steps` (`idx` integer,`step_type` integer NOT NULL DEFAULT 0,`status` integer NOT NULL DEFAULT 0,`has_subtrajectory` numeric NOT NULL DEFAULT false,`metadata` blob,`error_details` blob,`permissions` blob,`task_details` blob,`render_info` blob,`step_payload` blob,`step_format` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))",
    );
    cdb.exec(
      "CREATE TABLE `trajectory_meta` (`trajectory_id` text,`cascade_id` text,`trajectory_type` integer,`source` integer,PRIMARY KEY (`trajectory_id`))",
    );
    let idx = 0;
    const insert = cdb.prepare(
      "INSERT INTO steps (idx, step_type, status, step_payload, step_format) VALUES (?, ?, 3, ?, 0)",
    );
    for (const step of conv.steps) {
      if (step.payload !== undefined) {
        insert.run(idx, step.stepType, step.payload);
        idx += 1;
      }
    }
    if (conv.malformedPayload) {
      insert.run(idx, 14, conv.malformedPayload);
      idx += 1;
    }
    cdb.close();
    db.prepare(
      "INSERT INTO conversation_summaries (conversation_id, parent_conversation_id, workspace_uris, last_modified_time, last_user_input_time) VALUES (?, ?, ?, ?, ?)",
    ).run(
      conv.conversationId,
      conv.parentConversationId ?? "",
      conv.workspaceUris ?? "",
      "2026-10-01T12:00:00.000Z",
      "2026-10-01T12:00:00.000Z",
    );
  }
  db.close();
}

export function cleanupAntigravityProfile(profile: GeneratedAntigravityRoot): void {
  fs.rmSync(profile.home, { recursive: true, force: true });
}