import path from "path";

import {
  detectRubyPatternsFromDependencyManifests,
  parseRubyDependencyManifests,
} from "../../../../src/analyzers/ruby/dependency-manifests";
import {
  bundlerGemModule,
  parseGemfile,
  parseGemfileLock,
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
  it("parses gem declarations from a Gemfile", () => {
    const content = [
      'source "https://rubygems.org"',
      "",
      'gem "rails", "~> 7.1"',
      "gem 'pg'",
      "# gem 'ignored'",
      'gem "stripe"',
      "",
    ].join("\n");

    const parsed = parseGemfile(content);
    expect(parsed.gems.sort()).toEqual(["pg", "rails", "stripe"]);
  });

  it("parses top-level specs from Gemfile.lock", () => {
    const content = [
      "GEM",
      "  remote: https://rubygems.org/",
      "  specs:",
      "    rails (7.1.0)",
      "      actionpack (= 7.1.0)",
      "    stripe (10.0.0)",
      "",
      "DEPENDENCIES",
      "  rails",
      "",
    ].join("\n");

    const parsed = parseGemfileLock(content);
    expect(parsed.gems.sort()).toEqual(["rails", "stripe"]);
    expect(bundlerGemModule("stripe")).toBe("gem:stripe");
  });
});

describe("Ruby dependency manifests", () => {
  it("walks Gemfile + Gemfile.lock and feeds gem: names to matchPatterns", async () => {
    const manifests = await parseRubyDependencyManifests(FIXTURE_ROOT);
    expect(manifests.length).toBe(1);
    expect(manifests[0].gems).toEqual(
      expect.arrayContaining([
        "rails",
        "pg",
        "devise",
        "faraday",
        "stripe",
        "sentry-ruby",
      ]),
    );

    const findings = await detectRubyPatternsFromDependencyManifests(FIXTURE_ROOT);
    expect(findings.length).toBeGreaterThan(0);

    const dbs = findings.filter((f) => f.pattern === "database_connection");
    expect(
      dbs.some(
        (d) => d.name === "active_record" || d.name === "pg" || d.properties.client === "pg",
      ),
    ).toBe(true);

    const auth = findings.filter((f) => f.pattern === "auth_middleware");
    expect(auth.some((a) => a.name === "devise")).toBe(true);

    const apis = findings.filter((f) => f.pattern === "external_api_call");
    expect(
      apis.some(
        (a) =>
          a.properties.serviceName === "stripe" ||
          a.name === "stripe" ||
          a.name === "faraday" ||
          a.properties.serviceName === "sentry",
      ),
    ).toBe(true);
  });
});
