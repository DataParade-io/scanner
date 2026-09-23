import {
  dataItemConceptId,
  dataItemIdentity,
  mentionIdentity,
  piiSignalIdentity,
  rawHitIdentity,
} from "../../../src/eval-layers/identities";

describe("eval-layers/identities", () => {
  it("maps rule ids to stable personal-data identity keys", () => {
    expect(dataItemConceptId("email")).toBe("email");
    expect(rawHitIdentity("email")).toBe("raw_hit:email");
    expect(mentionIdentity("email", "src/auth/login.ts", 13)).toBe(
      "mention:email:src/auth/login.ts:13",
    );
    expect(dataItemIdentity("email")).toBe("data_item:email");
  });

  it("keeps piiSignalIdentity as a raw_hit alias", () => {
    expect(piiSignalIdentity("password")).toBe("raw_hit:password");
    expect(piiSignalIdentity("password")).toBe(rawHitIdentity("password"));
  });
});
