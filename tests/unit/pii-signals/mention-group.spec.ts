import { mentionGroup, mentionQualifier } from "../../../src/pii-signals/mention-group";
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
