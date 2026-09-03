import type { FileInfo } from "../../../../src/core/types/file";
import { detectRubyPatterns } from "../../../../src/analyzers/ruby/detector";

function makeRubyFile(content: string, path = "app.rb"): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "ruby",
    size: content.length,
  };
}

describe("Ruby analyzer patterns", () => {
  it("detects Rails routes only in config/routes.rb context", () => {
    const routesContent = [
      "Rails.application.routes.draw do",
      '  get "/customers", to: "customers#index"',
      '  post "/charges", to: "charges#create"',
      "  resources :invoices",
      "  root \"home#index\"",
      "end",
      "",
    ].join("\n");

    const routes = detectRubyPatterns(
      makeRubyFile(routesContent, "config/routes.rb"),
    ).filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual(
      expect.arrayContaining([
        "GET /customers",
        "POST /charges",
        "GET /",
      ]),
    );
    expect(routes.some((r) => r.name.includes("/invoices"))).toBe(true);
    expect(routes[0].properties.framework).toBe("rails");

    // Drawn route files under config/routes/ also count.
    const drawn = detectRubyPatterns(
      makeRubyFile('get "/api/health", to: "health#show"', "config/routes/api.rb"),
    ).filter((f) => f.pattern === "express_route");
    expect(drawn.map((r) => r.name)).toContain("GET /api/health");

    // Same DSL outside routes context must not fire.
    const elsewhere = detectRubyPatterns(
      makeRubyFile('get "/customers", to: "customers#index"', "app/helpers/x.rb"),
    ).filter((f) => f.pattern === "express_route");
    expect(elsewhere).toEqual([]);
  });

  it("detects Sinatra routes when sinatra is required", () => {
    const content = [
      'require "sinatra"',
      "",
      'get "/health" do',
      '  "ok"',
      "end",
      "",
      'post "/webhooks" do',
      "  status 204",
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(makeRubyFile(content, "app.rb"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /webhooks",
    ]);
    expect(routes[0].properties.framework).toBe("sinatra");
  });

  it("detects ActiveRecord and Faraday from constants without require", () => {
    const model = [
      "class User < ApplicationRecord",
      "  def self.active",
      "    where(active: true)",
      "  end",
      "end",
      "",
    ].join("\n");

    const modelFindings = detectRubyPatterns(
      makeRubyFile(model, "app/models/user.rb"),
    );
    expect(
      modelFindings.some(
        (f) =>
          f.pattern === "database_connection" &&
          (f.name === "active_record" || f.properties.client === "active_record"),
      ),
    ).toBe(true);

    const service = [
      "class BillingClient",
      "  def charge",
      '    Faraday.get("https://api.stripe.com/v1/charges")',
      "  end",
      "end",
      "",
    ].join("\n");

    const apiFindings = detectRubyPatterns(
      makeRubyFile(service, "app/services/billing_client.rb"),
    ).filter((f) => f.pattern === "external_api_call");

    expect(apiFindings.length).toBeGreaterThan(0);
    expect(
      apiFindings.some((a) => String(a.properties.url ?? "").includes("stripe.com")),
    ).toBe(true);
  });

  it("detects ENV and Devise auth signals", () => {
    const content = [
      'key = ENV["DATABASE_URL"]',
      'token = ENV.fetch("STRIPE_SECRET")',
      "Devise::SessionsController",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(makeRubyFile(content, "config/initializers/devise.rb"));

    const envs = findings.filter((f) => f.pattern === "env_variable");
    expect(envs.map((e) => e.properties.key).sort()).toEqual([
      "DATABASE_URL",
      "STRIPE_SECRET",
    ]);

    const auth = findings.filter((f) => f.pattern === "auth_middleware");
    expect(auth.some((a) => a.name === "devise")).toBe(true);
  });

  it("does not treat non-routes get as Rails routes without draw context", () => {
    const content = [
      "module Helpers",
      '  def get(path) = path',
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(makeRubyFile(content, "lib/helpers.rb"));
    expect(findings.filter((f) => f.pattern === "express_route")).toEqual([]);
  });

  it("detects elasticsearch, trilogy, and DATABASE_URL connection strings", () => {
    const es = [
      'require "elasticsearch"',
      "",
      "client = Elasticsearch::Client.new",
      "",
    ].join("\n");
    expect(
      detectRubyPatterns(makeRubyFile(es, "search.rb")).some(
        (f) => f.pattern === "database_connection" && f.name === "elasticsearch",
      ),
    ).toBe(true);

    const url = [
      'url = "postgres://localhost/app"',
      'other = "mysql2://db/app"',
      "",
    ].join("\n");
    const urlFindings = detectRubyPatterns(
      makeRubyFile(url, "config/initializers/db.rb"),
    ).filter((f) => f.pattern === "database_connection");
    expect(
      urlFindings.some(
        (d) =>
          d.properties.client === "database_url" &&
          d.properties.driver === "postgres",
      ),
    ).toBe(true);
  });

  it("detects typhoeus, stripe, rodauth, and functions_framework", () => {
    const http = [
      'require "typhoeus"',
      "",
      'Typhoeus.get("https://api.example.com/v1/items")',
      "",
    ].join("\n");
    expect(
      detectRubyPatterns(makeRubyFile(http, "client.rb")).some(
        (f) => f.pattern === "external_api_call" && f.name === "typhoeus_call",
      ),
    ).toBe(true);

    const stripe = [
      'require "stripe"',
      "",
      "Stripe::Customer.create(email: email)",
      "",
    ].join("\n");
    expect(
      detectRubyPatterns(makeRubyFile(stripe, "billing.rb")).some(
        (f) => f.pattern === "external_api_call" && f.name === "stripe_call",
      ),
    ).toBe(true);

    const auth = [
      'require "rodauth"',
      "",
      "class App < Roda",
      "  plugin :rodauth",
      "end",
      "",
    ].join("\n");
    expect(
      detectRubyPatterns(makeRubyFile(auth, "app.rb")).some(
        (f) => f.pattern === "auth_middleware" && f.name === "rodauth",
      ),
    ).toBe(true);

    const ff = [
      'require "functions_framework"',
      "",
      'FunctionsFramework.http("hello") do |_request|',
      '  "ok"',
      "end",
      "",
    ].join("\n");
    expect(
      detectRubyPatterns(makeRubyFile(ff, "app.rb")).some(
        (f) => f.pattern === "lambda_handler" && f.name === "functions_framework",
      ),
    ).toBe(true);
  });

  it("detects grpc service stubs when grpc is required", () => {
    const content = [
      'require "grpc"',
      "",
      "class Greeter::Service < GRPC::GenericService",
      "end",
      "",
    ].join("\n");
    const routes = detectRubyPatterns(makeRubyFile(content, "greeter_services.rb")).filter(
      (f) => f.pattern === "express_route",
    );
    expect(routes.some((r) => r.properties.framework === "grpc")).toBe(true);
  });
});
