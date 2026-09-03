import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";
import { resolveComponentForEvidence } from "../../../src/data-flow/component-evidence-resolution";
import { detectIntraComponentLineage } from "../../../src/data-flow/intra-component-lineage";
import {
  hasIntraComponentTransformationEvidence,
  inferFlowTypeFromSpan,
} from "../../../src/data-flow/transformation-patterns";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 0.9,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
    description: overrides.description,
    dataFlowIds: overrides.dataFlowIds,
  };
}

function makeFile(path: string, content: string): FileInfo {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    language: "go",
    size: content.length,
  };
}

describe("data-flow/intra-component-lineage", () => {
  describe("transformation gates", () => {
    it("accepts bcrypt password hashing spans", () => {
      const span = "hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)";
      const context = "func setValue(password string) {\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
      expect(inferFlowTypeFromSpan(span, context)).toBe("data_transfer");
    });

    it("accepts ORM model field declarations", () => {
      const span = "    email = models.EmailField(unique=True)";
      const context = "class User(models.Model):\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
      expect(inferFlowTypeFromSpan(span, context)).toBe("database_query");
    });

    it("accepts JWT signing spans", () => {
      const span = "token := jwt.Sign(claims, tokenKey)";
      const context = "func newAuthToken(tokenKey string) {\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });

    it("accepts route declaration spans with personal-data paths", () => {
      const span = "<route url=\"/V1/customers/me/password\" method=\"PUT\">";
      const context = "<routes>\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });

    it("accepts model association spans", () => {
      const span = "  has_many :sessions";
      const context = "class User < ActiveRecord::Base\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });

    it("accepts lookup query spans", () => {
      const span = "  user = User.find_by_email(email)";
      const context = "def lookup_user(email)\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });

    it("accepts module re-export spans", () => {
      const span = "export * from './services/auth'";
      const context = span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });

    it("accepts argon2 password hashing spans", () => {
      const span = "  hash = await argon2.hash(password)";
      const context = "async function setPassword(password) {\n" + span;
      expect(hasIntraComponentTransformationEvidence(span, context)).toBe(true);
    });
  });

  describe("component evidence resolution", () => {
    it("skips ambiguous equally tight component matches", () => {
      const evidence = { filePath: "core/auth.go", startLine: 10, endLine: 10 };
      const components = [
        makeComponent({
          id: "cmp_a",
          name: "Auth A",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/auth.go", startLine: 1, endLine: 20 },
          ],
        }),
        makeComponent({
          id: "cmp_b",
          name: "Auth B",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/auth.go", startLine: 1, endLine: 20 },
          ],
        }),
      ];

      expect(resolveComponentForEvidence(components, evidence)).toBeUndefined();
    });

    it("prefers the smallest overlapping component span", () => {
      const evidence = { filePath: "core/auth.go", startLine: 10, endLine: 10 };
      const components = [
        makeComponent({
          id: "cmp_wide",
          name: "Wide",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/auth.go", startLine: 1, endLine: 100 },
          ],
        }),
        makeComponent({
          id: "cmp_tight",
          name: "Tight",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/auth.go", startLine: 8, endLine: 12 },
          ],
        }),
      ];

      expect(resolveComponentForEvidence(components, evidence)?.id).toBe("cmp_tight");
    });
  });

  describe("detectIntraComponentLineage", () => {
    it("emits a self-loop flow for password bcrypt hashing", () => {
      const file = makeFile(
        "core/field_password.go",
        [
          "func setValue(password string) {",
          "  hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "auth_service",
          name: "Auth Service",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/field_password.go", startLine: 1, endLine: 3 },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows.every((flow) => flow.sourceComponentId === "auth_service")).toBe(true);
      expect(flows.every((flow) => flow.targetComponentId === "auth_service")).toBe(true);
      expect(flows[0]?.type).toBe("data_transfer");
      expect(flows[0]?.dataCategories).toContain("password");
      expect(flows[0]?.confidence).toBe(0.75);
    });

    it("emits a self-loop flow for ORM email field persistence", () => {
      const file: FileInfo = {
        path: "saleor/account/models.py",
        name: "models.py",
        language: "python",
        size: 0,
        content: [
          "class User(models.Model):",
          "    email = models.EmailField(unique=True)",
          "    name = models.CharField(max_length=255)",
        ].join("\n"),
      };
      file.size = file.content.length;

      const components = [
        makeComponent({
          id: "customer_actor",
          name: "Customer",
          type: "actor",
          subType: "customer",
          sourceLocations: [
            { filePath: "saleor/account/models.py", startLine: 1, endLine: 3 },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows.every((flow) => flow.sourceComponentId === "customer_actor")).toBe(true);
      expect(flows.every((flow) => flow.targetComponentId === "customer_actor")).toBe(true);
      expect(flows[0]?.type).toBe("database_query");
      expect(flows[0]?.dataCategories).toContain("email");
    });

    it("emits a self-loop flow for JWT signing with tokenKey", () => {
      const file = makeFile(
        "core/record_tokens.go",
        [
          "func newAuthToken(tokenKey string) {",
          "  claims := jwt.MapClaims{\"sub\": tokenKey}",
          "  token := jwt.Sign(claims, secret)",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "jwt_auth",
          name: "JWT Auth",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "core/record_tokens.go", startLine: 1, endLine: 4 },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      const selfLoop = flows.find(
        (flow) =>
          flow.sourceComponentId === "jwt_auth" &&
          flow.targetComponentId === "jwt_auth",
      );
      expect(selfLoop).toBeDefined();
      expect(selfLoop?.type).toBe("data_transfer");
    });

    it("skips spans with ambiguous component ownership", () => {
      const file = makeFile(
        "core/auth.go",
        "password := bcrypt.Hash(input.password)",
      );
      const components = [
        makeComponent({
          id: "cmp_a",
          name: "Auth A",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "core/auth.go", startLine: 1, endLine: 1 }],
        }),
        makeComponent({
          id: "cmp_b",
          name: "Auth B",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "core/auth.go", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows).toHaveLength(0);
    });

    it("emits one self-loop per enclosing scope (best evidence line)", () => {
      const file = makeFile(
        "core/auth.go",
        [
          "func hashPassword(password string) {",
          "  hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)",
          "}",
          "func verifyPassword(password string) {",
          "  ok := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "auth_service",
          name: "Auth Service",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "core/auth.go", startLine: 1, endLine: 6 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBe(2);
      const lines = flows.map((flow) => flow.sourceLocation?.startLine).sort();
      expect(new Set(lines).size).toBe(2);
    });

    it("emits a self-loop flow for route declaration in webapi.xml", () => {
      const file = makeFile(
        "app/code/Magento/Customer/etc/webapi.xml",
        [
          "<routes>",
          "  <route url=\"/V1/customers/me/password\" method=\"PUT\">",
          "    <service class=\"CustomerAccountManagement\" method=\"changePasswordById\"/>",
          "  </route>",
          "</routes>",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "customers_api",
          name: "CustomerWebapi",
          type: "asset",
          subType: "api",
          sourceLocations: [
            {
              filePath: "app/code/Magento/Customer/etc/webapi.xml",
              startLine: 2,
              endLine: 4,
            },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows[0]?.type).toBe("data_transfer");
    });

    it("emits a self-loop flow for session logout", () => {
      const file = makeFile(
        "core/session.php",
        [
          "function logout_user($session) {",
          "  $session->logout();",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "session_service",
          name: "Session",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "core/session.php", startLine: 1, endLine: 3 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows.some((flow) => flow.dataCategories?.includes("session"))).toBe(true);
    });

    it("emits a self-loop flow for SaveAsync session handling", () => {
      const file = makeFile(
        "services/session.ts",
        [
          "async function persistSession(userId: string, sessionToken: string) {",
          "  await sessionStore.SaveAsync(userId, sessionToken);",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "session_store",
          name: "Session Store",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "services/session.ts", startLine: 1, endLine: 3 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
