import type { FileInfo } from "../../../../src/core/types/file";
import { parseRustSourceFile } from "../../../../src/analyzers/rust/parser";

function createRustFile(content: string, path = "main.rs"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "rust",
    size: content.length,
  };
}

describe("Rust parser - parseRustSourceFile", () => {
  it("indexes use imports, structs, functions, and calls", () => {
    const content = [
      "use axum::{routing::get, Router};",
      "use sqlx::PgPool;",
      "use reqwest::Client as HttpClient;",
      "",
      "struct AppState {",
      "    pool: PgPool,",
      "}",
      "",
      "impl AppState {",
      "    async fn health(&self) -> &'static str {",
      '        "ok"',
      "    }",
      "}",
      "",
      "async fn main() {",
      "    let client = HttpClient::new();",
      '    let _ = client.get("https://api.example.com/items").send().await;',
      "}",
      "",
    ].join("\n");

    const result = parseRustSourceFile(createRustFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.imports.map((i) => i.path).sort()).toEqual([
      "axum::Router",
      "axum::routing::get",
      "reqwest::Client",
      "sqlx::PgPool",
    ]);

    const reqwest = result.imports.find((i) => i.path === "reqwest::Client");
    expect(reqwest?.alias).toBe("HttpClient");

    expect(result.types.some((t) => t.name === "AppState" && t.kind === "struct")).toBe(
      true,
    );

    const health = result.functions.find((fn) => fn.name === "health");
    expect(health?.implType).toBe("AppState");

    expect(result.functions.some((fn) => fn.name === "main")).toBe(true);
    expect(result.calls.some((c) => c.callee.includes("get"))).toBe(true);
  });

  it("blanks comments while preserving string literals", () => {
    const content = [
      '// let _ = client.get("https://old.example.com");',
      '/* let _ = client.get("https://block.example.com"); */',
      'let _ = client.get("https://live.example.com");',
      "",
    ].join("\n");

    const result = parseRustSourceFile(createRustFile(content));
    expect(result.strippedContent).not.toContain("old.example.com");
    expect(result.strippedContent).not.toContain("block.example.com");
    expect(result.strippedContent).toContain("https://live.example.com");
  });
});
