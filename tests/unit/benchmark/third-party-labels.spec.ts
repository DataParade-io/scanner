import fs from "fs";
import path from "path";

import { loadBenchmarkManifest } from "../../benchmark/manifest";
import type { BenchmarkManifest } from "../../benchmark/schema";
import {
  isInManifestScope,
  loadThirdPartyLabels,
  parseThirdPartyLabels,
  predictedVendorsFromFindings,
  scoreThirdPartyVendors,
  THIRD_PARTY_LABELS_VERSION,
} from "../../benchmark/third-party-labels";

const REPOS = path.join(__dirname, "../../benchmark/repos");

const manifest: BenchmarkManifest = {
  repository: "example/app",
  commit: "abc",
  license: "MIT",
  scope: { include: ["src/api", "lib/mail.ts"], exclude: [{ path: "src/api/vendor", reason: "vendored" }] },
  coverage: { layers: ["components"], languages: ["typescript"], domains: [] },
  selection_rationale: "test",
  annotation_version: 1,
};

function vendor(overrides: Record<string, unknown> = {}) {
  return {
    vendor: "stripe",
    subject_key: "third_party:stripe",
    component_subtype: "payment_processor",
    sends_data: true,
    route: "sdk",
    subprocessor: "yes",
    data_categories: ["payment_card", "email"],
    provenance: {
      manifest: [{ file_path: "package.json", line: 10, package: "stripe" }],
      imports: [{ file_path: "src/api/pay.ts", line: 1, module: "stripe" }],
      call_sites: [{ file_path: "src/api/pay.ts", line: 20 }],
    },
    uncertain: false,
    rationale: "Charges the card.",
    review_state: "proposed",
    proposed_by: "claude-opus-5.5",
    proposed_at: "2026-11-12",
    ...overrides,
  };
}

function labels(...vendors: Record<string, unknown>[]) {
  return parseThirdPartyLabels({ version: THIRD_PARTY_LABELS_VERSION, vendors }, "test");
}

describe("third-party vendor labels (DATAP-895)", () => {
  it("parses a vendor record", () => {
    const file = labels(vendor());
    expect(file.vendors[0]).toMatchObject({ subject_key: "third_party:stripe", subprocessor: "yes", route: "sdk" });
  });

  it("rejects unknown categories, duplicate vendors and senders without call sites", () => {
    expect(() => labels(vendor({ data_categories: ["shoe_size"] }))).toThrow(/data_categories\[0\]/);
    expect(() => labels(vendor(), vendor())).toThrow(/listed twice/);
    expect(() =>
      labels(vendor({ provenance: { manifest: [], imports: [], call_sites: [] } })),
    ).toThrow(/call site/);
    expect(() => labels(vendor({ subject_key: "asset:stripe" }))).toThrow(/third_party:/);
  });

  it("accepts a declared-only vendor with a manifest entry and no categories", () => {
    const file = labels(
      vendor({
        sends_data: false,
        data_categories: [],
        provenance: { manifest: [{ file_path: "package.json", line: 3, package: "stripe" }], imports: [], call_sites: [] },
      }),
    );
    expect(file.vendors[0].sends_data).toBe(false);
  });

  it("matches files and directories in the manifest scope, minus excludes", () => {
    expect(isInManifestScope("src/api/pay.ts", manifest)).toBe(true);
    expect(isInManifestScope("lib/mail.ts", manifest)).toBe(true);
    expect(isInManifestScope("src/apix/pay.ts", manifest)).toBe(false);
    expect(isInManifestScope("src/api/vendor/x.ts", manifest)).toBe(false);
    const globbed: BenchmarkManifest = {
      ...manifest,
      scope: { include: ["packages/"], exclude: [{ path: "**/*.test.ts, **/__tests__/, packages/a/seed.ts", reason: "tests" }] },
    };
    expect(isInManifestScope("packages/a/b.ts", globbed)).toBe(true);
    expect(isInManifestScope("packages/a/b.test.ts", globbed)).toBe(false);
    expect(isInManifestScope("packages/a/__tests__/b.ts", globbed)).toBe(false);
    expect(isInManifestScope("packages/a/seed.ts", globbed)).toBe(false);
  });

  it("scores hits, misses by cause, false positives and declared-only vendors", () => {
    const file = labels(
      vendor(),
      vendor({
        vendor: "sentry",
        subject_key: "third_party:sentry",
        route: "sdk",
        provenance: { manifest: [], imports: [], call_sites: [{ file_path: "src/api/errors.ts", line: 5 }] },
      }),
      vendor({
        vendor: "slack",
        subject_key: "third_party:slack",
        route: "raw_http",
        provenance: { manifest: [], imports: [], call_sites: [{ file_path: "lib/mail.ts", line: 9 }] },
      }),
      vendor({
        vendor: "openai",
        subject_key: "third_party:openai",
        aliases: ["third_party:azure_openai"],
        provenance: { manifest: [], imports: [], call_sites: [{ file_path: "src/api/ai.ts", line: 2 }] },
      }),
      vendor({
        vendor: "mailgun",
        subject_key: "third_party:mailgun",
        sends_data: false,
        data_categories: [],
        provenance: { manifest: [{ file_path: "package.json", line: 4, package: "mailgun.js" }], imports: [], call_sites: [] },
      }),
    );
    const score = scoreThirdPartyVendors(
      file,
      [
        { key: "third_party:stripe", locations: [{ file_path: "src/api/pay.ts", line: 21 }] },
        // reported in scope, but not at a labelled location
        { key: "third_party:sentry", locations: [{ file_path: "src/api/other.ts", line: 1 }] },
        { key: "third_party:azure_openai", locations: [{ file_path: "src/api/ai.ts", line: 2 }] },
        { key: "third_party:mailgun", locations: [{ file_path: "src/api/mail.ts", line: 1 }] },
        { key: "third_party:twilio", locations: [{ file_path: "src/api/sms.ts", line: 1 }] },
        // out of scope: ignored
        { key: "third_party:aws", locations: [{ file_path: "scripts/deploy.ts", line: 1 }] },
      ],
      manifest,
    );
    expect(score.goldVendors).toBe(4);
    expect(score.hits).toBe(2);
    expect(score.vendorHits).toBe(3);
    expect(score.recall).toBeCloseTo(0.5);
    expect(score.vendorRecall).toBeCloseTo(0.75);
    expect(score.falsePositives).toEqual(["third_party:twilio"]);
    expect(score.predictedVendors).toBe(4);
    expect(score.precision).toBeCloseTo(0.75);
    expect(score.missesByCause).toEqual({ no_sdk_mapping: 0, raw_http_missed: 1, provenance_wrong: 1 });
    expect(score.declaredOnly).toEqual([{ subject_key: "third_party:mailgun", reported: true }]);
  });

  it("counts only the requested review states", () => {
    const file = labels(vendor({ review_state: "proposed" }));
    const score = scoreThirdPartyVendors(file, [], manifest, { reviewStates: ["accepted"] });
    expect(score.goldVendors).toBe(0);
    expect(score.recall).toBeNull();
  });

  it("reads predictions from components-layer findings only", () => {
    const predictions = predictedVendorsFromFindings([
      { key: "third_party:stripe", layer: "components", sourceLines: [{ file_path: "a.ts", start_line: 3 }] },
      { key: "asset:database", layer: "components", sourceLines: [] },
      { key: "third_party:stripe", layer: "data-flows", sourceLines: [] },
    ]);
    expect(predictions).toEqual([{ key: "third_party:stripe", locations: [{ file_path: "a.ts", line: 3 }] }]);
  });

  it("every committed third_parties.yaml parses and names files inside or beside its packet", () => {
    const packets = fs
      .readdirSync(REPOS)
      .filter((key) => fs.existsSync(path.join(REPOS, key, "annotations", "third_parties.yaml")));
    expect(packets.length).toBeGreaterThan(0);
    for (const key of packets) {
      const file = loadThirdPartyLabels(path.join(REPOS, key));
      expect(file).not.toBeNull();
      const packetManifest = loadBenchmarkManifest(path.join(REPOS, key));
      for (const label of file!.vendors.filter((entry) => entry.sends_data)) {
        for (const site of label.provenance.call_sites) {
          if (!isInManifestScope(site.file_path, packetManifest)) {
            throw new Error(`${key} ${label.subject_key}: call site ${site.file_path} is outside the manifest scope`);
          }
        }
      }
    }
  });
});
