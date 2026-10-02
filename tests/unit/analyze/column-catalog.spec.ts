import { CodeNavigator } from "../../../src/analyze/code-navigator";
import { declaredColumns, type ColumnEntry } from "../../../src/analyze/column-catalog";
import { conceptProfile, normalizeTypeName } from "../../../src/analyze/concept-profile";
import { initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS } from "../../../src/analyze/languages";
import type { FileInfo } from "../../../src/core/types/file";
import type { SchemaFile } from "../../../src/ingest/schema-files";

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

const SETTINGS_PY = [
  "import os", //                                                             1
  "", //                                                                      2
  'DEFAULT_FROM_EMAIL: str = os.environ.get("DEFAULT_FROM_EMAIL", "a@b.c")', // 3
  'SERVER_EMAIL = os.getenv("SERVER_EMAIL")', //                              4
  'SUPPORT_REPLY_TO = os.environ["SUPPORT_REPLY_TO"]', //                     5
  "EMAIL_HOST = 'localhost'", //                                              6
  "LOCALE = 'en'", //                                                         7
];

const SEND_PY = [
  "from django.conf import settings", //                                      1
  "def send(mail):", //                                                       2
  "    mail.sender = settings.DEFAULT_FROM_EMAIL", //                         3
  "    mail.host = settings.EMAIL_HOST", //                                   4
  "    mail.sender_name = settings.SENDER_NAME", //                           5
];

const READS_JS = [
  "const from = config.get('mail:from');", //                                  1
  "const support = this.settingsCache.get('members_support_address');", //     2
  "const reply = getSetting('reply_to_address');", //                          3
  "const sender = process.env.EMAIL_FROM;", //                                 4
  "const admin = env['ADMIN_EMAIL'];", //                                      5
  "const other = env.get('MAIL_REPLYTO');", //                                 6
  "const subject = settings.get('email_subject');", //                         7
  "const clicks = process.env.EMAIL_TRACK_CLICKS;", //                         8
  "const helper = settings.getDefaultEmail();", //                             9
  "const noise = user.get('email_from');", //                                  10
];

const STRAPI_CONFIG = [
  "export const config = {", //                                               1
  "  default: {", //                                                          2
  "    provider: 'sendmail',", //                                             3
  "    settings: { defaultFrom: 'Strapi <no-reply@strapi.io>', defaultReplyTo: 'x' },", // 4
  "  },", //                                                                  5
  "};", //                                                                    6
];

const DEFAULT_SETTINGS_JSON = JSON.stringify(
  {
    members: {
      members_support_address: { defaultValue: "noreply", flags: "PUBLIC,RO", type: "string" },
      members_signup_access: { defaultValue: "all", type: "string" },
      members_from_address: { defaultValue: "noreply", type: "string" },
    },
  },
  null,
  2,
);

describe("configured address keys", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const configured = (files: FileInfo[]): string[] => summary(declaredColumns(files, "email", { include: "configured" }));

  it("lists nothing configured unless asked", () => {
    expect(declaredColumns([file("src/reads.js", "javascript", READS_JS)], "email")).toEqual([]);
  });

  it("finds literal-key reads of settings, config and env, by receiver name", () => {
    expect(configured([file("src/reads.js", "javascript", READS_JS)])).toEqual([
      "config.mail:from (config)",
      "env.ADMIN_EMAIL (env)",
      "env.EMAIL_FROM (env)",
      "env.MAIL_REPLYTO (env)",
      "settings.members_support_address (setting)",
      "settings.reply_to_address (setting)",
    ]);
  });

  it("finds Django settings: environment reads, settings-module assignments and settings members", () => {
    const entries = declaredColumns(
      [file("shop/settings.py", "python", SETTINGS_PY), file("shop/send.py", "python", SEND_PY)],
      "email",
      { include: "configured" },
    );
    expect(summary(entries)).toEqual([
      "env.DEFAULT_FROM_EMAIL (env)",
      "env.SERVER_EMAIL (env)",
      "env.SUPPORT_REPLY_TO (env)",
      "settings.DEFAULT_FROM_EMAIL (setting)",
      "settings.SERVER_EMAIL (setting)",
      "settings.SUPPORT_REPLY_TO (setting)",
    ]);
    // Every read and definition site is listed: the settings module and the sender.
    expect(entries.find((e) => e.table === "settings" && e.column === "DEFAULT_FROM_EMAIL")?.locations).toEqual([
      { file: "shop/send.py", line: 3 },
      { file: "shop/settings.py", line: 3 },
    ]);
  });

  it("finds keys in config files and default-settings JSON", () => {
    const entries = declaredColumns(
      [file("email/server/config.ts", "typescript", STRAPI_CONFIG), file("data/default-settings/default-settings.json", "json", DEFAULT_SETTINGS_JSON.split("\n"))],
      "email",
      { include: "configured" },
    );
    expect(summary(entries)).toEqual([
      "config.defaultFrom (config)",
      "config.defaultReplyTo (config)",
      "settings.members_from_address (setting)",
      "settings.members_support_address (setting)",
    ]);
    expect(entries.find((e) => e.column === "members_support_address")).toMatchObject({ file: "data/default-settings/default-settings.json", line: 3 });
  });

  it("returns configured entries from the navigator only with include", () => {
    const nav = new CodeNavigator([file("src/reads.js", "javascript", READS_JS), file("shop/models.py", "python", DJANGO)]);
    const plain = nav.handle({ op: "columns", concept: "email" }) as any;
    expect(plain.columns.map((c: any) => c.evidence)).toEqual(["orm-field", "orm-field"]);
    const withConfigured = nav.handle({ op: "columns", concept: "email", include: "configured" }) as any;
    expect(withConfigured.columns.map((c: any) => c.evidence)).toContain("config");
    expect(withConfigured.columns.find((c: any) => c.column === "mail:from")).toMatchObject({ table: "config", evidence: "config", locations: [{ file: "src/reads.js", line: 1 }] });
  });
});

const PHONE_PY = [
  "from phonenumber_field.modelfields import PhoneNumberField", //                       1
  "", //                                                                                 2
  "class Address(ModelWithMetadata):", //                                                3
  '    phone = PossiblePhoneNumberField(blank=True, default="")', //                     4
  "    billing_phone = models.CharField(max_length=30)", //                              5
  "    contact = PhoneNumberField(null=True)", //                                        6
  "    phone_verified = models.BooleanField(default=False)", //                          7
  "    street = models.CharField(max_length=256)", //                                    8
  "", //                                                                                 9
  "class AddressForm(forms.Form):", //                                                   10
  "    phone = forms.CharField()", //                                                    11
  "", //                                                                                 12
  "class AddressInput(Input):", //                                                       13
  "    mobile = PossiblePhoneNumberField()", //                                          14
];

const DML_TS = [
  "import { model } from '@medusajs/framework/utils'", //                                1
  "", //                                                                                 2
  "const Customer = model.define('customer', {", //                                      3
  "  id: model.id({ prefix: 'cus' }).primaryKey(),", //                                  4
  "  phone: model.text().nullable(),", //                                                5
  "  email: model.text().searchable().nullable(),", //                                   6
  "  phone_count: model.number(),", //                                                  7
  "  addresses: model.hasMany(() => Address, { mappedBy: 'customer' }),", //            8
  "})", //                                                                               9
  "export const StockLocationAddress = model.define({ name: 'StockLocationAddress', tableName: 'stock_location_address' }, {", // 10
  "  phone: model.text().nullable(),", //                                                11
  "})", //                                                                               12
];

const PHONE_SETTINGS_PY = [
  "import os", //                                                                        1
  "TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER')", //                      2
  "SUPPORT_PHONE = os.getenv('SUPPORT_PHONE')", //                                       3
  "SMS_SENDER_PHONE = os.environ['SMS_SENDER_PHONE']", //                                4
  "PHONE_VERIFIED = False", //                                                           5
  "DEFAULT_FROM_EMAIL = 'a@b.c'", //                                                     6
  "SENDER_ADDRESS = 'x'", //                                                             7
];

const RECORD_TS = [
  "export interface User {", //                                          1
  "  id: string", //                                                     2
  "  new_email?: string", //                                             3
  "  email?: string", //                                                 4
  "  phone?: string", //                                                 5
  "  email_confirmed_at?: string", //                                    6
  "  created_at: string", //                                             7
  "}", //                                                                8
  "export type VerifyEmailOtpParams = { email: string; token: string }", // 9
  "export type Factor = { id: string; created_at: string; phone_verified: boolean }", // 10
  "export interface Options { id: string; email: string }", //           11
];

describe("record types", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("lists members of interfaces and object type aliases that have an id and a row timestamp", () => {
    const entries = declaredColumns([file("auth/src/lib/types.ts", "typescript", RECORD_TS)], "email");
    // Parameter types and types without a row timestamp are not records; timestamps typed as
    // strings (`email_confirmed_at`) hold no address.
    expect(summary(entries)).toEqual(["User.email (record-type)", "User.new_email (record-type)"]);
    expect(entries[0]).toMatchObject({ model: "User", line: 4, type: "string" });
    expect(summary(declaredColumns([file("auth/src/lib/types.ts", "typescript", RECORD_TS)], "phone_number"))).toEqual(["User.phone (record-type)"]);
  });

  it("does not read record types from generated API client files", () => {
    expect(declaredColumns([file("src/graphql/types.generated.ts", "typescript", RECORD_TS)], "email")).toEqual([]);
  });

  it("uses record types only where the repository declares no storage for the concept", () => {
    const files = [file("auth/src/lib/types.ts", "typescript", RECORD_TS), file("db/models.ts", "typescript", TYPEORM)];
    expect(summary(declaredColumns(files, "email"))).toEqual(["people.email (orm-field)", "people.mail_address (orm-field)"]);
  });

  it("reads a nullable union by its non-null member", () => {
    const counts = ["interface Run { id: string; created_at: Date; email_sent_count: number | null; member_email: string | null }"];
    expect(summary(declaredColumns([file("a/run.ts", "typescript", counts)], "email"))).toEqual(["Run.member_email (record-type)"]);
  });

  it("does not read report column helpers with labels or dotted paths as migrations", () => {
    const report = ['CsvColumn("Employee email", "employee.email")', "helper.changeToType('users', 'email')"];
    expect(summary(declaredColumns([file("reports/csv.py", "python", report.slice(0, 1)), file("m/1.js", "javascript", report.slice(1))], "email"))).toEqual([
      "users.email (migration)",
    ]);
  });

  it("does not read test-tool configs as configured addresses", () => {
    const jest = ["module.exports = { collectCoverageFrom: ['src/**'] }"];
    expect(declaredColumns([file("pkg/jest.config.js", "javascript", jest)], "email", { include: "configured" })).toEqual([]);
  });
});

const PRISMA = [
  "model User {", //                                         1
  "  id        String   @id @default(cuid())", //           2
  "  email     String   @unique", //                        3
  "  phoneNumber String? @map(\"phone_number\")", //         4
  "  emailVerified DateTime?", //                           5
  "  manager   User?    @relation(fields: [managerId], references: [id])", // 6
  "  createdAt DateTime @default(now())", //                7
  "  @@map(\"users\")", //                                  8
  "}", //                                                   9
  "model Invite { inviteEmail String }", //                 10 (one-line blocks are not parsed)
].join("\n");

const SQL = [
  "CREATE TABLE IF NOT EXISTS public.subscribers (", //    1
  "  id SERIAL PRIMARY KEY,", //                            2
  "  \"email\" TEXT NOT NULL UNIQUE,", //                    3
  "  email_count INTEGER DEFAULT 0,", //                    4
  "  attribs JSONB,", //                                    5
  "  CONSTRAINT email_unique UNIQUE (email)", //            6
  ");", //                                                  7
  "ALTER TABLE \"User\" ADD COLUMN \"backupEmail\" TEXT;", // 8
  "CREATE TABLE \"User\" (\"email\" TEXT, \"phone\" varchar(20));", // 9 (columns on the create line are not read)
].join("\n");

function schema(path: string, kind: SchemaFile["kind"], content: string): SchemaFile {
  return { path, kind, content };
}

describe("storage schema files", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("reads Prisma String fields with @map and @@map names, not relations or non-text fields", () => {
    const files = [schema("prisma/schema.prisma", "prisma", PRISMA)];
    expect(summary(declaredColumns([], "email", {}, files))).toEqual(["users.email (prisma-model)"]);
    expect(declaredColumns([], "email", {}, files)[0]).toMatchObject({ model: "User", line: 3 });
    expect(summary(declaredColumns([], "phone_number", {}, files))).toEqual(["users.phone_number (prisma-model)"]);
  });

  it("reads CREATE TABLE column definitions and ALTER TABLE ADD COLUMN, skipping constraints and non-text types", () => {
    const files = [schema("db/schema.sql", "sql", SQL)];
    expect(summary(declaredColumns([], "email", {}, files))).toEqual(["subscribers.email (sql-ddl)", "User.backupEmail (sql-ddl)"]);
  });

  it("keeps only schema columns that name the value: the concept last, or before an address word", () => {
    const sql = schema(
      "db/schema.sql",
      "sql",
      "CREATE TABLE users (\n  email TEXT,\n  email_change_token TEXT,\n  emailHash TEXT,\n  email_type TEXT,\n  customEmailSubject TEXT,\n  auth_email_domains TEXT,\n  reply_to_email TEXT,\n  email_address TEXT,\n  mobile_footer TEXT\n);\nCREATE TABLE __new_users (\n  email TEXT\n);",
    );
    expect(summary(declaredColumns([], "email", {}, [sql]))).toEqual(["users.email (sql-ddl)", "users.email_address (sql-ddl)", "users.reply_to_email (sql-ddl)"]);
    expect(declaredColumns([], "phone_number", {}, [sql])).toEqual([]);
  });

  it("reads Rails schema.rb, Rails migrations and Laravel migrations", () => {
    const rails = schema(
      "db/schema.rb",
      "rails",
      'ActiveRecord::Schema.define do\n  create_table "users", force: :cascade do |t|\n    t.string "email", default: ""\n    t.integer "email_count"\n    t.string "phone_number"\n  end\nend',
    );
    const migration = schema("db/migrate/2017_create_user_emails.rb", "rails", "create_table :user_emails do |t|\n  t.string :email, limit: 513\nend\nadd_column :invites, :invitee_email, :string");
    const laravel = schema(
      "database/migrations/2014_create_users_table.php",
      "laravel",
      "Schema::create('users', function (Blueprint $table) {\n    $table->id();\n    $table->string('email')->unique();\n    $table->timestamp('email_verified_at');\n});",
    );
    expect(summary(declaredColumns([], "email", {}, [rails, migration]))).toEqual([
      "invites.invitee_email (migration)",
      "user_emails.email (migration)",
      "users.email (migration)",
    ]);
    expect(summary(declaredColumns([], "phone_number", {}, [rails]))).toEqual(["users.phone_number (migration)"]);
    expect(summary(declaredColumns([], "email", {}, [laravel]))).toEqual(["users.email (migration)"]);
  });

  it("reads named @@map and @map arguments, and folds a model's SQL table into it", () => {
    const prisma = schema("prisma/schema.prisma", "prisma", 'model User {\n  email String\n  phone String? @map(name: "phone_number")\n  @@map(name: "users")\n}');
    const migration = schema("prisma/migrations/1/migration.sql", "sql", 'CREATE TABLE "users" (\n  "email" TEXT NOT NULL\n);');
    expect(summary(declaredColumns([], "email", {}, [prisma, migration]))).toEqual(["users.email (prisma-model)"]);
    expect(summary(declaredColumns([], "phone_number", {}, [prisma]))).toEqual(["users.phone_number (prisma-model)"]);
  });

  it("uses SQL DDL only for columns no model declares", () => {
    const prisma = schema("prisma/schema.prisma", "prisma", "model User {\n  email String\n}");
    const migration = schema("prisma/migrations/1/migration.sql", "sql", 'CREATE TABLE "User" (\n  "email" TEXT NOT NULL,\n  "alt_email" TEXT\n);');
    expect(summary(declaredColumns([], "email", {}, [prisma, migration]))).toEqual(["User.alt_email (sql-ddl)", "User.email (prisma-model)"]);
  });

  it("drops the record-type fallback when a schema file declares storage", () => {
    const files = [file("auth/src/lib/types.ts", "typescript", RECORD_TS)];
    expect(summary(declaredColumns(files, "email", {}, [schema("db/schema.sql", "sql", SQL)]))).toEqual(["subscribers.email (sql-ddl)", "User.backupEmail (sql-ddl)"]);
  });
});

describe("entity and struct declarations in Java, Go, SQLAlchemy and Drizzle", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("reads JPA @Entity String fields with @Column and @Table names, not @Transient", () => {
    const java = [
      "@Entity", //                                1
      "@Table(name = \"USER_ENTITY\")", //           2
      "public class UserEntity {", //              3
      "  @Column(name = \"EMAIL\")", //             4
      "  protected String email;", //              5
      "  protected String telephone;", //          6
      "  @Transient private String emailDraft;", // 7
      "  protected int emailCount;", //            8
      "}", //                                      9
      "class EmailDto { String email; }", //       10
    ];
    const files = [file("model/UserEntity.java", "java", java)];
    expect(summary(declaredColumns(files, "email"))).toEqual(["USER_ENTITY.EMAIL (orm-field)"]);
    expect(declaredColumns(files, "email")[0]).toMatchObject({ model: "UserEntity", line: 5 });
  });

  it("reads Go structs with ORM tags: tag column names, else snake case; string fields only", () => {
    const go = [
      "package user", //                                           1
      "type User struct {", //                                     2
      "\tID int64 `xorm:\"pk autoincr\"`", //                       3
      "\tEmail string `xorm:\"NOT NULL\"`", //                      4
      "\tPhoneNumber *string `gorm:\"column:phone_no\"`", //        5
      "\tNotifyEmail string `db:\"notify_email\"`", //               6
      "\tEmailCount int `db:\"email_count\"`", //                   7
      "}", //                                                      8
      "type Payload struct { Email string `json:\"email\"` }", //   9
    ];
    const files = [file("models/user.go", "go", go)];
    expect(summary(declaredColumns(files, "email"))).toEqual(["User.email (orm-field)", "User.notify_email (orm-field)"]);
    expect(summary(declaredColumns(files, "phone_number"))).toEqual(["User.phone_no (orm-field)"]);
  });

  it("reads SQLAlchemy mapped_column and Column fields, and not pydantic models", () => {
    const py = [
      "class User(SqlAlchemyBase):", //                                         1
      "    email: Mapped[str | None] = mapped_column(String, unique=True)", //   2
      "    email_count: Mapped[int] = mapped_column(Integer)", //                3
      "    phone = Column(\"phone_no\", String(20))", //                         4
      "", //                                                                    5
      "class UserInfo(BaseModel):", //                                          6
      "    email: str = Field(None)", //                                        7
    ];
    const files = [file("db/models/users.py", "python", py)];
    expect(summary(declaredColumns(files, "email"))).toEqual(["User.email (orm-field)"]);
    expect(summary(declaredColumns(files, "phone_number"))).toEqual(["User.phone_no (orm-field)"]);
  });

  it("reads Drizzle table objects: text columns, with the builder's column name", () => {
    const ts = [
      "export const users = pgTable('users', {", //       1
      "  id: text('id').primaryKey(),", //                 2
      "  email: text('email').unique(),", //               3
      "  phoneNumber: varchar('phone_number'),", //        4
      "  emailVerifiedAt: timestamp('email_verified_at'),", // 5
      "});", //                                            6
    ];
    const files = [file("db/schema/user.ts", "typescript", ts)];
    expect(summary(declaredColumns(files, "email"))).toEqual(["users.email (orm-field)"]);
    expect(summary(declaredColumns(files, "phone_number"))).toEqual(["users.phone_number (orm-field)"]);
  });

  it("reads a configured role word only when it ends the key or the key ends in an address word", () => {
    const config = ["module.exports = { from_city: 'x', fromPackage: 'y', mailFrom: 'a@b', support_address: 'c@d' }"];
    expect(summary(declaredColumns([file("app/config.js", "javascript", config)], "email", { include: "configured" }))).toEqual([
      "config.mailFrom (config)",
      "config.support_address (config)",
    ]);
  });
});

describe("copy columns", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const schemaRb = (path: string) => ({
    path,
    kind: "rails" as const,
    content: [
      'create_table "contact_inboxes" do |t|',
      '  t.string "source_id"',
      'end',
      'create_table "messages" do |t|',
      '  t.string "source_id"',
      '  t.string "message_id"',
      'end',
    ].join("\n"),
  });

  it("admits a storage column written from the concept's value, tied to its model", () => {
    const ruby = [
      "class MailboxHelper", //                                                        1
      "  def create_contact", //                                                       2
      "    ContactInboxWithContactBuilder.new(source_id: sender_email, inbox: @inbox)", // 3
      "    inbox.contact_inboxes.where(source_id: phone_source_id)", //                  4
      "    Message.create(message_id: @incoming_email.message_id)", //                   5
      "    Message.create(source_id: CustomerEvents::EMAIL_SENT)", //                     6
      "  end", //                                                                      7
      "end", //                                                                        8
    ];
    const files = [file("app/mailboxes/mailbox_helper.rb", "ruby", ruby)];
    const email = declaredColumns(files, "email", {}, [schemaRb("db/schema.rb")]);
    expect(summary(email)).toEqual(["contact_inboxes.source_id (copy-write)"]);
    expect(email[0]).toMatchObject({ file: "db/schema.rb", line: 2, writtenFrom: { file: "app/mailboxes/mailbox_helper.rb", line: 3, value: "sender_email" } });
    expect(summary(declaredColumns(files, "phone_number", {}, [schemaRb("db/schema.rb")]))).toEqual(["contact_inboxes.source_id (copy-write)"]);
  });

  it("does not admit a column whose name the concept's value cannot be tied to one table", () => {
    const ruby = ["def f", "  Notifier.call(source_id: sender_email)", "end"];
    expect(declaredColumns([file("app/x.rb", "ruby", ruby)], "email", {}, [schemaRb("db/schema.rb")])).toEqual([]);
  });
});

describe("concept-generic catalog", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("finds phone columns by the signal rules and by type, on any model base", () => {
    const entries = declaredColumns([file("account/models.py", "python", PHONE_PY)], "phone_number");
    // `contact` is catalogued for its PhoneNumberField type; the boolean flag, the form field and
    // the Input class are not columns; `billing_phone` matches the phone rule inside a longer name.
    expect(summary(entries)).toEqual(["Address.billing_phone (orm-field)", "Address.contact (orm-field)", "Address.phone (orm-field)"]);
    expect(entries.find((e) => e.column === "phone")).toMatchObject({ model: "Address", line: 4, type: "PossiblePhoneNumberField" });
  });

  it("keeps the email catalog of the same file free of phone columns", () => {
    expect(declaredColumns([file("account/models.py", "python", PHONE_PY)], "email")).toEqual([]);
  });

  it("parses Medusa DML models, with the define name as the table", () => {
    const entries = declaredColumns([file("customer/models/customer.ts", "typescript", DML_TS)], "phone_number");
    expect(summary(entries)).toEqual(["customer.phone (orm-field)", "stock_location_address.phone (orm-field)"]);
    expect(entries[0]).toMatchObject({ model: "Customer", type: "text", line: 5 });
    expect(entries[1]).toMatchObject({ model: "StockLocationAddress", line: 11 });
    // The same models answer the email concept: `model.text().searchable()` is text.
    expect(summary(declaredColumns([file("customer/models/customer.ts", "typescript", DML_TS)], "email"))).toEqual(["customer.email (orm-field)"]);
  });

  it("uses the concept's role words for configured keys: phone keys must name the phone", () => {
    const entries = declaredColumns([file("shop/settings.py", "python", PHONE_SETTINGS_PY)], "phone_number", { include: "configured" });
    expect(summary(entries)).toEqual([
      "env.SMS_SENDER_PHONE (env)",
      "env.SUPPORT_PHONE (env)",
      "env.TWILIO_PHONE_NUMBER (env)",
      "settings.SMS_SENDER_PHONE (setting)",
      "settings.SUPPORT_PHONE (setting)",
      "settings.TWILIO_PHONE_NUMBER (setting)",
    ]);
    // No email keys, no bare role words such as SENDER_ADDRESS, no flags such as PHONE_VERIFIED.
  });

  it("reads concept profiles from data, with a default for unknown concepts", () => {
    const phone = conceptProfile("phone_number");
    expect(phone.typeHints.has("possiblephonenumberfield")).toBe(true);
    expect(phone.roleWordsSuffice).toBe(false);
    expect(conceptProfile("email").roleWordsSuffice).toBe(true);
    const unknown = conceptProfile("date_of_birth");
    expect([...unknown.typeHints]).toEqual(["dateofbirth", "dateofbirthfield"]);
    expect(unknown.negativeWords.has("enabled")).toBe(true);
    expect(normalizeTypeName("phonenumber_field.modelfields.PhoneNumberField")).toBe("phonenumberfield");
  });
});
