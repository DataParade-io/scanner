import { assignDeclarationGroups, mentionGroup, mentionQualifier, modelFileEntity } from "../../../src/pii-signals/mention-group";
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
    ["core/server/models/user.js", undefined],
    ["saleor/checkout/models.py", undefined],
    ["saleor/checkout/complete_checkout.py", undefined],
    ["src/customer_repository.py", "customer"],
  ])("%s -> %s", (filePath, entity) => {
    expect(modelFileEntity(filePath)).toBe(entity);
  });

  it("joins unqualified mentions in a model file to the existing entity group only", () => {
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
    expect(out.map((hit) => hit.group)).toEqual(["email:member", "email:member", undefined]);
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

  it("ignores reads of a field nobody defines", () => {
    const out = assignDeclarationGroups([
      code("a.py", [{ key: "thing.email", definition: false }]),
      code("b.py", [{ key: "thing.email", definition: false }]),
    ]);
    expect(out.map((hit) => hit.group)).toEqual([undefined, undefined]);
  });
});

describe("cannot-link", () => {
  it("never merges two differently named groups through a shared declaration", () => {
    const out = assignDeclarationGroups([
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, group: "email:member", declaration: { line: 3, kind: "parameter" } },
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, group: "email:customer", declaration: { line: 3, kind: "parameter" } },
      { id: "email", location: "code" as const, evidence: { filePath: "a.js" }, declaration: { line: 3, kind: "parameter" } },
    ]);
    expect(out.map((hit) => hit.group)).toEqual(["email:member", "email:customer", "email:member"]);
  });
});
