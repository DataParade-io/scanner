import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";
import {
  deriveFromPatterns,
  loadDataActionRuleCatalog,
  mergeAssignmentsOntoComponents,
  readDataActions,
  runDataActionPhase,
} from "../../../src/data-actions";
import type { DataAction } from "../../../src/data-actions";

function makeFile(
  filePath: string,
  content: string,
  language: FileInfo["language"] = "typescript",
): FileInfo {
  return {
    path: filePath,
    name: filePath.split("/").pop() ?? filePath,
    content,
    language,
    size: content.length,
  };
}

function makeAsset(
  id: string,
  filePath: string,
  overrides: Partial<DetectedComponent> = {},
): DetectedComponent {
  return {
    id,
    name: id,
    type: "asset",
    subType: "api",
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [
      { filePath, startLine: 1, endLine: 500 },
    ],
    properties: {},
    ...overrides,
  };
}

function verbs(component: DetectedComponent): DataAction[] {
  return readDataActions(component).map((a) => a.action).sort() as DataAction[];
}

function hasAsserted(component: DetectedComponent, action: DataAction): boolean {
  return readDataActions(component).some(
    (a) => a.action === action && (a.status ?? "asserted") === "asserted",
  );
}

describe("deriveFromPatterns", () => {
  const catalog = loadDataActionRuleCatalog();

  describe("kill-switch", () => {
    it("emits nothing when enabled=false", () => {
      const asset = makeAsset("app", "log.ts");
      const file = makeFile(
        "log.ts",
        'logger.info({ email: "a@b.com" });\n',
      );
      const proposed = deriveFromPatterns([asset], [file], { enabled: false });
      expect(proposed.size).toBe(0);
    });
  });

  describe("log (PII co-occurrence)", () => {
    it("assigns log when logger and email share a line", () => {
      const asset = makeAsset("logger-api", "log.ts");
      const file = makeFile(
        "log.ts",
        [
          'logger.info({ event: "signup", email });',
          'logger.error({ reason, ssn });',
          'logger.debug({ phone });',
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
      const log = readDataActions(asset).find((a) => a.action === "log");
      expect(Array.isArray(log?.evidence)).toBe(true);
    });

    it("does not assign log for logger without PII on the line", () => {
      const asset = makeAsset("logger-api", "log.ts");
      const file = makeFile(
        "log.ts",
        'logger.info({ event: "heartbeat", ok: true });\n',
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(false);
    });

    it("assigns log for console.error with password token", () => {
      const asset = makeAsset("cli", "cli.ts");
      const file = makeFile(
        "cli.ts",
        'console.error("bad password for user");\n',
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
    });
  });

  describe("transform", () => {
    it("assigns transform for createHash", () => {
      const asset = makeAsset("hasher", "transform.ts");
      const file = makeFile(
        "transform.ts",
        'return createHash("sha256").update(email).digest("hex");\n',
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });

    it("assigns transform for anonymize helper", () => {
      const asset = makeAsset("anon", "transform.ts");
      const file = makeFile(
        "transform.ts",
        "export function anonymizeRecord(record) { return { ageBucket: \"x\" }; }\n",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });

    it("assigns transform for aggregatePurchases", () => {
      const asset = makeAsset("agg", "transform.ts");
      const file = makeFile(
        "transform.ts",
        "export function aggregatePurchases(amounts) { return amounts.reduce((s,n)=>s+n,0); }\n",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });
  });

  describe("generate", () => {
    it("assigns generate for score/infer/derive helpers", () => {
      const asset = makeAsset("risk", "generate.ts");
      const file = makeFile(
        "generate.ts",
        [
          "export function scoreUser(f) { return 1; }",
          "export function inferRisk(email) { return \"low\"; }",
          "export function deriveProfileField(a,b) { return a+b; }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "generate")).toBe(true);
    });
  });

  describe("use", () => {
    it("assigns use for approve/selectPlan/isAdult decisions", () => {
      const asset = makeAsset("decider", "use.ts");
      const file = makeFile(
        "use.ts",
        [
          "export function approveOrder(b,p) { return b>=p; }",
          "export function selectPlan(tier) { return tier; }",
          "export function isAdult(age) { return age>=18; }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "use")).toBe(true);
    });
  });

  describe("combine", () => {
    it("assigns combine for merge/join/enrich", () => {
      const asset = makeAsset("crm-sync", "combine.ts");
      const file = makeFile(
        "combine.ts",
        [
          "export function mergeProfile(a,b) { return { ...a, ...b }; }",
          "export function joinOrdersWithUsers(u,o) { return o; }",
          "export function enrichWithSegment(u,t) { return { ...u, ...t }; }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "combine")).toBe(true);
    });
  });

  describe("collect", () => {
    it("assigns collect for geolocation", () => {
      const asset = makeAsset("geo", "collect.ts");
      const file = makeFile(
        "collect.ts",
        "navigator.geolocation.getCurrentPosition((pos) => {});\n",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "collect")).toBe(true);
    });

    it("assigns collect for signup form post", () => {
      const asset = makeAsset("signup", "collect.ts");
      const file = makeFile(
        "collect.ts",
        'app.post("/signup", (req, res) => { const email = req.body.email; });\n',
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "collect")).toBe(true);
    });

    it("assigns collect for analytics SDK", () => {
      const asset = makeAsset("segment", "collect.ts");
      asset.type = "third_party";
      asset.subType = "analytics";
      const file = makeFile(
        "collect.ts",
        'analytics.load("KEY"); analytics.track("page_view", {});\n',
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "collect")).toBe(true);
    });
  });

  describe("display", () => {
    it("assigns display for res.send / renderEmail / showSsn", () => {
      const asset = makeAsset("ui", "display.ts");
      const file = makeFile(
        "display.ts",
        [
          "res.send(`<p>Welcome ${email}</p>`);",
          "export function renderEmailPage(email, res) { res.send(email); }",
          "export function showSsnLast4(ssn, res) { res.send(ssn); }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "display")).toBe(true);
    });
  });

  describe("delete", () => {
    it("assigns delete for app.delete and erase/purge/TTL", () => {
      const asset = makeAsset("users-api", "delete.ts");
      const file = makeFile(
        "delete.ts",
        [
          'app.delete("/users/:id", (req, res) => { userStore.erase(req.params.id); });',
          "export function purgeExpiredSessions() { return userStore.purgeExpired(); }",
          "export const RETENTION_TTL_DAYS = 30;",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "delete")).toBe(true);
    });
  });

  describe("store (pattern)", () => {
    it("assigns store for INSERT / save / putObject", () => {
      const asset = makeAsset("repo", "db.ts");
      const file = makeFile(
        "db.ts",
        [
          'await db.query("INSERT INTO users (email) VALUES ($1)", [email]);',
          "await userRepo.save(user);",
          "await s3.putObject({ Bucket: \"b\", Key: \"k\", Body: body });",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "store")).toBe(true);
    });
  });

  describe("relay corroboration", () => {
    it("asserts relay with corroboration for createProxyMiddleware", () => {
      const asset = makeAsset("edge-proxy", "relay.ts");
      const file = makeFile(
        "relay.ts",
        'const billingProxy = createProxyMiddleware({ target: "https://billing.internal" });\n',
      );
      runDataActionPhase([asset], [], [file]);
      const relay = readDataActions(asset).find((a) => a.action === "relay");
      expect(relay?.status).toBe("asserted");
      expect(relay?.evidence).toMatchObject({
        kind: "pattern_rule",
        corroboration: expect.stringMatching(/proxy/i),
      });
    });

    it("asserts relay for passthroughGateway / forwardWebhook", () => {
      const asset = makeAsset("gw", "relay.ts");
      const file = makeFile(
        "relay.ts",
        [
          "export function passthroughGateway(req) { return { method: req.method }; }",
          "export function forwardWebhook(payload, url) { return fetch(url); }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "relay")).toBe(true);
    });
  });

  describe("DA-1 / attachment", () => {
    it("does not attach pattern verbs to actors", () => {
      const actor: DetectedComponent = {
        id: "user",
        name: "User",
        type: "actor",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [{ filePath: "log.ts", startLine: 1, endLine: 10 }],
        properties: {},
      };
      const file = makeFile("log.ts", 'logger.info({ email });\n');
      runDataActionPhase([actor], [], [file]);
      expect(actor.properties.dataActions).toBeUndefined();
    });

    it("merges pattern verbs with topology store without collapse", () => {
      const asset = makeAsset("checkout", "app.ts", { subType: "database" });
      const file = makeFile(
        "app.ts",
        [
          'logger.info({ email });',
          "export function mergeProfile(a,b) { return { ...a, ...b }; }",
        ].join("\n"),
      );
      runDataActionPhase([asset], [], [file]);
      expect(verbs(asset)).toEqual(
        expect.arrayContaining(["store", "log", "combine"]),
      );
    });
  });

  describe("catalog rules smoke", () => {
    it("every loaded rule has at least one pattern", () => {
      expect(catalog.rules.every((r) => r.patterns.length > 0)).toBe(true);
    });

    it("can apply a single rule in isolation via options.rules", () => {
      const rule = catalog.rules.find((r) => r.id === "da-transform-hash-js");
      expect(rule).toBeDefined();
      const asset = makeAsset("h", "t.ts");
      const file = makeFile("t.ts", 'createHash("sha256");\n');
      const proposed = deriveFromPatterns([asset], [file], {
        rules: [rule!],
        enabled: true,
      });
      mergeAssignmentsOntoComponents([asset], proposed);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });
  });

  describe("language families (fixture + breadth)", () => {
    it("does not apply JS-only proxy rules to a Python file", () => {
      const asset = makeAsset("svc", "proxy.py");
      const file = makeFile(
        "proxy.py",
        'createProxyMiddleware({ target: "https://x" });\n',
        "python",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "relay")).toBe(false);
    });

    it("PHP error_log + email => log", () => {
      const asset = makeAsset("signup-logger", "CheckoutController.php");
      const file = makeFile(
        "CheckoutController.php",
        "error_log('signup email=' . $email);\n",
        "php",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
    });

    it("Python logger.info + email => log; FastAPI delete => delete", () => {
      const asset = makeAsset("api", "app.py");
      const file = makeFile(
        "app.py",
        [
          'logger.info("signup email=%s", email)',
          '@app.delete("/users/{user_id}")',
          'cur.execute("DELETE FROM users WHERE id = %s", (user_id,))',
        ].join("\n"),
        "python",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
      expect(hasAsserted(asset, "delete")).toBe(true);
    });

    it("Java @DeleteMapping and MessageDigest => delete + transform", () => {
      const asset = makeAsset("repo", "UserController.java");
      const file = makeFile(
        "UserController.java",
        [
          '@DeleteMapping("/users/{id}")',
          'MessageDigest.getInstance("SHA-256");',
        ].join("\n"),
        "java",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "delete")).toBe(true);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });

    it("C# HttpDelete and SHA256 => delete + transform", () => {
      const asset = makeAsset("api", "UsersController.cs");
      const file = makeFile(
        "UsersController.cs",
        ["[HttpDelete]", "SHA256.HashData(bytes);"].join("\n"),
        "csharp",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "delete")).toBe(true);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });

    it("Go reverse proxy and slog with email => relay + log", () => {
      const asset = makeAsset("gw", "proxy.go");
      const file = makeFile(
        "proxy.go",
        [
          "proxy := httputil.NewSingleHostReverseProxy(target)",
          'slog.Info("user email", "email", email)',
        ].join("\n"),
        "go",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "relay")).toBe(true);
      expect(hasAsserted(asset, "log")).toBe(true);
    });

    it("Terraform aws_s3_bucket => store; api gateway => asserted relay", () => {
      const asset = makeAsset("stack", "main.tf", { subType: "application" });
      const file = makeFile(
        "main.tf",
        [
          'resource "aws_s3_bucket" "data" { bucket = "data" }',
          'resource "aws_api_gateway_rest_api" "api" { name = "api" }',
        ].join("\n"),
        "terraform",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "store")).toBe(true);
      expect(hasAsserted(asset, "relay")).toBe(true);
    });

    it("Rust tracing info! with email => log; Sha256 => transform", () => {
      const asset = makeAsset("svc", "main.rs");
      const file = makeFile(
        "main.rs",
        ['info!("email={}", email);', "let digest = Sha256::digest(data);"].join(
          "\n",
        ),
        "rust",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
      expect(hasAsserted(asset, "transform")).toBe(true);
    });

    it("C++ spdlog with email => log", () => {
      const asset = makeAsset("svc", "main.cpp");
      const file = makeFile(
        "main.cpp",
        'SPDLOG_INFO("email={}", email);\n',
        "cpp",
      );
      runDataActionPhase([asset], [], [file]);
      expect(hasAsserted(asset, "log")).toBe(true);
    });
  });
});
