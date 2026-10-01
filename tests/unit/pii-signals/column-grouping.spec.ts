import fs from "fs";
import os from "os";
import path from "path";
import { columnIndex, mentionColumn } from "../../../src/analyze/column-identity";
import type { ColumnEntry } from "../../../src/analyze/column-catalog";
import { buildPersonalDataInventoryFromIngest, ensureDeclarationEngine } from "../../../src/eval-layers/personal-data-inventory";
import { assignDeclarationGroups } from "../../../src/pii-signals/mention-group";
import type { FileInfo } from "../../../src/core/types/file";

function file(filePath: string, language: FileInfo["language"], lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path: filePath, name: filePath.split("/").pop() as string, language, content, size: content.length };
}

const entry = (table: string, column: string, filePath: string, line: number, model?: string): ColumnEntry => ({
  table,
  ...(model ? { model } : {}),
  column,
  file: filePath,
  line,
  evidence: "orm-field",
  locations: [{ file: filePath, line }],
});

describe("mention column identity", () => {
  const index = columnIndex([
    entry("cart_address", "phone", "cart/models/address.ts", 5, "Address"),
    entry("order_address", "phone", "order/models/address.ts", 5, "Address"),
    entry("members_email_change_events", "from_email", "schema.js", 10),
    entry("members_email_change_events", "to_email", "schema.js", 11),
    entry("members", "email", "schema.js", 20),
    entry("users", "email", "schema.js", 30),
  ]);

  it("names the column a declaration location is", () => {
    expect(mentionColumn(index, { filePath: "order/models/address.ts", line: 5 })).toBe("order_address.phone");
    expect(mentionColumn(index, { filePath: "order/models/address.ts", line: 6 })).toBeUndefined();
  });

  it("names the column of a key the line defines when only one table has it, or the line names the table", () => {
    // from_email exists in one table: a copy line that reads another column still carries it.
    expect(mentionColumn(index, { filePath: "h.js", line: 3, columnHints: { keys: ["from_email"], writes: [] } })).toBe("members_email_change_events.from_email");
    // email exists in two tables: the entity the line names decides, and without one there is no column.
    expect(mentionColumn(index, { filePath: "h.js", line: 4, receiverEntity: "member", columnHints: { keys: ["email"], writes: [] } })).toBe("members.email");
    expect(mentionColumn(index, { filePath: "h.js", line: 4, columnHints: { keys: ["email"], writes: [] } })).toBeUndefined();
  });

  it("resolves a write target by the receiver's class or name", () => {
    expect(mentionColumn(index, { filePath: "h.js", columnHints: { keys: [], writes: [{ name: "email", receiverClass: "User" }] } })).toBe("users.email");
    expect(mentionColumn(index, { filePath: "h.js", columnHints: { keys: [], writes: [{ name: "email", receiverName: "members" }] } })).toBe("members.email");
  });
});

describe("column cannot-link in assignDeclarationGroups", () => {
  const hit = (filePath: string, line: number, group: string | undefined, column?: string) => ({
    id: "phone_number",
    location: "code" as const,
    evidence: { filePath, endLine: line },
    ...(group ? { group } : {}),
    ...(column ? { column } : {}),
  });

  it("never joins two different columns through a shared name, and logs the refusal", () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "column-refusal-")), "refused.log");
    process.env.DATAPARADE_REFUSED_LOG = log;
    try {
      const out = assignDeclarationGroups([
        hit("cart/address.ts", 5, "phone_number:address", "cart_address.phone"),
        hit("order/address.ts", 5, "phone_number:address", "order_address.phone"),
        hit("order/service.ts", 9, "phone_number:address"),
      ]);
      expect(out[0].group).toBe("phone_number:address");
      expect(out[1].group).not.toBe(out[0].group);
      // The unnamed-by-column mention joins the name's set that took the name first.
      expect(out[2].group).toBe("phone_number:address");
      const refused = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(refused).toEqual([expect.objectContaining({ phase: "column", joinedBy: "name", a: "order_address.phone", b: "cart_address.phone" })]);
    } finally {
      delete process.env.DATAPARADE_REFUSED_LOG;
    }
  });

  it("still joins mentions of the same column", () => {
    const out = assignDeclarationGroups([
      hit("a.ts", 5, "phone_number:address", "cart_address.phone"),
      hit("b.ts", 7, "phone_number:address", "cart_address.phone"),
    ]);
    expect(out[0].group).toBe(out[1].group);
  });
});

describe("column identity in the scan's grouping", () => {
  beforeAll(async () => {
    await ensureDeclarationEngine();
  });

  const groupsOf = (files: FileInfo[], signal: string): Record<string, string | undefined> => {
    const inventory = buildPersonalDataInventoryFromIngest(files, []);
    return Object.fromEntries(
      inventory.hits.filter((h) => h.id === signal && h.location !== "comment").map((h) => [`${h.evidence.filePath}:${h.evidence.endLine}`, h.group]),
    );
  };

  const dml = (table: string): string[] => [
    "import { model } from '@medusajs/framework/utils'",
    `export const Address = model.define('${table}', {`,
    "  phone: model.text().nullable(),",
    "})",
  ];

  it("splits phone declarations of different tables whose models share an entity name", () => {
    const groups = groupsOf(
      [file("cart/src/models/address.ts", "typescript", dml("cart_address")), file("order/src/models/address.ts", "typescript", dml("order_address"))],
      "phone_number",
    );
    expect(groups["cart/src/models/address.ts:3"]).toBeDefined();
    expect(groups["cart/src/models/address.ts:3"]).not.toBe(groups["order/src/models/address.ts:3"]);
  });

  it("splits ghost-style from/to columns, and a copy line carries the column its key names", () => {
    const schema = [
      "module.exports = {",
      "  members_email_change_events: {",
      "    from_email: { type: 'string', maxlength: 191 },",
      "    to_email: { type: 'string', maxlength: 191 },",
      "  },",
      "};",
    ];
    const handler = [
      "async function onChange(member) {",
      "  await MemberEmailChangeEvent.add({",
      "    from_email: member._previousAttributes.email,",
      "    to_email: member.email,",
      "  });",
      "}",
    ];
    const groups = groupsOf([file("schema.js", "javascript", schema), file("handler.js", "javascript", handler)], "email");
    expect(groups["schema.js:3"]).not.toBe(groups["schema.js:4"]);
    expect(groups["handler.js:3"]).not.toBe(groups["handler.js:4"]);
    // Each copy line carries the column its key names, not the column it reads.
    const columns = Object.fromEntries(
      buildPersonalDataInventoryFromIngest([file("schema.js", "javascript", schema), file("handler.js", "javascript", handler)], [])
        .hits.filter((h) => h.id === "email" && h.location !== "comment")
        .map((h) => [`${h.evidence.filePath}:${h.evidence.endLine}`, h.column]),
    );
    expect(columns["handler.js:3"]).toBe("members_email_change_events.from_email");
    expect(columns["handler.js:4"]).toBe("members_email_change_events.to_email");
    expect(columns["schema.js:3"]).toBe("members_email_change_events.from_email");
  });

  it("builds the catalog per signal: a phone column is not an email column", () => {
    const files = [file("cart/src/models/address.ts", "typescript", dml("cart_address"))];
    const inventory = buildPersonalDataInventoryFromIngest(files, []);
    const phone = inventory.hits.filter((h) => h.id === "phone_number" && h.location !== "comment");
    expect(phone.map((h) => h.column)).toEqual(["cart_address.phone"]);
    expect(inventory.hits.filter((h) => h.id === "email").every((h) => h.column === undefined)).toBe(true);
  });
});
