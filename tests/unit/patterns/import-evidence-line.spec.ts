import type { FileInfo } from "../../../src/core/types/file";
import { detectThirdPartyServicesFromImports } from "../../../src/patterns/engine";
import { detectExternalApiCalls } from "../../../src/analyzers/typescript/third-party-detection";
import { buildCodeModel } from "../../../src/analyzers/typescript/parser";
import { detectPythonPatterns } from "../../../src/analyzers/python/detector";

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
