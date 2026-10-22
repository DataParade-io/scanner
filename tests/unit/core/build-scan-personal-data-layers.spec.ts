import { buildScanPersonalDataLayers } from "../../../src/core/pipeline/build-scan-personal-data-layers";
import type { PersonalDataInventory } from "../../../src/eval-layers/personal-data-inventory";
import type { PiiSignalHit } from "../../../src/pii-signals/match-pii-signals";

function hit(line: number, group?: string): PiiSignalHit {
  return {
    id: "email",
    category: "identifiers",
    labels: ["email"],
    evidence: { filePath: "messages/en.json", startLine: line, endLine: line, reason: "key" },
    location: "code",
    ...(group ? { group } : {}),
  };
}

describe("buildScanPersonalDataLayers", () => {
  it("snippets each occurrence and lists each occurrence once, in first-seen order", () => {
    const content = Array.from({ length: 5_000 }, (_, i) => `"emailLabel${i + 1}": "Email ${i + 1}",`).join("\n");
    const hits = [hit(3, "email:user"), hit(1, "email:user"), hit(3, "email:user"), hit(4_000, "email:staff")];
    const inventory = {
      hits,
      files: [{ path: "messages/en.json", name: "en.json", content, language: "json", size: content.length }],
      ingestOutcomes: [],
    } as unknown as PersonalDataInventory;

    const { occurrences, dataItems } = buildScanPersonalDataLayers(inventory);

    expect(occurrences.map((o) => o.code)).toEqual([
      '"emailLabel3": "Email 3",',
      '"emailLabel1": "Email 1",',
      '"emailLabel3": "Email 3",',
      '"emailLabel4000": "Email 4000",',
    ]);
    expect(dataItems).toHaveLength(1);
    const [item] = dataItems;
    expect(item.occurrenceIds).toEqual([
      "occurrence:email:messages/en.json:3",
      "occurrence:email:messages/en.json:1",
      "occurrence:email:messages/en.json:4000",
    ]);
    expect(item.groups).toEqual([
      { id: "email:staff", occurrenceIds: ["occurrence:email:messages/en.json:4000"] },
      {
        id: "email:user",
        occurrenceIds: ["occurrence:email:messages/en.json:3", "occurrence:email:messages/en.json:1"],
      },
    ]);
  });

  it("splits a file into lines once however many occurrences it has", () => {
    const content = Array.from({ length: 2_000 }, (_, i) => `email${i}`).join("\n");
    const inventory = {
      hits: Array.from({ length: 2_000 }, (_, i) => hit(i + 1)),
      files: [{ path: "messages/en.json", name: "en.json", content, language: "json", size: content.length }],
      ingestOutcomes: [],
    } as unknown as PersonalDataInventory;
    const split = jest.spyOn(String.prototype, "split");
    try {
      buildScanPersonalDataLayers(inventory);
      const fileSplits = split.mock.contexts.filter((context) => String(context) === content);
      expect(fileSplits).toHaveLength(1);
    } finally {
      split.mockRestore();
    }
  });
});
