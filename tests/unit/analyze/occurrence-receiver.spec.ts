import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { occurrenceReceiver, occurrenceReceiverClass } from "../../../src/analyze/occurrence-receiver";
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
  analyze(language, path, lines, (file) => occurrenceReceiverClass(file, line, concept));

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
    const { via, ...rest } = occurrenceReceiver(file, line, concept);
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

describe("ORM static factory typing", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  const classOf = (language: FileLanguage, path: string, lines: string[], name: string, line: number, known: string[] = []) =>
    analyze(language, path, lines, (file) => {
      file.setKnownClass((className) => known.includes(className));
      return file.classOfName(name, line, 20);
    });

  it("types a binding assigned from a models chain (TypeScript)", () => {
    const lines = [
      "class A {",
      "  async f(id) {",
      "    const owner = await this.models.User.getOwnerUser();",
      "    const user = await models.User.findOne({ id });",
      "    const reporter = await this.models.Member.findOne({ id });",
      "    return owner.get('email');",
      "  }",
      "}",
    ];
    expect(classOf("typescript", "a.ts", lines, "owner", 6)).toBe("User");
    expect(classOf("typescript", "a.ts", lines, "user", 6)).toBe("User");
    expect(classOf("typescript", "a.ts", lines, "reporter", 6)).toBe("Member");
    expect(receiver("typescript", "a.ts", lines, 6)).toBe("User");
  });

  it("types a class known to the repository, but not an unknown one or an arbitrary callee", () => {
    const lines = [
      "async function f(id) {",
      "  const members = await Member.findAll({ id });",
      "  const other = await Thing.findAll({ id });",
      "  const made = await helpers.build(id);",
      "  const local = await Local.find(id);",
      "  return [members, other, made, local];",
      "}",
      "class Local {}",
    ];
    expect(classOf("typescript", "a.ts", lines, "members", 6)).toBeUndefined();
    expect(classOf("typescript", "a.ts", lines, "members", 6, ["Member"])).toBe("Member");
    expect(classOf("typescript", "a.ts", lines, "other", 6, ["Member"])).toBeUndefined();
    expect(classOf("typescript", "a.ts", lines, "made", 6, ["Member"])).toBeUndefined();
    expect(classOf("typescript", "a.ts", lines, "local", 6)).toBe("Local");
  });

  it("types a binding from the objects manager (Python)", () => {
    const lines = [
      "def f(pk):",
      "    user = User.objects.get(pk=pk)",
      "    other = Thing.objects.get(pk=pk)",
      "    plain = helpers.load(pk)",
      "    return user.email, other, plain",
    ];
    expect(classOf("python", "a.py", lines, "user", 5, ["User"])).toBe("User");
    expect(classOf("python", "a.py", lines, "other", 5, ["User"])).toBeUndefined();
    expect(classOf("python", "a.py", lines, "plain", 5, ["User"])).toBeUndefined();
  });
});

describe("reference fields", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("types a ForeignKey field by its target model", () => {
    const pack = packForFile("python", "models.py")!;
    const lines = [
      "class Checkout(models.Model):", //                                 1
      "    user = models.ForeignKey(User, on_delete=models.CASCADE)", //   2
      '    owner = models.ForeignKey("account.User", null=True)', //       3
      "    email = models.EmailField()", //                                4
      "    def get_email(self):", //                                       5
      "        return self.user.email", //                                 6
      "    def owner_email(self):", //                                     7
      "        return self.owner.email", //                                8
    ];
    const analyzed = analyzeSource(pack, lines.join("\n"))!;
    try {
      const at = (line: number) => occurrenceReceiverClass(analyzed, line, (t) => /email/i.test(t));
      expect(at(6)).toBe("User");
      expect(at(8)).toBe("User");
    } finally {
      analyzed.dispose();
    }
  });
});

describe("field selectors in call arguments", () => {
  beforeAll(async () => {
    await initAnalysisEngine(LANGUAGE_PACKS);
  });

  it("types a quoted field selector by the enclosing call's receiver", () => {
    const pack = packForFile("typescript", "a.ts")!;
    const lines = [
      "class UsersService {}", //                                  1
      "export class CommentsService {", //                         2
      "  async notify(id: string) {", //                           3
      "    const usersService = new UsersService();", //           4
      "    const user = await usersService.readOne(id, {", //      5
      "      fields: ['id', 'first_name', 'email'],", //           6
      "    });", //                                                7
      "  }", //                                                    8
      "}",
    ];
    const analyzed = analyzeSource(pack, lines.join("\n"))!;
    try {
      expect(occurrenceReceiver(analyzed, 6, (t) => /email/i.test(t), lines[5]).className).toBe("UsersService");
    } finally {
      analyzed.dispose();
    }
  });
});
