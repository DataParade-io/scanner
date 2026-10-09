import type { FileInfo } from "../../../../src/core/types/file";
import { detectCSharpPatterns } from "../../../../src/analyzers/csharp/detector";
import { runAnalyzers } from "../../../../src/analyzers/registry";

function makeCSharpFile(content: string, path = "Program.cs"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "csharp",
    size: content.length,
  };
}

describe("C# analyzer patterns", () => {
  it("detects controller actions and expands the [controller] route token", () => {
    const content = [
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "[ApiController]",
      '[Route("api/[controller]")]',
      "public class UsersController : ControllerBase",
      "{",
      '    [HttpGet("{id}")]',
      "    public IActionResult GetUser(int id) => Ok();",
      "",
      "    [HttpPost]",
      "    public IActionResult CreateUser() => Ok();",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Controllers/UsersController.cs"),
    );
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET api/Users/{id}",
      "POST api/Users",
    ]);
    expect(routes[0].properties.framework).toBe("aspnet_core_mvc");
    expect(routes[0].properties.controller).toBe("UsersController");
    expect(routes[0].properties.handlerType).toBe("controller_action");
  });

  it("keeps an absolute action template off the controller prefix", () => {
    const content = [
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "[ApiController]",
      '[Route("v{v:apiVersion}/account")]',
      "public class AccountController : ControllerBase",
      "{",
      '    [HttpPost("/account/oauth2/access_token")]',
      "    public IActionResult Token() => Ok();",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(makeCSharpFile(content));
    const routes = findings.filter((f) => f.pattern === "express_route");
    expect(routes.map((route) => route.name)).toEqual([
      "POST account/oauth2/access_token",
    ]);
  });

  it("detects minimal API route registrations", () => {
    const content = [
      "var builder = WebApplication.CreateBuilder(args);",
      "var app = builder.Build();",
      "",
      'app.MapGet("/health", () => Results.Ok());',
      'app.MapPost("/orders", (Order order) => Results.Created());',
      "",
      "app.Run();",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(makeCSharpFile(content));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /orders",
    ]);
    expect(routes[0].properties.handlerType).toBe("minimal_api");
  });

  it("detects EF Core and Npgsql as database_connection findings", () => {
    const content = [
      "using Microsoft.EntityFrameworkCore;",
      "",
      "public class AppDbContext : DbContext",
      "{",
      "    protected override void OnConfiguring(DbContextOptionsBuilder options)",
      "    {",
      '        options.UseNpgsql("Host=localhost;Database=app");',
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Data/AppDbContext.cs"),
    );
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.properties.client)).toContain(
      "entity_framework_core",
    );
    expect(dbs.map((d) => d.properties.databaseType)).toContain("postgres");
    expect(dbs.map((d) => d.name)).toContain("postgres");
  });

  it("detects ServiceStack request DTO routes and ignores MVC controllers", () => {
    const content = [
      "using ServiceStack;",
      "using Microsoft.AspNetCore.Mvc;",
      "",
      '[Route("/todos", "GET")]',
      "public class QueryTodos : IGet",
      "{",
      "}",
      "",
      '[Route("/hello/{Name}")]',
      "public class Hello : IGet",
      "{",
      "}",
      "",
      "[ApiController]",
      '[Route("api/[controller]")]',
      "public class UsersController : ControllerBase",
      "{",
      '    [HttpGet("{id}")]',
      "    public IActionResult Get(int id) => Ok();",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "ServiceModel/Todos.cs"),
    );
    const serviceStack = findings.filter(
      (f) =>
        f.pattern === "express_route" &&
        f.properties.framework === "servicestack",
    );

    expect(serviceStack.map((f) => f.name).sort()).toEqual([
      "GET /hello/{Name}",
      "GET /todos",
    ]);
    expect(serviceStack.map((f) => f.properties.requestType).sort()).toEqual([
      "Hello",
      "QueryTodos",
    ]);
    expect(
      findings.filter((f) => f.pattern === "express_route").map((f) => f.name),
    ).toContain("GET api/Users/{id}");
  });

  it("detects HttpClient calls and resolves the third-party service", () => {
    const content = [
      "using System.Net.Http;",
      "",
      "public class ChargeService",
      "{",
      "    private readonly HttpClient _client = new HttpClient();",
      "",
      "    public async Task Charge()",
      "    {",
      '        await _client.PostAsync("https://api.stripe.com/v1/charges", null);',
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Services/ChargeService.cs"),
    );
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    const stripeCall = apis.find(
      (f) => f.properties.url === "https://api.stripe.com/v1/charges",
    );
    expect(stripeCall).toBeDefined();
    expect(stripeCall?.properties.serviceName).toBe("stripe");
  });

  it("detects [Authorize] and JWT bearer configuration as auth_middleware", () => {
    const content = [
      "using Microsoft.AspNetCore.Authentication.JwtBearer;",
      "using Microsoft.AspNetCore.Authorization;",
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "[Authorize]",
      "public class SecureController : ControllerBase",
      "{",
      "    public void Configure(IServiceCollection services)",
      "    {",
      "        services.AddAuthentication().AddJwtBearer();",
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Controllers/SecureController.cs"),
    );
    const auth = findings.filter((f) => f.pattern === "auth_middleware");
    const names = auth.map((a) => a.name);

    expect(names).toContain("jwt_bearer");
    expect(names).toContain("authorize_attribute");
  });

  it("detects environment and configuration keys as env_variable findings", () => {
    const content = [
      "using System;",
      "",
      "public class Settings",
      "{",
      '    public string Key = Environment.GetEnvironmentVariable("API_KEY");',
      '    public string Db = builder.Configuration.GetConnectionString("Default");',
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Config/Settings.cs"),
    );
    const envs = findings.filter((f) => f.pattern === "env_variable");
    const keys = envs.map((e) => e.properties.key);

    expect(keys).toContain("API_KEY");
    expect(keys).toContain("Default");
  });

  it("detects Azure Functions handlers as lambda_handler findings", () => {
    const content = [
      "using Microsoft.Azure.Functions.Worker;",
      "",
      "public class OrderFunctions",
      "{",
      '    [Function("ProcessOrder")]',
      '    public void Run([QueueTrigger("orders")] string message)',
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Functions/OrderFunctions.cs"),
    );
    const handlers = findings.filter((f) => f.pattern === "lambda_handler");

    expect(handlers.length).toBe(1);
    expect(handlers[0].properties.functionName).toBe("ProcessOrder");
    expect(handlers[0].properties.framework).toBe("azure_functions");
  });

  it("ignores routes that only appear in comments", () => {
    const content = [
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "var app = builder.Build();",
      '// app.MapGet("/legacy", () => Results.Ok());',
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(makeCSharpFile(content));

    expect(findings.filter((f) => f.pattern === "express_route")).toEqual([]);
  });

  it("detects Microsoft.Identity.Web OAuth2 as auth_middleware", () => {
    const content = [
      "using Microsoft.Identity.Web;",
      "",
      "builder.Services.AddMicrosoftIdentityWebApp(builder.Configuration);",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "Program.cs"),
    );
    const authFindings = findings.filter(
      (f) => f.pattern === "auth_middleware",
    );

    expect(authFindings.length).toBeGreaterThanOrEqual(1);
    expect(authFindings[0].properties.strategy).toBe("oauth2");
    expect(authFindings[0].name).toBe("microsoft_identity_web");
  });

  it("detects GCP Cloud Functions .NET as lambda_handler", () => {
    // The detector matches typeNames appearing in a method's declaration line
    // (e.g. as a parameter type). IHttpFunction used as a parameter triggers detection.
    const content = [
      "using Google.Cloud.Functions.Framework;",
      "using Microsoft.AspNetCore.Http;",
      "",
      "public class HelloWorld",
      "{",
      "    public async Task HandleAsync(IHttpFunction ctx, HttpContext context)",
      "    {",
      '        await context.Response.WriteAsync("Hello World!");',
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectCSharpPatterns(
      makeCSharpFile(content, "HelloWorld.cs"),
    );
    const handlers = findings.filter((f) => f.pattern === "lambda_handler");

    expect(handlers.length).toBeGreaterThanOrEqual(1);
    expect(handlers[0].properties.framework).toBe("gcp_functions_dotnet");
  });

  it("returns no findings for a non-C# file", () => {
    const file: FileInfo = {
      path: "main.cpp",
      name: "main.cpp",
      content: "#include <crow.h>",
      language: "cpp",
      size: 17,
    };

    expect(detectCSharpPatterns(file)).toEqual([]);
  });

  it("applies a project global using to controllers in the same csproj", () => {
    const csproj: FileInfo = {
      path: "src/WebApi/WebApi.csproj",
      name: "WebApi.csproj",
      content: '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      language: "json",
      size: 48,
    };
    const globalUsings = makeCSharpFile(
      "global using Microsoft.AspNetCore.Mvc;\n",
      "src/WebApi/GlobalUsings.cs",
    );
    const controller = makeCSharpFile(
      [
        "namespace MyWarehouse.WebApi.API.V1;",
        "",
        "[ApiController]",
        '[Route("v{v:apiVersion}/products")]',
        "public class ProductController : ControllerBase",
        "{",
        '    [HttpGet("{id}")]',
        "    public IActionResult Get(int id) => Ok();",
        "}",
        "",
      ].join("\n"),
      "src/WebApi/API/V1/ProductController.cs",
    );
    const otherProject = makeCSharpFile(
      [
        "[ApiController]",
        '[Route("api/other")]',
        "public class OtherController : ControllerBase",
        "{",
        "    [HttpGet]",
        "    public IActionResult Get() => Ok();",
        "}",
        "",
      ].join("\n"),
      "src/Other/OtherController.cs",
    );

    const findings = runAnalyzers([
      csproj,
      globalUsings,
      controller,
      otherProject,
    ]);
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((route) => route.name)).toEqual([
      "GET v{v:apiVersion}/products/{id}",
    ]);
  });
});
