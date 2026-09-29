import fs from "fs";
import path from "path";
import YAML from "yaml";

import { validateAnnotation } from "./manifest";
import type { AnnotationRecord } from "./schema";

/**
 * Validation for agent-written labeling packets (KDATAP-8b2c8a).
 *
 * A packet lives at `repos/<repo>/annotations/packets/<issue-id>.yaml` and holds the
 * proposed mention gold for one batch of files. Unlike `loadAnnotations`, packet
 * validation is strict (unknown fields are errors), checks every evidence line against
 * the materialized source at the pinned commit, and requires exactly one record per
 * candidate line from `<concept>-candidates.yaml`. It reports every problem at once so
 * a labeling agent can fix its file in one pass.
 */

export interface PacketHeader {
  repo: string;
  concept: string;
  kanbus_issue: string;
  files: string[];
}

export interface CandidateLine {
  file: string;
  line: number;
}

export interface PacketValidationDeps {
  /** Materialized checkout of the corpus repo. */
  sourceRoot: string;
  /** Pinned commit from the repo manifest. */
  pinnedCommit: string;
  /** Current HEAD of `sourceRoot`, or undefined when it cannot be read. */
  readHeadCommit: (sourceRoot: string) => string | undefined;
}

export interface PacketValidationResult {
  errors: string[];
  warnings: string[];
  recordCount: number;
  candidateCount: number;
}

const PACKET_TOP_LEVEL_KEYS = ["packet", "annotations"];
const PACKET_HEADER_KEYS = ["repo", "concept", "kanbus_issue", "files"];
const PACKET_RECORD_KEYS = [
  "id",
  "layer",
  "subject",
  "evidence",
  "rationale",
  "expected",
  "provenance",
  "mention_attributes",
];

function unknownKeys(value: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseHeader(raw: unknown, errors: string[]): PacketHeader | undefined {
  const header = asRecord(raw);
  if (!header) {
    errors.push("Missing 'packet' header object");
    return undefined;
  }
  for (const key of unknownKeys(header, PACKET_HEADER_KEYS)) {
    errors.push(`Unknown field '${key}' in packet header`);
  }
  const missing = PACKET_HEADER_KEYS.filter((key) => header[key] === undefined);
  for (const key of missing) {
    errors.push(`Missing packet.${key}`);
  }
  const files = header.files;
  if (!Array.isArray(files) || files.some((item) => typeof item !== "string")) {
    errors.push("packet.files must be a list of repo-relative paths");
    return undefined;
  }
  if (missing.length > 0) {
    return undefined;
  }
  return {
    repo: String(header.repo),
    concept: String(header.concept),
    kanbus_issue: String(header.kanbus_issue),
    files: files.map((file) => file.trim()),
  };
}

/** Read `<concept>-candidates.yaml`; accepts a top-level list or a `candidates` list. */
export function loadCandidateLines(candidatesPath: string): CandidateLine[] {
  const parsed = YAML.parse(fs.readFileSync(candidatesPath, "utf8")) as unknown;
  const entries = Array.isArray(parsed) ? parsed : asRecord(parsed)?.candidates;
  if (!Array.isArray(entries)) {
    throw new Error(`Expected a candidate list in ${candidatesPath}`);
  }
  return entries.map((entry, index) => {
    const row = asRecord(entry);
    const file = row?.file ?? row?.file_path;
    const line = row?.line;
    if (typeof file !== "string" || typeof line !== "number") {
      throw new Error(`Candidate ${index} in ${candidatesPath} needs 'file' and 'line'`);
    }
    return { file, line };
  });
}

function lineCount(filePath: string): number {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

export function validatePacket(
  packetPath: string,
  candidates: CandidateLine[] | undefined,
  deps: PacketValidationDeps,
): PacketValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(packetPath, "utf8"));
  } catch (error) {
    errors.push(`YAML parse error: ${(error as Error).message}`);
    return { errors, warnings, recordCount: 0, candidateCount: 0 };
  }
  const root = asRecord(parsed);
  if (!root) {
    errors.push("Packet must be a YAML object with 'packet' and 'annotations'");
    return { errors, warnings, recordCount: 0, candidateCount: 0 };
  }
  for (const key of unknownKeys(root, PACKET_TOP_LEVEL_KEYS)) {
    errors.push(`Unknown top-level field '${key}'`);
  }

  const header = parseHeader(root.packet, errors);
  const rawRecords = root.annotations;
  if (!Array.isArray(rawRecords)) {
    errors.push("Missing 'annotations' list");
    return { errors, warnings, recordCount: 0, candidateCount: 0 };
  }

  const head = deps.readHeadCommit(deps.sourceRoot);
  const sourceReady = head === deps.pinnedCommit;
  if (!sourceReady) {
    errors.push(
      `Source at ${deps.sourceRoot} is at ${head ?? "no readable commit"}, ` +
        `expected pinned ${deps.pinnedCommit}; materialize the repo first`,
    );
  }
  const lineCounts = new Map<string, number | undefined>();
  const linesIn = (file: string): number | undefined => {
    if (!lineCounts.has(file)) {
      const full = path.join(deps.sourceRoot, file);
      lineCounts.set(file, fs.existsSync(full) ? lineCount(full) : undefined);
    }
    return lineCounts.get(file);
  };
  const checkLine = (file: string, line: number, where: string): void => {
    if (!sourceReady) {
      return;
    }
    const total = linesIn(file);
    if (total === undefined) {
      errors.push(`${where}: file '${file}' does not exist at the pinned commit`);
    } else if (line < 1 || line > total) {
      errors.push(`${where}: line ${line} is outside '${file}' (${total} lines)`);
    }
  };

  const records: AnnotationRecord[] = [];
  const seenIds = new Set<string>();
  rawRecords.forEach((raw, index) => {
    const where = `annotations[${index}]`;
    const row = asRecord(raw);
    if (!row) {
      errors.push(`${where}: expected an object`);
      return;
    }
    for (const key of unknownKeys(row, PACKET_RECORD_KEYS)) {
      errors.push(`${where}: unknown field '${key}'`);
    }
    let record: AnnotationRecord;
    try {
      record = validateAnnotation(row, "packet", index);
    } catch (error) {
      errors.push(`${where}: ${(error as Error).message}`);
      return;
    }
    if (record.layer !== "mentions") {
      errors.push(`${where}: packet records must be layer 'mentions'`);
    }
    if (record.provenance.review_state !== "proposed") {
      errors.push(`${where}: packet records must have review_state 'proposed'`);
    }
    if (seenIds.has(record.id)) {
      errors.push(`${where}: duplicate id '${record.id}'`);
    }
    seenIds.add(record.id);

    const { file_path: file, start_line: start, end_line: end } = record.evidence;
    if (start > end) {
      errors.push(`${where}: evidence start_line ${start} is after end_line ${end}`);
    }
    if (header && !header.files.includes(file)) {
      errors.push(`${where}: evidence file '${file}' is not in packet.files`);
    }
    checkLine(file, start, where);
    checkLine(file, end, where);

    const declaration = record.mention_attributes?.declaration;
    const syntaxKind = record.mention_attributes?.syntax_kind;
    const positive = record.expected.status === "positive";
    if (
      positive &&
      (syntaxKind === "identifier" || syntaxKind === "property_key") &&
      declaration === undefined
    ) {
      errors.push(
        `${where}: positive ${syntaxKind} needs mention_attributes.declaration ` +
          "(use 'unresolved' if it cannot be found)",
      );
    }
    if (
      declaration !== undefined &&
      (!positive ||
        syntaxKind === "comment" ||
        syntaxKind === "import_specifier" ||
        syntaxKind === "string_literal")
    ) {
      errors.push(
        `${where}: declaration is only recorded on positive identifier, property_key, or type_name lines`,
      );
    }
    if (declaration && declaration !== "unresolved") {
      checkLine(declaration.file_path, declaration.line, `${where}.declaration`);
    }
    records.push(record);
  });

  let candidateCount = 0;
  if (header && candidates) {
    const inScope = candidates.filter((candidate) => header.files.includes(candidate.file));
    candidateCount = inScope.length;
    const covered = new Set<AnnotationRecord>();
    for (const candidate of inScope) {
      const matches = records.filter(
        (record) =>
          record.evidence.file_path === candidate.file &&
          record.evidence.start_line <= candidate.line &&
          candidate.line <= record.evidence.end_line,
      );
      matches.forEach((record) => covered.add(record));
      if (matches.length === 0) {
        errors.push(`Missing record for candidate ${candidate.file}:${candidate.line}`);
      } else if (matches.length > 1) {
        errors.push(
          `Candidate ${candidate.file}:${candidate.line} has ${matches.length} records; expected exactly one`,
        );
      }
    }
    for (const record of records) {
      if (!covered.has(record)) {
        warnings.push(
          `Record '${record.id}' at ${record.evidence.file_path}:${record.evidence.start_line} ` +
            "is not a candidate line (kept; the inventory may have missed it)",
        );
      }
    }
  } else if (header) {
    warnings.push("No candidate file found; candidate coverage was not checked");
  }

  return { errors, warnings, recordCount: records.length, candidateCount };
}
