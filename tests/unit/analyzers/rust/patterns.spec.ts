import type { FileInfo } from "../../../../src/core/types/file";
import { detectRustPatterns } from "../../../../src/analyzers/rust/detector";

function makeRustFile(content: string, path = "main.rs"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "rust",
    size: content.length,
  };
}

describe("Rust analyzer patterns", () => {
  it("detects axum routes with HTTP method", () => {
    const content = [
      "use axum::Router;",
      "",
      "fn app() -> Router {",
      "    Router::new()",
      '        .get("/customers", list_customers)',
      '        .post("/charges", create_charge)',
      "}",
      "",
    ].join("\n");

    const findings = detectRustPatterns(makeRustFile(content, "routes.rs"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /customers",
      "POST /charges",
    ]);
    expect(routes[0].properties.framework).toBe("axum");
  });

  it("detects sqlx database connections from use imports", () => {
    const content = [
      "use sqlx::PgPool;",
      "",
      "async fn connect() -> PgPool {",
      '    PgPool::connect("postgres://localhost/app").await.unwrap()',
      "}",
      "",
    ].join("\n");

    const findings = detectRustPatterns(makeRustFile(content, "db.rs"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.some((d) => d.name === "sqlx")).toBe(true);
    expect(dbs.some((d) => d.properties.client === "sqlx_url")).toBe(true);
  });

  it("detects reqwest external API calls with a URL", () => {
    const content = [
      "use reqwest::Client;",
      "",
      "async fn fetch() {",
      "    let client = Client::new();",
      '    let _ = client.get("https://api.stripe.com/v1/charges").send().await;',
      "}",
      "",
    ].join("\n");

    const findings = detectRustPatterns(makeRustFile(content, "billing.rs"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(apis.length).toBeGreaterThan(0);
    expect(
      apis.some((a) => String(a.properties.url ?? "").includes("stripe.com")),
    ).toBe(true);
  });

  it("detects env::var reads", () => {
    const content = [
      "use std::env;",
      "",
      'let key = env::var("DATABASE_URL").unwrap();',
      'let token = env::var("STRIPE_SECRET").unwrap();',
      "",
    ].join("\n");

    const findings = detectRustPatterns(makeRustFile(content, "config.rs"));
    const envs = findings.filter((f) => f.pattern === "env_variable");

    expect(envs.map((e) => e.properties.key).sort()).toEqual([
      "DATABASE_URL",
      "STRIPE_SECRET",
    ]);
  });

  it("detects jsonwebtoken auth from a use import", () => {
    const content = [
      "use jsonwebtoken::{encode, decode, Header, Validation};",
      "",
      "fn sign(claims: Claims) {",
      "    encode(&Header::default(), &claims, &key).unwrap();",
      "}",
      "",
    ].join("\n");

    const findings = detectRustPatterns(makeRustFile(content, "auth.rs"));
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.map((a) => a.name)).toContain("jsonwebtoken");
  });

  it("detects tokio-postgres and elasticsearch database clients", () => {
    const pg = [
      "use tokio_postgres::NoTls;",
      "",
      "async fn connect() {",
      '    let _ = tokio_postgres::connect("host=localhost", NoTls).await;',
      "}",
      "",
    ].join("\n");
    const pgFindings = detectRustPatterns(makeRustFile(pg, "pg.rs")).filter(
      (f) => f.pattern === "database_connection",
    );
    expect(pgFindings.some((d) => d.name === "tokio_postgres")).toBe(true);

    const es = [
      "use elasticsearch::Elasticsearch;",
      "",
      "fn client() -> Elasticsearch {",
      "    Elasticsearch::new(transport)",
      "}",
      "",
    ].join("\n");
    const esFindings = detectRustPatterns(makeRustFile(es, "es.rs")).filter(
      (f) => f.pattern === "database_connection",
    );
    expect(esFindings.some((d) => d.name === "elasticsearch")).toBe(true);
  });

  it("detects ureq HTTP calls and oauth2 auth", () => {
    const http = [
      "use ureq;",
      "",
      "fn fetch() {",
      '    let _ = ureq::get("https://api.example.com/v1/items").call();',
      "}",
      "",
    ].join("\n");
    const apis = detectRustPatterns(makeRustFile(http, "http.rs")).filter(
      (f) => f.pattern === "external_api_call",
    );
    expect(apis.some((a) => a.name === "ureq_call")).toBe(true);

    const oauth = [
      "use oauth2::{AuthorizationCode, Client};",
      "",
      "fn exchange(code: AuthorizationCode) {",
      "    let _ = Client::exchange_code(code);",
      "}",
      "",
    ].join("\n");
    const auth = detectRustPatterns(makeRustFile(oauth, "oauth.rs")).filter(
      (f) => f.pattern === "auth_middleware",
    );
    expect(auth.some((a) => a.name === "oauth2")).toBe(true);
  });

  it("detects tonic gRPC service registration", () => {
    const content = [
      "use tonic::transport::Server;",
      "",
      "async fn serve() {",
      "    Server::builder()",
      "        .add_service(GreeterServer::new(svc))",
      "        .serve(addr)",
      "        .await;",
      "}",
      "",
    ].join("\n");

    const routes = detectRustPatterns(makeRustFile(content, "grpc.rs")).filter(
      (f) => f.pattern === "express_route",
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((r) => r.properties.framework === "tonic")).toBe(true);
  });
});
