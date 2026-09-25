import path from "path";

import {
  detectRubyPatternsFromDependencyManifests,
  parseRubyDependencyManifests,
} from "../../../../src/analyzers/ruby/dependency-manifests";
import {
  parseGemfile,
  parseGemfileLockVersions,
} from "../../../../src/analyzers/ruby/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "ruby-dependency-manifests-basic",
);

describe("Ruby manifest parsers", () => {
  it("extracts direct runtime gems and excludes explicit development/test groups", () => {
    const parsed = parseGemfile(`
      gem "stripe"
      gem "aws-sdk-s3", group: :production
      group :development, :test do
        gem "rspec"
      end
      gem "rubocop", groups: [:development, :test]
      gem "sentry-ruby", group: [:production, :development]
    `);

    expect(parsed.map((gem) => gem.name)).toEqual([
      "stripe",
      "aws-sdk-s3",
      "sentry-ruby",
    ]);
  });

  it("extracts resolved versions from the GEM specs section", () => {
    const versions = parseGemfileLockVersions(`
GEM
  specs:
    stripe (13.2.0)
      rake
    twilio-ruby (7.8.0-x86_64-linux)

DEPENDENCIES
  stripe
`);

    expect(versions.get("stripe")).toBe("13.2.0");
    expect(versions.get("twilio-ruby")).toBe("7.8.0-x86_64-linux");
  });
});

describe("Ruby dependency manifests", () => {
  it("pairs direct Gemfile gems with locked versions", async () => {
    const manifests = await parseRubyDependencyManifests(FIXTURE_ROOT);

    expect(manifests).toHaveLength(1);
    expect(manifests[0].manifestRelativePath).toBe("Gemfile");
    expect(manifests[0].dependencies).toEqual(
      expect.arrayContaining([
        { name: "stripe", version: "13.2.0" },
        { name: "twilio-ruby", version: "7.8.0" },
        { name: "aws-sdk-s3", version: "1.188.0" },
        { name: "twitter", version: "8.0.0" },
        { name: "googleauth", version: "1.15.0" },
      ]),
    );
    expect(
      manifests[0].dependencies.map((dependency) => dependency.name),
    ).not.toEqual(expect.arrayContaining(["rspec", "rubocop", "sentry-ruby"]));
  });

  it("maps recognized gems through the third-party engine with manifest context", async () => {
    const findings =
      await detectRubyPatternsFromDependencyManifests(FIXTURE_ROOT);
    const external = findings.filter(
      (finding) => finding.pattern === "external_api_call",
    );

    expect(external).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            serviceName: "stripe",
            packageName: "stripe",
            packageVersion: "13.2.0",
            sourceContext: "dependency_manifest",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            serviceName: "twilio",
            packageName: "twilio-ruby",
            packageVersion: "7.8.0",
            sourceContext: "dependency_manifest",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            serviceName: "aws",
            packageName: "aws-sdk-s3",
            packageVersion: "1.188.0",
            sourceContext: "dependency_manifest",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            serviceName: "twitter",
            packageName: "twitter",
            packageVersion: "8.0.0",
            sourceContext: "dependency_manifest",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            serviceName: "google_identity",
            packageName: "googleauth",
            packageVersion: "1.15.0",
            sourceContext: "dependency_manifest",
          }),
        }),
      ]),
    );
    expect(
      external.some((finding) => finding.properties.serviceName === "sentry"),
    ).toBe(false);
  });
});
