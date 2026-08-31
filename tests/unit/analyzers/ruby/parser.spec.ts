import type { FileInfo } from "../../../../src/core/types/file";
import { parseRubySourceFile } from "../../../../src/analyzers/ruby/parser";

function createRubyFile(content: string, path = "app.rb"): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "ruby",
    size: content.length,
  };
}

describe("Ruby parser - parseRubySourceFile", () => {
  it("indexes require imports, classes/modules, defs, and calls", () => {
    const content = [
      'require "faraday"',
      'require_relative "billing/client"',
      "",
      "module Billing",
      "  class Client",
      "    def charge(amount)",
      '      Faraday.get("https://api.stripe.com/v1/charges")',
      "    end",
      "",
      "    def self.configure",
      '      ENV.fetch("STRIPE_SECRET")',
      "    end",
      "  end",
      "end",
      "",
    ].join("\n");

    const result = parseRubySourceFile(createRubyFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.imports.map((i) => i.path).sort()).toEqual([
      "billing/client",
      "faraday",
    ]);
    expect(result.imports.find((i) => i.path === "billing/client")?.isRelative).toBe(
      true,
    );

    expect(result.types.some((t) => t.name === "Billing" && t.kind === "module")).toBe(
      true,
    );
    expect(result.types.some((t) => t.name === "Client" && t.kind === "class")).toBe(
      true,
    );

    expect(result.functions.some((fn) => fn.name === "charge")).toBe(true);
    expect(result.functions.some((fn) => fn.name === "configure")).toBe(true);
    expect(result.calls.some((c) => c.callee.includes("Faraday") || c.callee.includes("get"))).toBe(
      true,
    );
  });

  it("blanks # comments while preserving URL strings", () => {
    const content = [
      '# Faraday.get("https://old.example.com")',
      'Faraday.get("https://live.example.com")',
      "",
    ].join("\n");

    const result = parseRubySourceFile(createRubyFile(content));
    expect(result.strippedContent).not.toContain("old.example.com");
    expect(result.strippedContent).toContain("https://live.example.com");
  });
});
