import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { mentionFieldKeys, passedValueDeclarations } from "../../../src/analyze/mention-fields";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
import type { FileInfo, FileLanguage } from "../../../src/core/types/file";

const concept = (token: string): boolean => /email/i.test(token);

function keysOf(language: FileLanguage, path: string, lines: string[], line: number) {
  const pack = packForFile(language, path);
  const analyzed = pack ? analyzeSource(pack, lines.join("\n")) : undefined;
  if (!analyzed) throw new Error("engine did not analyze the source");
  try {
    return mentionFieldKeys(analyzed, line, lines[line - 1], concept);
  } finally {
    analyzed.dispose();
  }
}

function file(path: string, language: FileInfo["language"], lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path, language, content, size: content.length } as FileInfo;
}

const SCHEMA = [
  "module.exports = {", //                         1
  "  members: {", //                               2
  "    id: { type: 'string' },", //                3
  "    email: { type: 'string', unique: true },", // 4
  "  },", //                                       5
  "  donation_payment_events: {", //               6
  "    email: { type: 'string' },", //             7
  "  },", //                                       8
  "};",
];

const DJANGO = [
  "class Order(models.Model):", //                 1
  "    user_email = models.EmailField()", //       2
  "", //                                           3
  "    def get_customer_email(self):", //          4
  "        return self.user_email", //             5
];

describe("mentionFieldKeys", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("owns a schema key by the enclosing table key", () => {
    expect(keysOf("javascript", "schema.js", SCHEMA, 4)).toEqual([{ key: "member.email", definition: true }]);
    expect(keysOf("javascript", "schema.js", SCHEMA, 7)).toEqual([
      { key: "donation_payment_event.email", definition: true },
    ]);
  });

  it("owns a Django field by its class, and self reads by the enclosing class", () => {
    expect(keysOf("python", "models.py", DJANGO, 2)).toEqual([{ key: "order.user_email", definition: true }]);
    expect(keysOf("python", "models.py", DJANGO, 5)).toEqual([{ key: "order.user_email", definition: false }]);
  });

  it("does not own keys of an object built inside a function", () => {
    const lines = ["class MemberRepository {", "  build(member) {", "    return { email: member.email };", "  }", "}"];
    expect(keysOf("javascript", "a.js", lines, 3)).toEqual([{ key: "member.email", definition: false }]);
  });

  it("reads directly off a named object, including .get('email')", () => {
    expect(keysOf("python", "a.py", ["x = original_order.user_email"], 1)).toEqual([
      { key: "order.user_email", definition: false },
    ]);
    expect(keysOf("javascript", "a.js", ["const to = member.get('email');"], 1)).toEqual([
      { key: "member.email", definition: false },
    ]);
    expect(keysOf("javascript", "a.js", ["const to = data.email;"], 1)).toEqual([]);
  });
});

describe("passedValueDeclarations", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  function passed(lines: string[], line: number) {
    const pack = packForFile("python", "a.py");
    const analyzed = pack ? analyzeSource(pack, lines.join("\n")) : undefined;
    if (!analyzed) throw new Error("engine did not analyze the source");
    try {
      return passedValueDeclarations(analyzed, line, concept);
    } finally {
      analyzed.dispose();
    }
  }

  it("links a keyword argument to the variable passed into it", () => {
    const lines = ["def send(recipient_email, payload):", "    log(customer_email=recipient_email)"];
    expect(passed(lines, 2)).toEqual([1]);
  });

  it("does not link variables that are only compared", () => {
    const lines = ["def f(email, old_email):", "    return email != old_email"];
    expect(passed(lines, 2)).toEqual([]);
  });
});

describe("field links in grouping", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("joins plain reads in other files to the field definition", () => {
    const { hits } = buildPersonalDataInventoryFromIngest(
      [
        file("saleor/order/models.py", "python", DJANGO),
        file("saleor/checkout/complete.py", "python", ["def f(order):", "    customer_email = order.user_email"]),
        file("saleor/order/actions.py", "python", ["def g(original_order):", "    return original_order.user_email"]),
      ],
      [],
    );
    const groupOf = (path: string, line: number) =>
      hits.find((hit) => hit.id === "email" && hit.evidence.filePath === path && hit.evidence.startLine === line)?.group;
    // The field, its self read, and a plain read in another file join.
    expect(groupOf("saleor/order/models.py", 5)).toBe(groupOf("saleor/order/models.py", 2));
    expect(groupOf("saleor/order/actions.py", 2)).toBe(groupOf("saleor/order/models.py", 2));
    // A line that names its own data item is a copy into it and stays apart.
    expect(groupOf("saleor/checkout/complete.py", 2)).toBe("email:customer");
  });
});

describe("queried table entities", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("groups mentions in functions that query the same one table", () => {
    const { hits } = buildPersonalDataInventoryFromIngest(
      [
        file("src/auth/local.ts", "typescript", [
          "export async function findByEmail(knex: any, email: string) {",
          "  return knex.select('id').from('directus_users').where({ email }).first();",
          "}",
        ]),
        file("src/cli/passwd.ts", "typescript", [
          "export async function reset(database: any, email: string) {",
          "  await database('directus_users').update({ password: 'x' }).where('email', email);",
          "}",
        ]),
      ],
      [],
    );
    const groups = new Set(hits.filter((hit) => hit.id === "email" && hit.location === "code").map((hit) => hit.group));
    expect([...groups]).toEqual(["email:user"]);
  });
});

describe("getters as fields", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("links this.x reads to a getter named x in the same class", () => {
    const lines = [
      "class StaffEmails {", //                          1
      "  send() {", //                                    2
      "    return { fromEmail: this.fromEmailAddress };", // 3
      "  }", //                                           4
      "  get fromEmailAddress() {", //                     5
      "    return 'x';", //                                6
      "  }", //                                           7
      "}",
    ];
    expect(keysOf("javascript", "a.js", lines, 5)).toEqual([{ key: "staff_email.fromEmailAddress", definition: true }]);
    expect(keysOf("javascript", "a.js", lines, 3)).toContainEqual({ key: "staff_email.fromEmailAddress", definition: false });
  });
});
