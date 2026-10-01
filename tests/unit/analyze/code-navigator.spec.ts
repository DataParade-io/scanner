import { CodeNavigator } from "../../../src/analyze/code-navigator";
import { initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS } from "../../../src/analyze/languages";
import type { FileInfo } from "../../../src/core/types/file";

function file(path: string, language: FileInfo["language"], lines: string[]): FileInfo {
  const content = lines.join("\n");
  return { path, name: path.split("/").pop() as string, language, content, size: content.length };
}

const MODELS_PY = [
  "class Order(Model):", //                                1
  "    user_email = models.EmailField()", //               2
  "", //                                                   3
  "    def get_customer_email(self):", //                  4
  "        return self.user_email", //                     5
  "", //                                                   6
  "class Invoice(Model):", //                              7
  "    def get_customer_email(self):", //                  8
  "        return None", //                                9
];

const NOTIFY_PY = [
  "from .models import Order", //                                              1
  "", //                                                                       2
  "@app.task", //                                                              3
  "def send_email_task(recipient_email, payload):", //                         4
  "    pass", //                                                               5
  "", //                                                                       6
  "def notify(order: Order, invoice, other: Invoice):", //                     7
  "    payload = {", //                                                        8
  '        "recipient_email": order.get_customer_email(),', //                 9
  "    }", //                                                                  10
  "    send_email_task.delay(payload=payload, recipient_email=order.user_email)", // 11
  "    send_email_task('a@b.c', payload)", //                                  12
  "    invoice.get_customer_email()", //                                       13
  "    refresh()", //                                                          14
  "    return payload", //                                                     15
  "    other.get_customer_email()", //                                         16
];

const SERVICE_TS = [
  "export class UsersService {", //                                            1
  "  email: string = '';", //                                                  2
  "  readOne(id: string): string {", //                                        3
  "    return id;", //                                                         4
  "  }", //                                                                    5
  "}", //                                                                      6
  "", //                                                                       7
  "export class MailService {", //                                             8
  "  readOne(id: string): string {", //                                        9
  "    return id;", //                                                         10
  "  }", //                                                                    11
  "}", //                                                                      12
  "", //                                                                       13
  "export function run(): void {", //                                         14
  "  const users = new UsersService();", //                                    15
  "  users.readOne('x');", //                                                  16
  "  const body = { email: 'a@b.c' };", //                                     17
  "  send(body);", //                                                          18
  "}", //                                                                      19
];

describe("code navigator", () => {
  let nav: CodeNavigator;

  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
    nav = new CodeNavigator([
      file("app/models.py", "python", MODELS_PY),
      file("app/notify.py", "python", NOTIFY_PY),
      file("src/service.ts", "typescript", SERVICE_TS),
      file("config.json", "json", ["{}"]),
    ]);
  });

  it("indexes only files with a language pack", () => {
    expect(nav.fileCount).toBe(3);
  });

  it("outlines the enclosing function and class with numbered text", () => {
    const response = nav.handle({ op: "outline", file: "app/models.py", line: 5 }) as any;
    expect(response).toMatchObject({
      ok: true,
      function: { name: "get_customer_email", startLine: 4, endLine: 5 },
      class: { name: "Order", startLine: 1, endLine: 5 },
      truncated: false,
    });
    expect(response.code).toBe("4:     def get_customer_email(self):\n5:         return self.user_email");
  });

  it("caps outline text at 60 lines and reports it", () => {
    const body = Array.from({ length: 80 }, (_, i) => `    x${i} = ${i}`);
    const big = new CodeNavigator([file("big.py", "python", ["def big():", ...body])]);
    const response = big.handle({ op: "outline", file: "big.py", line: 2 }) as any;
    expect(response.code.split("\n")).toHaveLength(60);
    expect(response.truncated).toBe(true);
  });

  it("lists references, calls, members and definitions on a line", () => {
    const response = nav.handle({ op: "symbols", file: "app/notify.py", line: 9 }) as any;
    expect(response.references).toEqual([
      expect.objectContaining({ name: "order", declaration: { line: 7, kind: "parameter" } }),
    ]);
    expect(response.calls).toEqual([expect.objectContaining({ callee: "get_customer_email", receiverClass: "Order" })]);
    expect(response.members).toEqual([expect.objectContaining({ name: "get_customer_email", receiverClass: "Order" })]);
    expect(response.definitions).toEqual([expect.objectContaining({ name: "recipient_email", kind: "key" })]);
  });

  it("reports field definitions with their class", () => {
    const response = nav.handle({ op: "symbols", file: "app/models.py", line: 2 }) as any;
    expect(response.definitions).toEqual([expect.objectContaining({ name: "user_email", kind: "field", owner: "Order" })]);
  });

  describe("definition", () => {
    it("narrows a method to the receiver's class when the engine knows it", () => {
      const response = nav.handle({ op: "definition", file: "app/notify.py", line: 9, name: "get_customer_email" }) as any;
      expect(response.receiverClass).toBe("Order");
      expect(response.narrowedToReceiver).toBe(true);
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({ file: "app/models.py", line: 4, kind: "method", owner: "Order", scope: "repo" });
      expect(response.results[0].code).toContain("4:     def get_customer_email(self):");
    });

    it("lists every method of the name when the receiver is untyped", () => {
      const response = nav.handle({ op: "definition", file: "app/notify.py", line: 13, name: "get_customer_email" }) as any;
      expect(response.narrowedToReceiver).toBeUndefined();
      expect(response.results.map((r: any) => `${r.file}:${r.line}`).sort()).toEqual(["app/models.py:4", "app/models.py:8"]);
    });

    it("resolves a parameter in the same file and stops there", () => {
      const response = nav.handle({ op: "definition", file: "app/notify.py", line: 9, name: "order" }) as any;
      expect(response.results).toEqual([expect.objectContaining({ file: "app/notify.py", line: 7, kind: "parameter", scope: "file" })]);
    });

    it("finds classes and fields repo-wide", () => {
      const classes = nav.handle({ op: "definition", file: "app/notify.py", line: 7, name: "Order" }) as any;
      expect(classes.results.map((r: any) => r.kind)).toContain("class");
      const fields = nav.handle({ op: "definition", file: "app/notify.py", line: 11, name: "user_email" }) as any;
      expect(fields.results).toEqual([expect.objectContaining({ file: "app/models.py", line: 2, kind: "field", owner: "Order" })]);
    });

    it("narrows a TypeScript method to the typed receiver's class", () => {
      const response = nav.handle({ op: "definition", file: "src/service.ts", line: 16, name: "readOne" }) as any;
      expect(response.receiverClass).toBe("UsersService");
      expect(response.results).toEqual([expect.objectContaining({ file: "src/service.ts", line: 3, kind: "method", owner: "UsersService" })]);
    });
  });

  describe("callers", () => {
    it("finds deferred, keyword and zero-argument calls", () => {
      const response = nav.handle({ op: "callers", name: "send_email_task" }) as any;
      expect(response.total).toBe(2);
      const deferred = response.callers.find((c: any) => c.line === 11);
      expect(deferred).toMatchObject({ file: "app/notify.py", caller: "notify", deferred: true });
      expect(deferred.arguments).toEqual([
        { position: 0, keyword: "payload", text: "payload" },
        { position: 1, keyword: "recipient_email", text: "order.user_email" },
      ]);
      expect(deferred.code).toContain("11:     send_email_task.delay(");
      const zero = nav.handle({ op: "callers", name: "refresh" }) as any;
      expect(zero.callers).toEqual([expect.objectContaining({ line: 14, arguments: [] })]);
    });

    it("resolves the name from the enclosing function and drops other classes' receivers", () => {
      const response = nav.handle({ op: "callers", file: "app/models.py", line: 5 }) as any;
      expect(response.name).toBe("get_customer_email");
      expect(response.ownerClass).toBe("Order");
      // Line 13 has an untyped receiver and stays; line 16 is known to be an Invoice and goes.
      expect(response.callers.map((c: any) => c.line)).toEqual([9, 13]);
    });

    it("finds TypeScript method calls with their receiver class", () => {
      const response = nav.handle({ op: "callers", name: "readOne" }) as any;
      expect(response.callers).toEqual([expect.objectContaining({ file: "src/service.ts", line: 16, receiverClass: "UsersService", caller: "run" })]);
    });

    it("finds constructions", () => {
      const response = nav.handle({ op: "callers", name: "UsersService" }) as any;
      expect(response.callers).toEqual([expect.objectContaining({ line: 15, arguments: [] })]);
    });
  });

  describe("writers", () => {
    it("finds keys, keyword arguments and fields by name", () => {
      const response = nav.handle({ op: "writers", name: "recipient_email" }) as any;
      expect(response.writers.map((w: any) => `${w.file}:${w.line}:${w.kind}`)).toEqual([
        "app/notify.py:9:key",
        "app/notify.py:11:key",
      ]);
      expect(response.writers[0].code).toContain('9:         "recipient_email": order.get_customer_email(),');
      const fields = nav.handle({ op: "writers", name: "user_email" }) as any;
      expect(fields.writers).toEqual([expect.objectContaining({ file: "app/models.py", line: 2, kind: "field", owner: "Order" })]);
      const ts = nav.handle({ op: "writers", name: "email" }) as any;
      expect(ts.writers.map((w: any) => `${w.line}:${w.kind}`)).toEqual(["2:field", "17:key"]);
    });

    it("ranks the hinted file first", () => {
      const response = nav.handle({ op: "writers", name: "email", file: "src/service.ts" }) as any;
      expect(response.writers[0].file).toBe("src/service.ts");
    });
  });

  it("caps results and reports truncation", () => {
    const response = nav.handle({ op: "writers", name: "recipient_email", limit: 1 }) as any;
    expect(response.writers).toHaveLength(1);
    expect(response.total).toBe(2);
    expect(response.truncated).toBe(true);
  });

  it("answers bad requests with an error and echoes the id", () => {
    expect(nav.handle({ op: "nope", id: 7 })).toEqual({ ok: false, error: "unknown op: nope", id: 7 });
    expect(nav.handle({ op: "outline", file: "missing.py", line: 1 })).toMatchObject({ ok: false });
    expect(nav.handle({ op: "writers" })).toMatchObject({ ok: false });
    expect(nav.handle({ op: "callers", file: "app/models.py", line: 1 })).toMatchObject({ ok: false });
  });
});
