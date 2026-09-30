import { assignDeclarationGroups, classEntity, mentionGroup, mentionQualifier, modelFileEntity } from "../../../src/pii-signals/mention-group";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
import { buildScanPersonalDataLayers } from "../../../src/core/pipeline/build-scan-personal-data-layers";
import type { FileInfo } from "../../../src/core/types/file";

function file(path: string, language: FileInfo["language"], content: string): FileInfo {
  return { path, language, content, size: content.length } as FileInfo;
}

describe("mentionQualifier", () => {
  it.each([
    ["const senderEmail = settings.sender_email;", "sender"],
    ["order.customer_email = email", "customer"],
    ["const to = member.get('email');", "member"],
    ["user = gift_card.used_by_email", "used_by"],
    ["stripeCustomer.email", "customer"],
    ["recipient_email = data['email']", undefined],
    ["const email = req.body.email;", undefined],
    ["newEmail = input.email", undefined],
    ["customer_email = get_customer_email_for_voucher_usage(checkout)", "customer_for_voucher_usage"],
    ["customer_email = order.user_email", "customer"],
    ["getByEmail: function getByEmail(email, unfilteredOptions) {", undefined],
    ["return models.User.getByEmail(email, options);", undefined],
    ["function sendWelcomeEmail(email, mailAPI) {", undefined],
    ['"recipient_email": order.get_customer_email(),', "customer"],
    ["def get_customer_email(self):", "customer"],
    ["customer_email = cast(str, get_customer_email_for_voucher_usage(checkout))", "customer_for_voucher_usage"],
    ["const user = await this.getUserByEmail(email);", undefined],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });

  it("handles multi-word signal ids", () => {
    expect(mentionQualifier("billing_phone_number = x", "phone_number")).toBe("billing");
    expect(mentionQualifier("phone_number = x", "phone_number")).toBeUndefined();
  });

  it("builds group ids from the signal id", () => {
    expect(mentionGroup("email", "const staffEmail = x;")).toBe("email:staff");
    expect(mentionGroup("email", "const email = x;")).toBeUndefined();
  });
});

describe("data item groups in scan output", () => {
  it("splits one data item into groups and leaves ungrouped mentions on the item only", () => {
    const content = [
      "const a = member.email;",
      "const b = staffUser.email;",
      "const c = member.get('email');",
      "const email = x;",
      "// member.email in a comment",
    ].join("\n");
    const inventory = buildPersonalDataInventoryFromIngest([file("src/a.js", "javascript", content)], []);
    const { mentions, dataItems } = buildScanPersonalDataLayers(inventory);

    const email = dataItems.find((item) => item.id === "data_item:email");
    expect(email?.groups?.map((group) => [group.id, group.mentionIds.length])).toEqual([
      ["email:member", 2],
      ["email:staff", 1],
    ]);
    expect(email?.mentionIds).toHaveLength(4);
    const commentMention = mentions.find((mention) => mention.startLine === 5);
    expect(commentMention?.location).toBe("comment");
    expect(commentMention?.group).toBeUndefined();
  });
});

describe("assignDeclarationGroups", () => {
  const hit = (
    filePath: string,
    declarationLine: number | undefined,
    group?: string,
    location: "code" | "comment" = "code",
  ) => ({
    id: "email",
    location,
    evidence: { filePath },
    ...(group ? { group } : {}),
    ...(declarationLine ? { declaration: { line: declarationLine, kind: "parameter" } } : {}),
  });

  it("gives unqualified mentions the qualifier of their shared declaration", () => {
    const out = assignDeclarationGroups([hit("a.js", 3, "email:member"), hit("a.js", 3), hit("a.js", 9)]);
    expect(out.map((h) => h.group)).toEqual(["email:member", "email:member", "email@a.js:9"]);
  });

  it("joins declarations in different files through a shared qualifier", () => {
    const out = assignDeclarationGroups([
      hit("a.js", 3, "email:member"),
      hit("a.js", 3),
      hit("b.js", 7, "email:member"),
      hit("b.js", 7),
    ]);
    expect(new Set(out.map((h) => h.group))).toEqual(new Set(["email:member"]));
  });

  it("names a declaration-only set after its smallest declaration and never groups comments", () => {
    const out = assignDeclarationGroups([hit("b.js", 4), hit("b.js", 4), hit("b.js", 4, undefined, "comment"), hit("c.js", undefined)]);
    expect(out.map((h) => h.group)).toEqual(["email@b.js:4", "email@b.js:4", undefined, undefined]);
  });

  it("does not join the same declaration line across different files", () => {
    const out = assignDeclarationGroups([hit("a.js", 5), hit("b.js", 5)]);
    expect(out[0].group).not.toBe(out[1].group);
  });
});

describe("model file anchoring", () => {
  it.each([
    ["services/members/members-api/repositories/member-repository.js", "member"],
    ["core/server/models/member.js", "member"],
    ["core/server/models/user.js", "user"],
    ["saleor/checkout/models.py", undefined],
    ["saleor/checkout/complete_checkout.py", undefined],
    ["src/customer_repository.py", "customer"],
    ["api/src/services/users.ts", "user"],
    ["api/src/controllers/users.ts", "user"],
    ["ghost/core/core/server/services/staff/staff-service-emails.js", undefined],
  ])("%s -> %s", (filePath, entity) => {
    expect(modelFileEntity(filePath)).toBe(entity);
  });

  it("joins unqualified mentions in a model file to its entity group", () => {
    const code = (filePath: string, group?: string) => ({
      id: "email",
      location: "code" as const,
      evidence: { filePath },
      ...(group ? { group } : {}),
    });
    const out = assignDeclarationGroups([
      code("a/member-repository.js"),
      code("b/service.js", "email:member"),
      code("a/order-repository.js"),
    ]);
    expect(out.map((hit) => hit.group)).toEqual(["email:member", "email:member", "email:order"]);
  });
});

describe("field links", () => {
  const code = (filePath: string, fieldKeys: Array<{ key: string; definition: boolean }>, group?: string) => ({
    id: "email",
    location: "code" as const,
    evidence: { filePath },
    fieldKeys,
    ...(group ? { group } : {}),
  });

  it("joins reads to a defined field, but not reads on a line that names another item", () => {
    const out = assignDeclarationGroups([
      code("models.py", [{ key: "checkout.email", definition: true }]),
      code("a.py", [{ key: "checkout.email", definition: false }]),
      code("b.py", [{ key: "checkout.email", definition: false }], "email:customer"),
    ]);
    expect(out[0].group).toBe(out[1].group);
    expect(out[2].group).toBe("email:customer");
    expect(out[0].group).not.toBe("email:customer");
  });

  it("names only definitions by entity field; reads keep the line qualifier", () => {
    const out = assignDeclarationGroups([
      code("a.py", [{ key: "thing.email", definition: false }]),
      code("b.py", [{ key: "newsletter.sender_email", definition: false }], "email:sender"),
      code("c.py", [{ key: "checkout.email", definition: false }], "email:customer"),
    ]);
    expect(out.map((hit) => hit.group)).toEqual([undefined, "email:sender", "email:customer"]);
  });
});

describe("cannot-link", () => {
  it("keeps a shared declaration together under its first name", () => {
    const out = assignDeclarationGroups([
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, group: "email:member", declaration: { line: 3, kind: "parameter" } },
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, group: "email:customer", declaration: { line: 3, kind: "parameter" } },
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, declaration: { line: 3, kind: "parameter" } },
    ]);
    expect(out.map((hit) => hit.group)).toEqual(["email:member", "email:member", "email:member"]);
  });

  it("never merges two differently named groups through a field link", () => {
    const out = assignDeclarationGroups([
      { id: "email", location: "code" as const, evidence: { filePath: "m.py" }, fieldKeys: [{ key: "order.email", definition: true }] },
      { id: "email", location: "code" as const, evidence: { filePath: "a.py" }, group: "email:customer", declaration: { line: 1, kind: "local" } },
      { id: "email", location: "code" as const, evidence: { filePath: "a.py" }, declaration: { line: 1, kind: "local" }, fieldKeys: [{ key: "order.email", definition: false }] },
    ]);
    expect(out[0].group).toBe("email:order");
    expect(out[1].group).toBe("email:customer");
    expect(out[2].group).toBe("email:customer");
  });
});

describe("model file anchoring to a defined field", () => {
  it("anchors a model file to a group named only by a field definition", () => {
    const out = assignDeclarationGroups([
      { id: "email", location: "code" as const, evidence: { filePath: "data/schema.js" }, fieldKeys: [{ key: "user.email", definition: true }] },
      { id: "email", location: "code" as const, evidence: { filePath: "core/models/user.js" }, fieldKeys: [] },
    ]);
    expect(out.map((hit) => (hit as { group?: string }).group)).toEqual(["email:user", "email:user"]);
  });
});

describe("call links", () => {
  const hit = (filePath: string, extra: Record<string, unknown>) => ({
    id: "email",
    location: "code" as const,
    evidence: { filePath },
    ...extra,
  });

  it("joins an argument to the callee's parameter declaration", () => {
    const out = assignDeclarationGroups([
      hit("lib/mail.js", { declaration: { line: 1, kind: "parameter" } }),
      hit("app/a.js", { group: "email:member", callLinks: ["email@lib/mail.js:1"] }),
    ]);
    expect(out.map((h) => (h as { group?: string }).group)).toEqual(["email:member", "email:member"]);
  });

  it("refuses a link between differently named sets", () => {
    const out = assignDeclarationGroups([
      hit("lib/mail.js", { group: "email:staff", declaration: { line: 1, kind: "parameter" } }),
      hit("app/a.js", { group: "email:member", callLinks: ["email@lib/mail.js:1"] }),
    ]);
    expect(out.map((h) => (h as { group?: string }).group)).toEqual(["email:staff", "email:member"]);
  });

  it("joins two callers of the same parameter", () => {
    const out = assignDeclarationGroups([
      hit("lib/mail.js", { declaration: { line: 1, kind: "parameter" } }),
      hit("app/a.js", { group: "email:member", callLinks: ["email@lib/mail.js:1"] }),
      hit("app/b.js", { declaration: { line: 3, kind: "local" }, callLinks: ["email@lib/mail.js:1"] }),
    ]);
    expect(out.map((h) => (h as { group?: string }).group)).toEqual(["email:member", "email:member", "email:member"]);
  });
});

describe("model file anchoring by majority", () => {
  it("names a set spanning several role files by the entity most of its members vote for", () => {
    const hit = (filePath: string) => ({
      id: "email",
      location: "code" as const,
      evidence: { filePath },
      declaration: { line: 1, kind: "parameter" },
      passedDeclarations: [] as number[],
    });
    const shared = (filePath: string) => ({ ...hit(filePath), declaration: { line: 10, kind: "parameter" } });
    const out = assignDeclarationGroups([
      { ...hit("api/src/controllers/auth.ts"), callLinks: ["email@api/src/services/users.ts:10"] },
      shared("api/src/services/users.ts"),
      shared("api/src/services/users.ts"),
    ] as never[]) as Array<{ group?: string }>;
    expect(out.map((h) => h.group)).toEqual(["email:user", "email:user", "email:user"]);
  });
});

describe("classEntity", () => {
  it.each([
    ["UsersService", "user"],
    ["MemberRepository", "member"],
    ["User", "user"],
    ["DonationPaymentEvents", "donation_payment_event"],
    ["Service", undefined],
  ])("%s -> %s", (name, expected) => {
    expect(classEntity(name)).toBe(expected);
  });
});

describe("receiver entity anchoring", () => {
  const hit = (filePath: string, extra: Record<string, unknown> = {}) => ({
    id: "email",
    location: "code" as const,
    evidence: { filePath },
    ...extra,
  });

  it("names an unqualified hit by its receiver, ahead of the file's role", () => {
    const out = assignDeclarationGroups([
      hit("api/src/services/members.ts", { receiverEntity: "user" }),
      hit("api/src/services/members.ts"),
    ] as never[]) as Array<{ group?: string }>;
    expect(out.map((h) => h.group)).toEqual(["email:user", "email:member"]);
  });

  it("never overrides a line qualifier, and keeps cannot-link", () => {
    const out = assignDeclarationGroups([
      hit("a.ts", { receiverEntity: "user", group: "email:customer" }),
      hit("b.ts", { receiverEntity: "user", declaration: { line: 3, kind: "local" } }),
      hit("b.ts", { group: "email:member", declaration: { line: 3, kind: "local" } }),
    ] as never[]) as Array<{ group?: string }>;
    expect(out.map((h) => h.group)).toEqual(["email:customer", "email:member", "email:member"]);
  });

  it("takes the majority receiver of a joined set", () => {
    const shared = { declaration: { line: 9, kind: "parameter" } };
    const out = assignDeclarationGroups([
      hit("a.ts", { ...shared, receiverEntity: "member" }),
      hit("a.ts", { ...shared, receiverEntity: "user" }),
      hit("a.ts", { ...shared, receiverEntity: "user" }),
    ] as never[]) as Array<{ group?: string }>;
    expect(out.map((h) => h.group)).toEqual(["email:user", "email:user", "email:user"]);
  });
});

describe("classEntity", () => {
  it.each([
    ["UsersService", "user"],
    ["UserInfo", "user"],
    ["RegisterUserInput", "user"],
    ["StaffMemberTextData", "member"],
    ["Data", "data"],
  ])("%s -> %s", (className, entity) => {
    expect(classEntity(className)).toBe(entity);
  });

  it("treats key as a container word in qualifiers", () => {
    expect(mentionQualifier("const email = userInfo[emailKey];", "email")).toBeUndefined();
  });
});

describe("user receiver", () => {
  it.each([
    ["return user.email;", "user"],
    ["if (user['email'] && flag) {", "user"],
    ["const to = user?.email ?? input.email;", "user"],
    ["const to = staffUser.email;", "staff"],
    ["const u = newUser.email;", undefined],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });
});

describe("local copies keep the source identity", () => {
  it.each([
    ["const parentMemberEmail = parentMember.get('email');", "member"],
    ["const verificationEmail = user?.email ?? input.email;", "user"],
    ["gift_card.used_by_email = user.email", "used_by"],
    ["customer_email = order.user_email", "customer"],
    ["const senderEmail = settings.email;", "settings"],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });
});

describe("receiver chains and concept modifiers", () => {
  it.each([
    ["if (member.attributes.email !== member._previousAttributes.email) {", "member"],
    ["if (this._stripeAPIService.configured && member._changed.email) {", "member"],
    ["'members.email',", "member"],
    ["const didRemoveSuppression = await emailSuppressionList.removeEmail(member.email);", "member"],
    ["requestUserEmail: frame.user ? frame.user.get('email') : null,", "request"],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });
});

describe("assigned function definitions", () => {
  it.each([
    ["const findOneByEmail = async (email: string, populate = []) => {", undefined],
    ["  sendResetEmail: async (to) => {", undefined],
    ["const customerEmail = order.customer.email;", "customer"],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });
});

describe("lookup names", () => {
  it.each([
    ["  findOneByEmail,", undefined],
    ["  resetPasswordByEmail,", undefined],
    ["const emailForUser = x;", undefined],
    ["const senderEmail = x;", "sender"],
  ])("%s -> %s", (line, expected) => {
    expect(mentionQualifier(line, "email")).toBe(expected);
  });
});
