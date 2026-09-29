import type { FileInfo, FileLanguage } from "../../../src/core/types/file";
import type { RawFinding } from "../../../src/core/types/detection";
import {
  detectThirdPartyServicesFromImports,
  matchPatterns,
  type ImportLike,
} from "../../../src/patterns/engine";
import { detectExternalApiCalls } from "../../../src/analyzers/typescript/third-party-detection";
import { buildCodeModel } from "../../../src/analyzers/typescript/parser";
import { detectPythonPatterns } from "../../../src/analyzers/python/detector";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { detectTypeScriptPatternsFromDependencyManifests } from "../../../src/analyzers/typescript/dependency-manifests";
import { classifyRawFindings } from "../../../src/classifier/component-factory";

describe("third-party import evidence line", () => {
  it("uses matching ImportLike startLine instead of hardcoding 1", () => {
    const file: FileInfo = {
      path: "src/payments.ts",
      name: "payments.ts",
      language: "typescript",
      size: 1,
      content: "",
    };

    const findings = detectThirdPartyServicesFromImports({
      language: "typescript",
      file,
      imports: [
        { module: "fs", names: ["readFile"], startLine: 1, endLine: 1 },
        {
          module: "stripe",
          names: ["Stripe"],
          startLine: 12,
          endLine: 12,
        },
      ],
    });

    const stripe = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        (f.properties?.serviceName === "stripe" || f.name === "stripe"),
    );

    expect(stripe).toBeDefined();
    expect(stripe?.location.startLine).toBe(12);
    expect(stripe?.location.endLine).toBe(12);
  });

  it("keeps every matching import line and classifies them as one component", () => {
    const file: FileInfo = {
      path: "src/payments.ts",
      name: "payments.ts",
      language: "typescript",
      size: 1,
      content: "",
    };

    const findings = detectThirdPartyServicesFromImports({
      language: "typescript",
      file,
      imports: [
        {
          module: "./config",
          names: ["stripeMode"],
          startLine: 2,
          endLine: 2,
        },
        {
          module: "stripe",
          names: ["Stripe"],
          startLine: 12,
          endLine: 14,
        },
        {
          module: "stripe",
          names: ["Stripe"],
          startLine: 12,
          endLine: 14,
        },
      ],
    });

    const stripeFindings = findings.filter(
      (f) => f.pattern === "external_api_call" && f.name === "stripe",
    );
    expect(stripeFindings.map((f) => [f.location.startLine, f.location.endLine])).toEqual([
      [2, 2],
      [12, 14],
    ]);

    const components = classifyRawFindings(stripeFindings);
    expect(components).toHaveLength(1);
    expect(
      components[0]?.sourceLocations.map((loc) => [
        loc.startLine,
        loc.endLine,
      ]),
    ).toEqual([
      [2, 2],
      [12, 14],
    ]);

    const evidence = components[0]?.properties.propertyEvidence as
      | Record<string, Array<{ startLine: number; endLine: number }>>
      | undefined;
    expect(evidence?.serviceName.map((ref) => [ref.startLine, ref.endLine])).toEqual([
      [2, 2],
      [12, 14],
    ]);
    expect(evidence?.client.map((ref) => [ref.startLine, ref.endLine])).toEqual([
      [2, 2],
      [12, 14],
    ]);
  });

  it("falls back to line 1 when ImportLike has no startLine", () => {
    const file: FileInfo = {
      path: "src/payments.ts",
      name: "payments.ts",
      language: "typescript",
      size: 1,
      content: "",
    };

    const findings = detectThirdPartyServicesFromImports({
      language: "typescript",
      file,
      imports: [{ module: "stripe", names: ["Stripe"] }],
    });

    const stripe = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        (f.properties?.serviceName === "stripe" || f.name === "stripe"),
    );

    expect(stripe).toBeDefined();
    expect(stripe?.location.startLine).toBe(1);
    expect(stripe?.location.endLine).toBe(1);
  });

  it("TypeScript: import on line 5 yields external_api_call at line 5", () => {
    const content = [
      "// header",
      "",
      "",
      "",
      'import Stripe from "stripe";',
      "",
      "export const client = new Stripe(process.env.STRIPE_KEY!);",
      "",
    ].join("\n");

    const file: FileInfo = {
      path: "src/billing/stripe-client.ts",
      name: "stripe-client.ts",
      language: "typescript",
      size: content.length,
      content,
    };

    const model = buildCodeModel(file);
    const importEntry = model.imports.find((imp) =>
      imp.moduleSpecifier.includes("stripe"),
    );
    expect(importEntry?.location.startLine).toBe(5);

    const findings = detectExternalApiCalls(file, model);
    const stripe = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        f.properties?.serviceName === "stripe",
    );

    expect(stripe).toBeDefined();
    expect(stripe?.location.startLine).toBe(5);
    expect(stripe?.location.endLine).toBe(5);
  });

  it("Python: import on line 4 yields external_api_call at line 4", () => {
    const content = [
      "# setup",
      "",
      "",
      "import stripe",
      "",
      "stripe.api_key = 'sk_test'",
      "",
    ].join("\n");

    const file: FileInfo = {
      path: "app/payments.py",
      name: "payments.py",
      language: "python",
      size: content.length,
      content,
    };

    const findings = detectPythonPatterns(file);
    const stripe = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        (f.properties?.serviceName === "stripe" || f.name === "stripe"),
    );

    expect(stripe).toBeDefined();
    expect(stripe?.location.startLine).toBe(4);
    expect(stripe?.location.endLine).toBe(4);
  });
});

describe("per-language import evidence spans", () => {
  function sourceFile(language: FileLanguage, path: string): FileInfo {
    return {
      path,
      name: path,
      language,
      size: 1,
      content: "",
    };
  }

  function expectLinkedSpans(opts: {
    language: FileLanguage;
    path: string;
    imports: ImportLike[];
    pattern: RawFinding["pattern"];
    name: string;
    spans: number[][];
  }): void {
    const findings = matchPatterns({
      language: opts.language,
      file: sourceFile(opts.language, opts.path),
      normalizedPath: opts.path,
      imports: opts.imports,
    }).filter(
      (finding) =>
        finding.pattern === opts.pattern && finding.name === opts.name,
    );

    expect(
      findings.map((finding) => [
        finding.location.startLine,
        finding.location.endLine,
      ]),
    ).toEqual(opts.spans);

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);
    expect(
      components[0]?.sourceLocations.map((loc) => [
        loc.startLine,
        loc.endLine,
      ]),
    ).toEqual(opts.spans);

    const evidence = components[0]?.properties.propertyEvidence as
      | Record<string, Array<{ startLine: number; endLine: number }>>
      | undefined;
    expect(evidence?.client.map((ref) => [ref.startLine, ref.endLine])).toEqual(
      opts.spans,
    );
  }

  it("TypeScript keeps every typeorm import line on one component", () => {
    expectLinkedSpans({
      language: "typescript",
      path: "src/db.ts",
      imports: [
        { module: "typeorm", names: ["DataSource"], startLine: 4, endLine: 4 },
        { module: "typeorm", names: ["Entity"], startLine: 18, endLine: 18 },
      ],
      pattern: "database_connection",
      name: "typeorm",
      spans: [
        [4, 4],
        [18, 18],
      ],
    });
  });

  it("Python keeps every sqlalchemy import line on one component", () => {
    expectLinkedSpans({
      language: "python",
      path: "app/db.py",
      imports: [
        { module: "sqlalchemy", names: ["create_engine"], startLine: 3, endLine: 3 },
        { module: "sqlalchemy.orm", names: ["Session"], startLine: 11, endLine: 11 },
      ],
      pattern: "database_connection",
      name: "sqlalchemy",
      spans: [
        [3, 3],
        [11, 11],
      ],
    });
  });

  it("Go keeps every lib/pq import line on one component", () => {
    expectLinkedSpans({
      language: "go",
      path: "store/db.go",
      imports: [
        { module: "github.com/lib/pq", names: ["pq"], startLine: 5, endLine: 5 },
        {
          module: "github.com/lib/pq",
          names: ["pq"],
          startLine: 14,
          endLine: 16,
        },
      ],
      pattern: "database_connection",
      name: "lib_pq",
      spans: [
        [5, 5],
        [14, 16],
      ],
    });
  });

  it("PHP keeps every PDO import line on one component", () => {
    expectLinkedSpans({
      language: "php",
      path: "src/Db.php",
      imports: [
        { module: "PDO", names: ["PDO"], startLine: 6, endLine: 6 },
        { module: "PDO", names: ["PDO"], startLine: 20, endLine: 20 },
      ],
      pattern: "database_connection",
      name: "pdo",
      spans: [
        [6, 6],
        [20, 20],
      ],
    });
  });

  it("C# keeps every EF Core using line on one component", () => {
    expectLinkedSpans({
      language: "csharp",
      path: "Data/AppDb.cs",
      imports: [
        {
          module: "Microsoft.EntityFrameworkCore",
          names: ["DbContext"],
          startLine: 2,
          endLine: 2,
        },
        {
          module: "Microsoft.EntityFrameworkCore.Metadata",
          names: ["IEntityType"],
          startLine: 9,
          endLine: 9,
        },
      ],
      pattern: "database_connection",
      name: "entity_framework_core",
      spans: [
        [2, 2],
        [9, 9],
      ],
    });
  });

  it("C++ keeps every libpq include line on one component", () => {
    expectLinkedSpans({
      language: "cpp",
      path: "src/db.cpp",
      imports: [
        { module: "libpq-fe.h", names: ["libpq-fe.h"], startLine: 2, endLine: 2 },
        { module: "libpq-fe.h", names: ["libpq-fe.h"], startLine: 15, endLine: 15 },
      ],
      pattern: "database_connection",
      name: "libpq",
      spans: [
        [2, 2],
        [15, 15],
      ],
    });
  });

  it("JVM keeps every postgres import line on one component", () => {
    expectLinkedSpans({
      language: "java",
      path: "src/Db.java",
      imports: [
        {
          module: "org.postgresql.Driver",
          names: ["Driver"],
          startLine: 3,
          endLine: 3,
        },
        {
          module: "org.postgresql.util.PGobject",
          names: ["PGobject"],
          startLine: 12,
          endLine: 12,
        },
      ],
      pattern: "database_connection",
      name: "postgresql_jdbc",
      spans: [
        [3, 3],
        [12, 12],
      ],
    });
  });

  it("package.json keeps a dependency declared twice as two evidence links", async () => {
    const raw = [
      "{",
      '  "dependencies": {',
      '    "stripe": "1.0.0"',
      "  },",
      '  "devDependencies": {',
      '    "stripe": "1.0.0"',
      "  }",
      "}",
    ].join("\n");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-span-manifest-"));
    await fs.writeFile(path.join(root, "package.json"), raw, "utf8");

    const findings = (
      await detectTypeScriptPatternsFromDependencyManifests(root)
    ).filter((finding) => finding.name === "stripe");

    expect(
      findings.map((finding) => [
        finding.location.startLine,
        finding.location.endLine,
      ]),
    ).toEqual([
      [3, 3],
      [6, 6],
    ]);

    const components = classifyRawFindings(findings);
    expect(components).toHaveLength(1);
    expect(
      components[0]?.sourceLocations.map((loc) => [
        loc.startLine,
        loc.endLine,
      ]),
    ).toEqual([
      [3, 3],
      [6, 6],
    ]);
  });
});
