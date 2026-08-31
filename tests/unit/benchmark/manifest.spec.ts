import { normalizeSubjectKey } from "../../benchmark/manifest";

describe("benchmark/manifest normalizeSubjectKey", () => {
  it("migrates pii_signal: to mention: for mentions layer", () => {
    expect(normalizeSubjectKey("mentions", "pii_signal:email")).toBe(
      "mention:email",
    );
  });

  it("migrates pii_signal: to raw_hit: for raw_hits layer", () => {
    expect(normalizeSubjectKey("raw_hits", "pii_signal:email")).toBe(
      "raw_hit:email",
    );
  });

  it("leaves canonical mention keys unchanged", () => {
    expect(normalizeSubjectKey("mentions", "mention:email")).toBe("mention:email");
  });

  it("leaves gold pii: taxonomy keys unchanged for mentions", () => {
    expect(normalizeSubjectKey("mentions", "pii:email_address")).toBe(
      "pii:email_address",
    );
    expect(normalizeSubjectKey("pii_signals", "pii:person_name")).toBe(
      "pii:person_name",
    );
  });

  it("leaves data_item keys unchanged", () => {
    expect(normalizeSubjectKey("data_items", "data_item:email")).toBe(
      "data_item:email",
    );
  });
});
