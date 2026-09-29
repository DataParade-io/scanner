import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import type { AnalyzedFile } from "../../../src/analyze/engine/analyzed-file";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { resolveMentionDeclaration } from "../../../src/analyze/mention-declaration";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
import type { FileInfo, FileLanguage } from "../../../src/core/types/file";

const concept = (token: string): boolean => /email|recipient/i.test(token);

function parse(language: FileLanguage, path: string, lines: string[]): AnalyzedFile {
  const pack = packForFile(language, path);
  const analyzed = pack ? analyzeSource(pack, lines.join("\n")) : undefined;
  if (!analyzed) throw new Error("engine did not analyze the source");
  return analyzed;
}

const JS = [
  "class Account {", //                              1
  "  email = null;", //                              2 field
  "  get address() {", //                            3 getter
  "    return this.email;", //                       4
  "  }",
  "  send(recipient) {", //                          6 parameter
  "    const to = recipient;", //                    7 local
  "    return to;", //                               8
  "  }",
  "}",
  "function sendWelcomeEmail(email, mailAPI) {}", //  11 parameter outranks the function name
  "const payload = { recipientEmail: user.email };", // 12 key
  "const orderEmail = order.email;", //               13 local named for the concept
  "const { email: legacy } = req.body;", //           14
];

describe("engine declarations, JavaScript", () => {
  let file: AnalyzedFile;
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
    file = parse("javascript", "a.js", JS);
  });
  afterAll(() => file.dispose());

  it("finds each kind of same-file declaration", () => {
    expect(file.declarationOf("email", 4)).toBeUndefined();
    expect(file.declarationOf("recipient", 7, 20)).toEqual({ line: 6, kind: "parameter" });
    expect(file.declarationOf("to", 8, 11)).toEqual({ line: 7, kind: "local" });
    expect(file.declarationOf("sendWelcomeEmail", 12, 0)).toEqual({ line: 11, kind: "function" });
    expect(file.declarationOf("Account", 12, 0)).toEqual({ line: 1, kind: "class" });
  });

  it("answers syntax kind and enclosing ranges", () => {
    expect(file.syntaxKindAt(7, 10)).toBe("identifier");
    expect(file.enclosingFunction(7, 10)).toEqual({ name: "send", startLine: 6, endLine: 9 });
    expect(file.enclosingClass(7, 10)).toEqual({ name: "Account", startLine: 1, endLine: 10 });
  });

  it("resolves a class field read through this", () => {
    expect(resolveMentionDeclaration(file, 4, concept)).toEqual({ line: 2, kind: "field" });
  });

  it("declares a class field on its own line", () => {
    expect(resolveMentionDeclaration(file, 2, concept)).toEqual({ line: 2, kind: "field" });
  });

  it("declares a getter by itself as a function when it is the only occurrence", () => {
    expect(resolveMentionDeclaration(file, 3, (t) => t === "address")).toEqual({ line: 3, kind: "function" });
  });

  it("lets a parameter outrank the function name", () => {
    expect(resolveMentionDeclaration(file, 11, concept)).toEqual({ line: 11, kind: "parameter" });
  });

  it("declares an object key on its own line", () => {
    expect(resolveMentionDeclaration(file, 12, concept)).toEqual({ line: 12, kind: "field" });
  });

  it("declares a local named for the concept on its own line", () => {
    expect(resolveMentionDeclaration(file, 13, concept)).toEqual({ line: 13, kind: "local" });
  });

  it("follows a member read to the base declaration, and marks unknown bases unresolved", () => {
    const local = parse("javascript", "b.js", ["function f(member) {", "  return member.email;", "}", "audit(other.email);"]);
    expect(resolveMentionDeclaration(local, 2, concept)).toEqual({ line: 1, kind: "parameter" });
    expect(resolveMentionDeclaration(local, 4, concept)).toBe("unresolved");
    local.dispose();
  });

  it("prefers the value passed over the callee name", () => {
    const call = parse("javascript", "c.js", ["function f(email) {", "  return validator.isEmail(email);", "}"]);
    expect(resolveMentionDeclaration(call, 2, concept)).toEqual({ line: 1, kind: "parameter" });
    call.dispose();
  });

  it("still resolves the parts that parse when the file has a syntax error", () => {
    const broken = parse("javascript", "d.js", [
      "function ok(email) { return email; }",
      "const early = 1;",
      "function broken( { const x = ; ",
    ]);
    expect(broken.hasSyntaxError).toBe(true);
    expect(resolveMentionDeclaration(broken, 1, concept)).toEqual({ line: 1, kind: "parameter" });
    expect(broken.declarationOf("early", 1)).toEqual({ line: 2, kind: "local" });
    broken.dispose();
  });
});

describe("engine declarations, TypeScript", () => {
  let file: AnalyzedFile;
  const TS = [
    "interface Payload {", //                                 1
    "  email: string;", //                                    2 key
    "}",
    "class Mailer {", //                                      4
    "  private defaultFrom: string;", //                      5 field
    "  constructor(private readonly emailPrefix: string) {}", // 6 parameter property
    "  send(payload: Payload, recipient?: string): void {", // 7
    "    const target = recipient ?? this.defaultFrom;", //   8
    "  }",
    "}",
  ];
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
    file = parse("typescript", "a.ts", TS);
  });
  afterAll(() => file.dispose());

  it("finds typed parameters, locals, and fields", () => {
    expect(file.declarationOf("recipient", 8, 20)).toEqual({ line: 7, kind: "parameter" });
    expect(file.declarationOf("target", 9, 0)).toEqual({ line: 8, kind: "local" });
    expect(resolveMentionDeclaration(file, 2, concept)).toEqual({ line: 2, kind: "field" });
    expect(resolveMentionDeclaration(file, 8, concept)).toEqual({ line: 7, kind: "parameter" });
  });

  it("resolves this.x to a class field and a constructor parameter property", () => {
    expect(resolveMentionDeclaration(file, 8, (t) => t === "defaultFrom")).toEqual({ line: 5, kind: "field" });
    const prop = parse("typescript", "b.ts", ["class A {", "  constructor(private email: string) {}", "  m() { return this.email; }", "}"]);
    expect(resolveMentionDeclaration(prop, 3, concept)).toEqual({ line: 2, kind: "field" });
    prop.dispose();
  });

  it("parses TSX", () => {
    const tsx = parse("typescript", "a.tsx", ["export const Row = ({ email }: Props) => <td>{email}</td>;"]);
    expect(resolveMentionDeclaration(tsx, 1, concept)).toEqual({ line: 1, kind: "parameter" });
    tsx.dispose();
  });

  it("resolves the parts that parse when the file has a syntax error", () => {
    const broken = parse("typescript", "c.ts", [
      "function ok(email: string) { return email; }",
      "class Broken { send( { ",
      "const later: number = 1;",
    ]);
    expect(broken.hasSyntaxError).toBe(true);
    expect(resolveMentionDeclaration(broken, 1, concept)).toEqual({ line: 1, kind: "parameter" });
    broken.dispose();
  });
});

const PY = [
  "class Account(models.Model):", //                       1
  "    email = models.EmailField()", //                     2 field
  "    def notify(self, recipient):", //                    3 parameter
  "        to = recipient", //                              4 local
  "        return self.email", //                           5
  "    def send_email_confirmation(self):", //              6 function
  "        self.backup_email = None", //                    7 field assigned in a method
  "        return self.backup_email", //                    8
  "def build(user):", //                                    9
  '    return {"recipient_email": user.email}', //          10 dict key
  "    send(recipient_list=[user.email])", //               11 keyword argument
];

describe("engine declarations, Python", () => {
  let file: AnalyzedFile;
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
    file = parse("python", "a.py", PY);
  });
  afterAll(() => file.dispose());

  it("finds each kind of same-file declaration", () => {
    expect(file.declarationOf("recipient", 4, 13)).toEqual({ line: 3, kind: "parameter" });
    expect(file.declarationOf("to", 5, 0)).toEqual({ line: 4, kind: "local" });
    expect(file.declarationOf("build", 10, 0)).toEqual({ line: 9, kind: "function" });
    expect(file.declarationOf("Account", 10, 0)).toEqual({ line: 1, kind: "class" });
  });

  it("answers syntax kind and enclosing ranges", () => {
    expect(file.syntaxKindAt(4, 13)).toBe("identifier");
    expect(file.enclosingFunction(4, 10)).toEqual({ name: "notify", startLine: 3, endLine: 5 });
    expect(file.enclosingClass(4, 10)).toEqual({ name: "Account", startLine: 1, endLine: 8 });
  });

  it("declares a model field on its own line and resolves self.email to it", () => {
    expect(resolveMentionDeclaration(file, 2, concept)).toEqual({ line: 2, kind: "field" });
    expect(resolveMentionDeclaration(file, 5, concept)).toEqual({ line: 2, kind: "field" });
  });

  it("takes the first self assignment as the field declaration", () => {
    expect(resolveMentionDeclaration(file, 8, (t) => t === "backup_email")).toEqual({ line: 7, kind: "field" });
  });

  it("declares a parameter and a function by itself", () => {
    expect(resolveMentionDeclaration(file, 3, concept)).toEqual({ line: 3, kind: "parameter" });
    expect(resolveMentionDeclaration(file, 6, concept)).toEqual({ line: 6, kind: "function" });
  });

  it("declares dict keys and keyword arguments on their own line", () => {
    expect(resolveMentionDeclaration(file, 10, concept)).toEqual({ line: 10, kind: "field" });
    expect(resolveMentionDeclaration(file, 11, concept)).toEqual({ line: 11, kind: "field" });
  });

  it("reads a subscript or get() through to the base", () => {
    const f = parse("python", "b.py", ["def f(request):", "    a = request.POST['email']", "    b = request.get('email')"]);
    expect(resolveMentionDeclaration(f, 2, concept)).toEqual({ line: 1, kind: "parameter" });
    expect(resolveMentionDeclaration(f, 3, concept)).toEqual({ line: 1, kind: "parameter" });
    f.dispose();
  });

  it("marks imported names unresolved", () => {
    const f = parse("python", "c.py", ["from lib import email_client", "def f():", "    return email_client"]);
    expect(resolveMentionDeclaration(f, 3, concept)).toBe("unresolved");
    f.dispose();
  });

  it("resolves the parts that parse when the file has a syntax error", () => {
    const broken = parse("python", "d.py", [
      "def ok(email):",
      "    return email",
      "def broken(:",
      "    x = = 1",
      "def later(recipient):",
      "    return recipient",
    ]);
    expect(broken.hasSyntaxError).toBe(true);
    expect(resolveMentionDeclaration(broken, 2, concept)).toEqual({ line: 1, kind: "parameter" });
    broken.dispose();
  });
});

describe("mention hits carry declarations", () => {
  function file(path: string, language: FileInfo["language"], content: string): FileInfo {
    return { path, language, content, size: content.length } as FileInfo;
  }

  it("attaches a declaration to code hits once the engine is initialized", async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
    const source = ["function f(user) {", "  return user.email;", "}", "// user.email in a comment"].join("\n");
    const { hits } = buildPersonalDataInventoryFromIngest([file("src/a.js", "javascript", source)], []);
    const code = hits.find((hit) => hit.location === "code" && hit.evidence.startLine === 2);
    expect(code?.declaration).toEqual({ line: 1, kind: "parameter" });
    const comment = hits.find((hit) => hit.location === "comment");
    expect(comment?.declaration).toBeUndefined();
  });

  it("leaves languages without a pack alone", () => {
    const { hits } = buildPersonalDataInventoryFromIngest([file("a.go", "go", "email := user.Email\n")], []);
    expect(hits.every((hit) => hit.declaration === undefined)).toBe(true);
  });
});
