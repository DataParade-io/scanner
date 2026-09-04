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
  it("detects ActiveRecord models in app/models", () => {
    const content = "class User < ActiveRecord::Base\nend\n";
    const findings = detectRubyPatterns(makeRubyFile(content));

    const models = findings.filter((f) => f.pattern === "database_connection");
    expect(models.some((m) => m.name === "User")).toBe(true);
    expect(models.find((m) => m.name === "User")?.properties.client).toBe("User");
    expect(models.find((m) => m.name === "User")?.properties.databaseType).toBeUndefined();
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

  it("detects session_store auth in initializers", () => {
    const content = [
      "Rails.application.config.session_store :cookie_store, key: '_forum_session'",
      "",
    ].join("\n");

    const findings = detectRubyPatterns(
      makeRubyFile(content, "config/initializers/100-session_store.rb"),
    );
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.some((a) => a.properties.strategy === "session_cookie")).toBe(true);
  });

  it("detects Redis cache with componentSubType cache", () => {
    const content = [
      "redis = Redis.new",
      "redis.ping",
      "",
    ].join("\n");

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

    expect(dbs.some((d) => d.properties.databaseType === "postgres")).toBe(true);
    expect(dbs.some((d) => d.properties.client === "discourse_development")).toBe(
      true,
    );
  });

  it("detects service classes under app/services", () => {
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

    expect(services.some((s) => s.name === "PaymentProcessingService")).toBe(true);
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

    expect(findings.filter((f) => f.pattern === "database_connection")).toHaveLength(
      0,
    );
  });
});
