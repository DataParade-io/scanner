import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import type { AnalyzedFile } from "../../../src/analyze/engine/analyzed-file";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { conceptCallArguments, conceptFunctions } from "../../../src/analyze/call-links";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
import type { FileInfo, FileLanguage } from "../../../src/core/types/file";

const concept = (token: string): boolean => /email/i.test(token);

function parse(language: FileLanguage, path: string, lines: string[]): AnalyzedFile {
  const pack = packForFile(language, path);
  const analyzed = pack ? analyzeSource(pack, lines.join("\n")) : undefined;
  if (!analyzed) throw new Error("engine did not analyze the source");
  return analyzed;
}

function file(path: string, language: FileInfo["language"], lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path, language, content, size: content.length } as FileInfo;
}

const JS = [
  "function sendWelcomeEmail(email, mailAPI) {}", //          1
  "class Mailer {", //                                        2
  "  deliver(mailAPI, toEmail) {}", //                        3
  "}", //                                                     4
  "const notify = (address, emailBody) => {};", //            5
  "sendWelcomeEmail(user.email, mailAPI);", //                6
  "models.User.getByEmail(email);", //                        7
  "sendWelcomeEmail(wrap(user.email), mailAPI);", //          8
  "mailer.deliver(api, order.getCustomerEmail());", //        9
  "sendWelcomeEmail(name, mailAPI);", //                      10
]; 

const PY = [
  "def send_order_email_task(order_id, recipient_email=None):", // 1
  "    pass", //                                                  2
  "", //                                                          3
  "class Mailer:", //                                             4
  "    def deliver(self, api, to_email):", //                     5
  "        pass", //                                              6
  "", //                                                          7
  "send_order_email_task(recipient_email=order.get_customer_email(), order_id=1)", // 8
  "send_order_email_task(1, email)", //                           9
  "mailer.deliver(api, user_email)", //                           10
];

describe("engine call sites and function definitions", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("lists JavaScript definitions with parameter positions", () => {
    const analyzed = parse("javascript", "a.js", JS);
    try {
      const defs = analyzed.functionDefinitions();
      expect(defs.find((d) => d.name === "sendWelcomeEmail")?.parameters).toEqual([
        { name: "email", position: 0, line: 1 },
        { name: "mailAPI", position: 1, line: 1 },
      ]);
      expect(defs.find((d) => d.name === "deliver")?.parameters.map((p) => [p.name, p.position])).toEqual([
        ["mailAPI", 0],
        ["toEmail", 1],
      ]);
      expect(defs.find((d) => d.name === "notify")?.parameters.map((p) => p.name)).toEqual(["address", "emailBody"]);
      expect(conceptFunctions(defs, concept).map((d) => d.name)).toEqual(["sendWelcomeEmail", "deliver", "notify"]);
    } finally {
      analyzed.dispose();
    }
  });

  it("reports positional call sites by the callee's final name", () => {
    const analyzed = parse("javascript", "a.js", JS);
    try {
      expect(analyzed.callSitesOnLine(6).map((c) => [c.callee, c.position, c.keyword])).toEqual([
        ["sendWelcomeEmail", 0, undefined],
        ["sendWelcomeEmail", 1, undefined],
      ]);
      expect(analyzed.callSitesOnLine(7).map((c) => [c.callee, c.position])).toEqual([["getByEmail", 0]]);
      expect(conceptCallArguments(analyzed, 6, concept)).toEqual([{ callee: "sendWelcomeEmail", position: 0 }]);
      expect(conceptCallArguments(analyzed, 9, concept)).toEqual([{ callee: "deliver", position: 1 }]);
      // a concept inside a nested call's arguments belongs to that call, not the outer one
      expect(conceptCallArguments(analyzed, 8, concept)).toEqual([{ callee: "wrap", position: 0 }]);
      expect(conceptCallArguments(analyzed, 10, concept)).toEqual([]);
    } finally {
      analyzed.dispose();
    }
  });

  it("reads Python keyword arguments and skips self when counting positions", () => {
    const analyzed = parse("python", "a.py", PY);
    try {
      const defs = analyzed.functionDefinitions();
      expect(defs.find((d) => d.name === "deliver")?.parameters).toEqual([
        { name: "api", position: 0, line: 5 },
        { name: "to_email", position: 1, line: 5 },
      ]);
      expect(defs.find((d) => d.name === "send_order_email_task")?.parameters.map((p) => p.name)).toEqual([
        "order_id",
        "recipient_email",
      ]);
      expect(analyzed.callSitesOnLine(8).map((c) => [c.callee, c.position, c.keyword])).toEqual([
        ["send_order_email_task", 0, "recipient_email"],
        ["send_order_email_task", 1, "order_id"],
      ]);
      expect(conceptCallArguments(analyzed, 8, concept)).toEqual([
        { callee: "send_order_email_task", position: 0, keyword: "recipient_email" },
      ]);
      expect(conceptCallArguments(analyzed, 9, concept)).toEqual([{ callee: "send_order_email_task", position: 1 }]);
      expect(conceptCallArguments(analyzed, 10, concept)).toEqual([{ callee: "deliver", position: 1 }]);
    } finally {
      analyzed.dispose();
    }
  });
});

describe("cross-file call links in the inventory", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const groupOf = (files: FileInfo[], path: string, line: number): string | undefined =>
    buildPersonalDataInventoryFromIngest(files, []).hits.find(
      (hit) => hit.id === "email" && hit.evidence.filePath === path && hit.evidence.endLine === line,
    )?.group;

  it("joins an argument to the parameter of a uniquely named function in another file", () => {
    const files = [
      file("lib/mail.js", "javascript", ["function dispatch(email, api) {}"]),
      file("app/a.js", "javascript", ["const memberEmail = load();", "dispatch(memberEmail, api);"]),
    ];
    expect(groupOf(files, "lib/mail.js", 1)).toBe("email:member");
    expect(groupOf(files, "app/a.js", 2)).toBe("email:member");
  });

  it("skips ambiguous callee names", () => {
    const files = [
      file("lib/a.js", "javascript", ["function dispatch(email, api) {}"]),
      file("lib/b.js", "javascript", ["function dispatch(email, api) {}"]),
      file("app/a.js", "javascript", ["dispatch(memberEmail, api);"]),
    ];
    expect(groupOf(files, "lib/a.js", 1)).not.toBe(groupOf(files, "app/a.js", 1));
  });
});
