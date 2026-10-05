import type { FileInfo } from "../../../../src/core/types/file";
import { detectRubyPatterns } from "../../../../src/analyzers/ruby/detector";

function makeRubyFile(content: string, path = "app/models/user.rb"): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "ruby",
    size: content.length,
  };
}

function makeYamlFile(content: string, path: string): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "yaml",
    size: content.length,
  };
}

describe("Ruby analyzer patterns", () => {
  it("keeps ActiveRecord models as evidence without emitting database components", () => {
    const content = [
      "class User < ActiveRecord::Base",
      "end",
      "",
      "module Searchable",
      "  extend ActiveSupport::Concern",
      "end",
      "",
    ].join("\n");
    const findings = detectRubyPatterns(makeRubyFile(content));

    const models = findings.filter((f) => f.pattern === "database_connection");
    expect(models).toHaveLength(0);
    expect(findings.filter((f) => f.pattern === "service_actor")).toHaveLength(
      0,
    );
    expect(
      findings.filter((f) => f.pattern === "web_actor").map((f) => f.name),
    ).toEqual(["Customer"]);
  });

  it("detects Rails routes in config/routes.rb", () => {
    const content = [
      "Rails.application.routes.draw do",
      '  get "session" => "session#create"',
      '  post "session" => "session#create"',
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "config/routes.rb"),
    );
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET session",
      "POST session",
    ]);
    expect(routes[0].properties.framework).toBe("rails");
  });

  it("groups Rails route DSL declarations as API findings", () => {
    const content = [
      "Rails.application.routes.draw do",
      "  resources :users",
      "  resource :profile",
      "  namespace :api do",
      "    scope '/v1' do",
      "      member do",
      "      end",
      "      collection do",
      "      end",
      "    end",
      "  end",
      "  mount Sidekiq::Web => '/sidekiq'",
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "config/routes.rb"),
    );
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((route) => route.name)).toEqual([
      "API",
      "API",
      "API",
      "API",
      "API",
      "API",
      "API",
    ]);
    expect(routes.map((route) => route.properties.routeKind)).toEqual([
      "resources",
      "resource",
      "namespace",
      "scope",
      "member",
      "collection",
      "mount",
    ]);
    expect(
      routes.every((route) => route.properties.framework === "rails"),
    ).toBe(true);
  });

  it("detects session_store auth in initializers", () => {
    const content = [
      "Rails.application.config.session_store :cookie_store, key: '_forum_session'",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "config/initializers/100-session_store.rb"),
    );
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.some((a) => a.properties.strategy === "session_cookie")).toBe(
      true,
    );
  });

  it("detects concrete Ruby authentication integrations", () => {
    const content = [
      "devise :database_authenticatable",
      "request.env['warden'].authenticate!",
      "OmniAuth.config.allowed_request_methods = [:post]",
      "JWT.decode(token, secret)",
      "BCrypt::Password.new(password_digest)",
      "session[:user_id] = user.id",
      "request.headers['X-API-Key']",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "app/controllers/sessions_controller.rb"),
    );
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.map((finding) => finding.name)).toEqual(
      expect.arrayContaining([
        "devise",
        "warden",
        "omniauth",
        "jwt",
        "bcrypt",
        "rails_session",
        "api_key",
      ]),
    );
  });

  it("does not treat current_user as authentication evidence", () => {
    const content = [
      "class ProfilesController < ApplicationController",
      "  def show",
      "    render json: current_user",
      "  end",
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "app/controllers/profiles_controller.rb"),
    );

    expect(
      findings.filter((f) => f.pattern === "auth_middleware"),
    ).toHaveLength(0);
  });

  it("detects Redis cache with componentSubType cache", () => {
    const content = ["redis = Redis.new", "redis.ping", ""].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "config/initializers/001-redis.rb"),
    );
    const cache = findings.filter(
      (f) => f.properties.componentSubType === "cache",
    );

    expect(cache.length).toBeGreaterThan(0);
    expect(cache[0].properties.databaseType).toBe("redis");
  });

  it("detects database.yml adapter when ingested as yaml", () => {
    const content = [
      "development:",
      "  adapter: postgresql",
      "  database: discourse_development",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeYamlFile(content, "config/database.yml"),
    );
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.some((d) => d.properties.databaseType === "postgres")).toBe(
      true,
    );
    expect(
      dbs.some((d) => d.properties.client === "discourse_development"),
    ).toBe(true);
  });

  it("does not turn ordinary service classes or concerns into components", () => {
    const content = [
      "class PaymentProcessingService",
      "  def call",
      "  end",
      "end",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "app/services/payment_processing_service.rb"),
    );
    const services = findings.filter(
      (f) => f.properties.componentSubType === "service",
    );

    expect(services).toHaveLength(0);

    const concernFindings = detectRubyPatterns(
      makeRubyFile(
        "module PaymentWorkflow\n  extend ActiveSupport::Concern\nend\n",
        "app/models/concerns/payment_workflow.rb",
      ),
    );
    expect(
      concernFindings.filter(
        (f) => f.properties.componentSubType === "service",
      ),
    ).toHaveLength(0);
    expect(
      concernFindings.filter((f) => f.pattern === "database_connection"),
    ).toHaveLength(0);
  });

  it("detects external HTTP clients without manifest evidence", () => {
    const content = [
      "Net::HTTP.get(URI('https://net.example.test/users'))",
      "HTTParty.get('https://httparty.example.test/users')",
      "Faraday.get('https://faraday.example.test/users')",
      "RestClient.post('https://rest-client.example.test/users', payload)",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "app/services/user_sync.rb"),
    );
    const externalApis = findings.filter(
      (f) => f.pattern === "external_api_call",
    );

    expect(externalApis.map((finding) => finding.properties.client)).toEqual([
      "net_http",
      "httparty",
      "faraday",
      "rest_client",
    ]);
    expect(externalApis.map((finding) => finding.properties.url)).toEqual([
      "https://net.example.test/users",
      "https://httparty.example.test/users",
      "https://faraday.example.test/users",
      "https://rest-client.example.test/users",
    ]);
  });

  it("does not create a topology component for an ungrounded HTTP client", () => {
    const findings = detectRubyPatterns(
      makeRubyFile(
        "HTTParty.get(dynamic_endpoint)\n",
        "app/services/user_sync.rb",
      ),
    );

    expect(
      findings.filter((finding) => finding.pattern === "external_api_call"),
    ).toHaveLength(0);
  });

  it("detects User actor model for customer gold", () => {
    const content = "class User < ActiveRecord::Base\nend\n";
    const findings = detectRubyPatterns(makeRubyFile(content));

    const actors = findings.filter((f) => f.pattern === "web_actor");
    expect(actors.some((a) => a.name === "Customer")).toBe(true);
  });

  it("does not emit AR models from spec paths", () => {
    const content = "class User < ActiveRecord::Base\nend\n";
    const findings = detectRubyPatterns(
      makeRubyFile(content, "spec/models/user_spec.rb"),
    );

    expect(
      findings.filter((f) => f.pattern === "database_connection"),
    ).toHaveLength(0);
  });
});
