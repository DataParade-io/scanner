import path from "path";

import {
  detectRustPatternsFromDependencyManifests,
  parseRustDependencyManifests,
} from "../../../../src/analyzers/rust/dependency-manifests";
import { parseCargoToml } from "../../../../src/analyzers/rust/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "rust-dependency-manifests-basic",
);

describe("Rust manifest parsers", () => {
  it("parses package name and dependency crate names", () => {
    const content = [
      "[package]",
      'name = "acme-gateway"',
      "",
      "[dependencies]",
      'axum = "0.7"',
      'sqlx = { version = "0.7", features = ["postgres"] }',
      'renamed = { package = "sea-orm", version = "0.12" }',
      "",
      "[dev-dependencies]",
      'tokio-test = "0.4"',
      "",
    ].join("\n");

    const parsed = parseCargoToml(content);

    expect(parsed.name).toBe("acme-gateway");
    expect(parsed.crates.sort()).toEqual([
      "axum",
      "sea-orm",
      "sqlx",
      "tokio-test",
    ]);
  });
});

describe("Rust dependency manifests", () => {
  it("walks Cargo.toml fixtures and feeds crate names to matchPatterns", async () => {
    const manifests = await parseRustDependencyManifests(FIXTURE_ROOT);
    expect(manifests.length).toBe(1);
    expect(manifests[0].packageName).toBe("acme-billing-api");
    expect(manifests[0].crates).toEqual(
      expect.arrayContaining(["axum", "sqlx", "reqwest", "async-stripe"]),
    );

    const findings = await detectRustPatternsFromDependencyManifests(FIXTURE_ROOT);
    expect(findings.length).toBeGreaterThan(0);

    const dbs = findings.filter((f) => f.pattern === "database_connection");
    expect(dbs.some((d) => d.name === "sqlx")).toBe(true);

    const apis = findings.filter((f) => f.pattern === "external_api_call");
    expect(
      apis.some(
        (a) =>
          a.properties.serviceName === "stripe" ||
          String(a.name).includes("stripe") ||
          a.name === "reqwest",
      ),
    ).toBe(true);
  });
});
