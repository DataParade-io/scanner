import { CodeNavigator } from "../../../src/analyze/code-navigator";
import { declaredColumns, type ColumnEntry } from "../../../src/analyze/column-catalog";
import { initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS } from "../../../src/analyze/languages";
import type { FileInfo } from "../../../src/core/types/file";

function file(path: string, language: FileInfo["language"], lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path, name: path.split("/").pop() as string, language, content, size: content.length };
}

/** `table.column (evidence)` of every entry, for compact assertions. */
function summary(entries: ColumnEntry[]): string[] {
  return entries.map((entry) => `${entry.table ?? "?"}.${entry.column} (${entry.evidence})`);
}

const DJANGO = [
  "from django.db import models", //                                   1
  "", //                                                               2
  "class Order(models.Model):", //                                     3
  "    user_email = models.EmailField(blank=True)", //                  4
  "    email_count = models.IntegerField(default=0)", //                5
  "    user = models.ForeignKey(User, on_delete=models.CASCADE)", //    6
  "    contact = models.EmailField()", //                               7
  "    notes = models.TextField()", //                                  8
  "", //                                                               9
  "class ContactForm(forms.Form):", //                                 10
  "    email = forms.EmailField()", //                                  11
];

const TYPEORM = [
  "@Entity('people')", //                                              1
  "export class Person {", //                                          2
  "  @Column({ type: 'varchar', name: 'mail_address' })", //            3
  "  contactEmail: string;", //                                        4
  "  @Column()", //                                                    5
  "  email: string;", //                                               6
  "  @Column()", //                                                    7
  "  emailCount: number;", //                                          8
  "  notAColumn: string;", //                                          9
  "}", //                                                              10
];

const SEQUELIZE = [
  "module.exports = (sequelize, DataTypes) => {", //                                         1
  "  const Member = sequelize.define('Member', {", //                                        2
  "    email: { type: DataTypes.STRING, unique: true },", //                                 3
  "    loginCount: { type: DataTypes.INTEGER },", //                                         4
  "  }, { tableName: 'members_tbl' });", //                                                  5
  "  return Member;", //                                                                     6
  "};", //                                                                                   7
  "class Invite extends Model {}", //                                                        8
  "Invite.init({ inviteEmail: { type: DataTypes.TEXT } }, { sequelize, tableName: 'invites' });", // 9
];

const MONGOOSE = [
  "const userSchema = new mongoose.Schema({", //                       1
  "  email: String,", //                                               2
  "  backupEmail: { type: String, required: true },", //               3
  "  emailVerified: Boolean,", //                                      4
  "});", //                                                            5
];

const GHOST_SCHEMA = [
  "module.exports = {", //                                                          1
  "  members: {", //                                                               2
  "    id: { type: 'string', maxlength: 24 },", //                                  3
  "    email: { type: 'string', maxlength: 191, validations: { isEmail: true } },", // 4
  "    email_disabled: { type: 'boolean', defaultTo: false },", //                  5
  "    email_id: { type: 'string', references: 'emails.id' },", //                  6
  "  },", //                                                                        7
  "  suppressions: {", //                                                           8
  "    email: { type: 'string' },", //                                              9
  "  },", //                                                                        10
  "};", //                                                                          11
];

const KNEX_MIGRATION = [
  "exports.up = async (knex) => {", //                                              1
  "  await knex.schema.createTable('subscribers', (table) => {", //                  2
  "    table.increments('id');", //                                                 3
  "    table.string('contact_email', 191).notNullable();", //                       4
  "    table.boolean('email_optin');", //                                            5
  "  });", //                                                                        6
  "  await knex.schema.alterTable('directus_users', (table) => table.string('email'));", // 7
  "  await helper.changeToType('directus_users', 'email', 'string', { length: 255 });", // 8
  "  await commands.addColumn('members', 'billing_email', 'string');", //            9
  "  await createAddColumnMigration('emails', 'reply_email', { type: 'string' });", // 10
  "  await helper.dropColumn('directus_users', 'email');", //                        11
  "  table.string('email_outside');", //                                             12
  "};", //                                                                           13
];

const KNEX_LATER = [
  "exports.up = async (knex) => {", //                                              1
  "  await helper.changeToType('directus_users', 'email', 'text');", //              2
  "};", //                                                                           3
];

const STRAPI_TS = [
  "export default {", //                                               1
  "  collectionName: 'admin_users',", //                               2
  "  info: { name: 'User', displayName: 'Admin user' },", //           3
  "  attributes: {", //                                                4
  "    firstname: { type: 'string' },", //                             5
  "    email: { type: 'email', required: true },", //                  6
  "    contact: { type: 'email' },", //                                7
  "    emailVerified: { type: 'boolean' },", //                        8
  "  },", //                                                           9
  "};", //                                                            10
];

const STRAPI_JSON = JSON.stringify(
  {
    kind: "collectionType",
    collectionName: "up_users",
    info: { singularName: "user", pluralName: "users", displayName: "User" },
    attributes: {
      username: { type: "string" },
      email: { type: "email", minLength: 6 },
      provider: { type: "string" },
      role: { type: "relation", relation: "manyToOne" },
    },
  },
  null,
  2,
);

describe("declared column catalog", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("finds Django model fields and ignores relations, non-text fields and form fields", () => {
    const entries = declaredColumns([file("shop/models.py", "python", DJANGO)], "email");
    expect(summary(entries)).toEqual(["Order.contact (orm-field)", "Order.user_email (orm-field)"]);
    expect(entries[1]).toMatchObject({ model: "Order", file: "shop/models.py", line: 4, type: "EmailField" });
  });

  it("finds TypeORM @Column properties with the entity table and column name option", () => {
    const entries = declaredColumns([file("src/person.ts", "typescript", TYPEORM)], "email");
    expect(summary(entries)).toEqual(["people.email (orm-field)", "people.mail_address (orm-field)"].sort());
    expect(entries.find((e) => e.column === "email")).toMatchObject({ model: "Person", line: 6 });
    expect(entries.find((e) => e.column === "mail_address")).toMatchObject({ line: 4, type: "varchar" });
  });

  it("finds Sequelize define and init attribute objects", () => {
    const entries = declaredColumns([file("models/member.js", "javascript", SEQUELIZE)], "email");
    expect(summary(entries)).toEqual(["invites.inviteEmail (orm-field)", "members_tbl.email (orm-field)"]);
    expect(entries.find((e) => e.column === "email")).toMatchObject({ model: "Member", line: 3 });
    expect(entries.find((e) => e.column === "inviteEmail")).toMatchObject({ model: "Invite", type: "DataTypes.TEXT" });
  });

  it("finds Mongoose Schema keys, plain and with options", () => {
    const entries = declaredColumns([file("models/user.js", "javascript", MONGOOSE)], "email");
    expect(summary(entries)).toEqual(["userSchema.backupEmail (orm-field)", "userSchema.email (orm-field)"]);
  });

  it("finds ghost-style schema objects: the table key owns column keys with a type", () => {
    const entries = declaredColumns([file("schema/schema.js", "javascript", GHOST_SCHEMA)], "email");
    // `email_disabled` is boolean and `email_id` is a reference: neither stores an address.
    expect(summary(entries)).toEqual(["members.email (schema-object)", "suppressions.email (schema-object)"]);
    expect(entries[0]).toMatchObject({ line: 4, type: "string" });
  });

  it("finds knex column calls and column helper calls, and collapses repeated migrations", () => {
    const entries = declaredColumns(
      [file("migrations/001.js", "javascript", KNEX_MIGRATION), file("migrations/002.js", "javascript", KNEX_LATER)],
      "email",
    );
    expect(summary(entries)).toEqual([
      "directus_users.email (migration)",
      "emails.reply_email (migration)",
      "members.billing_email (migration)",
      "subscribers.contact_email (migration)",
    ]);
    const users = entries[0];
    expect(users.locations).toEqual([
      { file: "migrations/001.js", line: 7 },
      { file: "migrations/001.js", line: 8 },
      { file: "migrations/002.js", line: 2 },
    ]);
    expect(users).toMatchObject({ file: "migrations/001.js", line: 7 });
    // The boolean `email_optin`, the drop, and the call outside a table callback are not columns.
    expect(summary(entries).join()).not.toMatch(/optin|outside/);
  });

  it("finds strapi content types in source and in schema.json", () => {
    const entries = declaredColumns(
      [file("admin/User.ts", "typescript", STRAPI_TS), file("up/user/schema.json", "json", STRAPI_JSON.split("\n"))],
      "email",
    );
    expect(summary(entries)).toEqual(["admin_users.contact (content-type)", "admin_users.email (content-type)", "up_users.email (content-type)"]);
    expect(entries.find((e) => e.table === "admin_users" && e.column === "email")).toMatchObject({ model: "User", line: 6, type: "email" });
    expect(entries.find((e) => e.table === "up_users")).toMatchObject({ model: "User", file: "up/user/schema.json", line: 13 });
  });

  it("ignores JSON that is not a content-type schema", () => {
    expect(declaredColumns([file("schema.json", "json", ["{ not json"]), file("package.json", "json", ['{"email":"x"}'])], "email")).toEqual([]);
  });

  it("matches the concept's tokens like the scanner's signal, and by declared type", () => {
    const entries = declaredColumns([file("shop/models.py", "python", DJANGO)], "email");
    // `contact` is catalogued because its field class is EmailField, not by its name.
    expect(entries.map((e) => e.column)).toContain("contact");
    expect(declaredColumns([file("shop/models.py", "python", DJANGO)], "phone")).toEqual([]);
  });

  it("answers the navigator columns op", () => {
    const nav = new CodeNavigator([file("shop/models.py", "python", DJANGO), file("up/schema.json", "json", ["{}"]), file("a/schema.json", "json", STRAPI_JSON.split("\n"))]);
    const response = nav.handle({ op: "columns", concept: "email" }) as any;
    expect(response).toMatchObject({ ok: true, op: "columns", concept: "email", total: 3, truncated: false });
    expect(response.columns.map((c: any) => `${c.table}.${c.column}`)).toEqual(["Order.contact", "Order.user_email", "up_users.email"]);
    expect(response.columns[0].locations).toEqual([{ file: "shop/models.py", line: 7 }]);
    expect(nav.handle({ op: "columns", concept: "email", limit: 1 })).toMatchObject({ truncated: true });
    expect(nav.handle({ op: "columns" })).toMatchObject({ ok: false });
  });
});
