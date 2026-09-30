import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { mentionReceiver, mentionReceiverClass } from "../../../src/analyze/mention-receiver";
import type { FileInfo, FileLanguage } from "../../../src/core/types/file";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";

const concept = (token: string): boolean => /email/i.test(token);

function analyze<T>(language: FileLanguage, path: string, lines: string[], use: (file: import("../../../src/analyze/engine/analyzed-file").AnalyzedFile) => T): T {
  const pack = packForFile(language, path);
  const analyzed = pack ? analyzeSource(pack, lines.join("\n")) : undefined;
  if (!analyzed) throw new Error("engine did not analyze the source");
  try {
    return use(analyzed);
  } finally {
    analyzed.dispose();
  }
}

const receiver = (language: FileLanguage, path: string, lines: string[], line: number) =>
  analyze(language, path, lines, (file) => mentionReceiverClass(file, line, concept));

describe("class of a receiver (TypeScript)", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const SERVICE = [
    "class AuthService {", //                                              1
    "  usersService: UsersService;", //                                    2
    "  constructor(private members: MemberRepository, knex) {", //         3
    "    this.usersService = new UsersService({ knex });", //              4
    "  }", //                                                              5
    "  async run(user: User, email: string) {", //                         6
    "    const usersService = new UsersService({ schema, knex });", //     7
    "    await usersService.createOne({ email, role });", //               8
    "    await usersService.updateOne(id, { email });", //                 9
    "    await this.usersService.getUserByEmail(email);", //              10
    "    await this.members.getByEmail(email);", //                       11
    "    return user.email;", //                                          12
    "    return models.User.getByEmail(email);", //                       13
    "    return other.email;", //                                         14
    "    return plain(email);", //                                        15
    "  }", //                                                              16
    "}",
  ];

  it.each([
    [8, "UsersService"],
    [9, "UsersService"],
    [10, "UsersService"],
    [11, "MemberRepository"],
    [12, "User"],
    [13, "User"],
    [14, undefined],
    [15, undefined],
  ])("line %i", (line, expected) => {
    expect(receiver("typescript", "a.ts", SERVICE, line)).toBe(expected);
  });

  it("resolves a field assigned from a typed parameter, and names bindings", () => {
    const lines = [
      "class A {",
      "  constructor(users: UsersService) { this.users = users; }",
      "  f(email) { return this.users.find(email); }",
      "}",
    ];
    expect(receiver("typescript", "a.ts", lines, 3)).toBe("UsersService");
    analyze("typescript", "a.ts", lines, (file) => {
      expect(file.classOfName("users", 2, 15)).toBe("UsersService");
      expect(file.classOfName("users", 3, 12, true)).toBe("UsersService");
    });
  });
});

describe("class of a receiver (Python)", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const CODE = [
    "class Handler:", //                                                   1
    "    def __init__(self):", //                                         2
    "        self.repo = OrderRepository()", //                           3
    "    def run(self, user: 'User', order: Order, email):", //           4
    "        x = User.objects.filter(email=email).first()", //            5
    "        self.repo.save(email=email)", //                             6
    "        y = user.email", //                                          7
    "        z = order.user_email", //                                    8
    "        svc = CustomerService()", //                                 9
    "        svc.notify(email)", //                                      10
    "        return nobody.email", //                                    11
  ];

  it.each([
    [5, "User"],
    [6, "OrderRepository"],
    [7, "User"],
    [8, "Order"],
    [10, "CustomerService"],
    [11, undefined],
  ])("line %i", (line, expected) => {
    expect(receiver("python", "a.py", CODE, line)).toBe(expected);
  });
});

const full = (language: FileLanguage, path: string, lines: string[], line: number) =>
  analyze(language, path, lines, (file) => {
    const { via, ...rest } = mentionReceiver(file, line, concept);
    return { ...rest, ...(via ? { via } : {}) };
  });

describe("factory-typed bindings and payload objects (TypeScript)", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const DRIVER = [
    "class LocalDriver {", //                                                               1
    "  getUsersService(schema: SchemaOverview): UsersService {", //                          2
    "    return new UsersService({ schema });", //                                          3
    "  }", //                                                                               4
    "  async load(): Promise<AccountService> { return x; }", //                              5
    "  async register(schema, info) {", //                                                  6
    "    const usersService = this.getUsersService(schema);", //                            7
    "    const userPayload = {", //                                                          8
    "      provider: 'x',", //                                                              9
    "      email: info.email,", //                                                         10
    "    };", //                                                                            11
    "    const updated = await emitter.emitFilter('auth.update', userPayload, ctx);", //    12
    "    await usersService.createOne(updated);", //                                       13
    "    await usersService.createOne({ ...userPayload });", //                            14
    "    const svc = await this.load();", //                                               15
    "    svc.notify(info.email);", //                                                      16
    "    const other = { email: info.email };", //                                         17
    "    log.info(other);", //                                                             18
    "    const orphan = { email: info.email };", //                                        19
    "    orphan.keep = 1;", //                                                             20
    "    const nested = { user: { email: info.email } };", //                              21
    "    await usersService.updateOne(1, nested);", //                                     22
    "  }", //                                                                               23
    "  other(payload) {", //                                                               24
    "    const p = { email: 1 };", //                                                      25
    "  }", //                                                                               26
    "}",
  ];

  it("resolves a binding from the declared return type of a method in the class", () => {
    const lines = ["class A {", "  f(schema, email) {", "    const s = this.svc(schema);", "    s.find(email);", "  }", "  svc(x): UsersService { return y; }", "}"];
    expect(receiver("typescript", "a.ts", lines, 4)).toBe("UsersService");
  });

  it("unwraps Promise and awaits", () => {
    expect(receiver("typescript", "a.ts", DRIVER, 16)).toBe("AccountService");
  });

  it("gives a payload key the class of the receiver it is passed to, through two hops", () => {
    expect(full("typescript", "a.ts", DRIVER, 10)).toEqual({ className: "UsersService", names: [], via: "payload" });
  });

  it("follows nested payload keys", () => {
    expect(full("typescript", "a.ts", DRIVER, 21)).toEqual({ className: "UsersService", names: [], via: "payload" });
  });

  it("does not cross functions or count untyped, unmatched receivers", () => {
    expect(receiver("typescript", "a.ts", DRIVER, 25)).toBeUndefined();
    expect(receiver("typescript", "a.ts", DRIVER, 19)).toBeUndefined();
    expect(full("typescript", "a.ts", DRIVER, 17)).toEqual({ names: ["info", "log"], via: "direct" });
  });

  it("stops after two derivations", () => {
    const lines = [
      "function f(svc: UsersService, info) {",
      "  const a = { email: info.email };",
      "  const b = wrap(a);",
      "  const c = wrap(b);",
      "  const d = wrap(c);",
      "  svc.create(d);",
      "}",
    ];
    expect(receiver("typescript", "a.ts", lines, 2)).toBeUndefined();
    expect(receiver("typescript", "a.ts", [...lines.slice(0, 4), "  svc.create(c);", "}"], 2)).toBe("UsersService");
  });

  it("reports the binding name of an untyped receiver for repository lookup", () => {
    const lines = ["function f(usersService, email) {", "  usersService.find(email);", "}"];
    expect(full("typescript", "a.ts", lines, 2)).toEqual({ names: ["usersService"], via: "direct" });
  });
});

describe("factory-typed bindings and payload objects (Python)", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const CODE = [
    "class Driver:", //                                                     1
    "    def get_users(self, schema) -> UsersService:", //                  2
    "        return UsersService(schema)", //                               3
    "    def register(self, schema, info):", //                             4
    "        users = self.get_users(schema)", //                            5
    "        users.notify(info.email)", //                                  6
    "        payload = {'email': info.email, 'name': 'x'}", //              7
    "        merged = merge(payload, extra)", //                            8
    "        users.create_one(merged)", //                                  9
  ];

  it("resolves the return annotation of a method", () => {
    expect(receiver("python", "a.py", CODE, 6)).toBe("UsersService");
  });

  it("follows a dict payload passed by variable", () => {
    expect(full("python", "a.py", CODE, 7)).toEqual({ className: "UsersService", names: [], via: "payload" });
  });
});

describe("receiver entity in the inventory", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const file = (path: string, lines: string[]): FileInfo => {
    const content = lines.join("\n");
    return { path, language: "typescript", content, size: content.length } as FileInfo;
  };

  it("matches an untyped receiver's name to a class defined anywhere in the repository", () => {
    const inventory = buildPersonalDataInventoryFromIngest(
      [
        file("src/users.ts", ["export class UsersService { email: string; }", "export class Emitter {}"]),
        file("src/auth.ts", [
          "export function register(usersService, other, payload) {",
          "  usersService.createOne({ email: payload.email });", //   2
          "  other.createOne({ email: payload.email });", //          3
          "  const body = { email: payload.email };", //             4
          "  usersService.updateOne(1, body);", //                    5
          "}",
        ]),
      ],
      [],
    );
    const entity = (line: number) =>
      inventory.hits.find((hit) => hit.id === "email" && hit.evidence.filePath === "src/auth.ts" && hit.evidence.endLine === line)
        ?.receiverEntity;
    expect(entity(2)).toBe("user");
    expect(entity(3)).toBeUndefined();
    expect(entity(4)).toBe("user");
  });
});
