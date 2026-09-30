import { analyzeSource, initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS, packForFile } from "../../../src/analyze/languages";
import { mentionReceiverClass } from "../../../src/analyze/mention-receiver";
import type { FileLanguage } from "../../../src/core/types/file";

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
