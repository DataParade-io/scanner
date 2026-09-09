import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";
import fs from "fs";
import path from "path";
import { resolveComponentForEvidence } from "../../../src/data-flow/component-evidence-resolution";
import { detectIntraComponentLineage } from "../../../src/data-flow/intra-component-lineage";
import {
  hasIntraComponentTransformationEvidence,
  hasPersonalDataRouteReference,
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

    it("accepts Rails webhook route declarations", () => {
      const span = '    post "webhooks/mailgun" => "webhooks#mailgun"';
      expect(hasIntraComponentTransformationEvidence(span, span)).toBe(true);
    });

    it("accepts Rails resources routes for personal-data resources", () => {
      const span = "      resources :users, id: RouteFormat.username, only: %i[index destroy]";
      expect(hasIntraComponentTransformationEvidence(span, span)).toBe(true);
    });

    it("accepts nested lines inside a personal-data resources route block", () => {
      const span = "        collection do";
      const context = [
        "      resources :users, id: RouteFormat.username, only: %i[index destroy] do",
        span,
      ].join("\n");
      expect(hasPersonalDataRouteReference(span, context)).toBe(true);
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
      expect(flows[0]?.dataCategories).toContain("email_address");
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

    it("emits a self-loop flow for Rails session_store initializer", () => {
      const file = makeFile(
        "config/initializers/100-session_store.rb",
        [
          "# frozen_string_literal: true",
          "",
          "Rails.application.config.session_store :cookie_store, key: \"_forum_session\"",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "session_auth",
          name: "discourse_cookie_store",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [
            { filePath: "config/initializers/100-session_store.rb", startLine: 3, endLine: 3 },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows[0]?.sourceComponentId).toBe("session_auth");
      expect(flows[0]?.targetComponentId).toBe("session_auth");
      expect(flows[0]?.sourceLocation?.startLine).toBe(3);
      expect(flows[0]?.dataCategories).toContain("session");
    });

    it("emits a self-loop flow for has_one :user_password in User model", () => {
      const file = makeFile(
        "app/models/user.rb",
        [
          "class User < ApplicationRecord",
          "  has_one :user_password",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "user_actor",
          name: "User",
          type: "actor",
          subType: "customer",
          sourceLocations: [{ filePath: "app/models/user.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows[0]?.sourceComponentId).toBe("user_actor");
      expect(flows[0]?.sourceLocation?.startLine).toBe(2);
      expect(flows[0]?.type).toBe("data_transfer");
      expect(flows[0]?.dataCategories).toContain("password");
    });

    it("emits a self-loop flow for belongs_to :customer in Order model", () => {
      const file = makeFile(
        "spree/core/app/models/spree/order.rb",
        [
          "module Spree",
          "  class Order < Spree::Base",
          "    belongs_to :customer",
          "  end",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "order_model",
          name: "Order",
          type: "asset",
          subType: "database",
          sourceLocations: [
            { filePath: "spree/core/app/models/spree/order.rb", startLine: 2, endLine: 2 },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows[0]?.sourceComponentId).toBe("order_model");
      expect(flows[0]?.sourceLocation?.startLine).toBe(3);
      expect(flows[0]?.type).toBe("data_transfer");
    });

    it("emits a self-loop flow for validates :email in model", () => {
      const file = makeFile(
        "app/models/user_email.rb",
        [
          "class UserEmail < ApplicationRecord",
          "  validates :email, presence: true",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "user_email_model",
          name: "UserEmail",
          type: "asset",
          subType: "database",
          sourceLocations: [{ filePath: "app/models/user_email.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows[0]?.sourceLocation?.startLine).toBe(2);
      expect(flows[0]?.dataCategories).toContain("email_address");
    });

    it("emits a self-loop flow for check_password in user.rb method", () => {
      const file = makeFile(
        "app/models/user.rb",
        [
          "class User < ApplicationRecord",
          "  def try_to_login!(login, password)",
          "    user = find_by_login(login)",
          "    return false unless user&.check_password?(password)",
          "  end",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "user_auth",
          name: "User Auth",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "app/models/user.rb", startLine: 1, endLine: 5 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows.length).toBeGreaterThanOrEqual(1);
      expect(flows.some((flow) => flow.dataCategories?.includes("password"))).toBe(true);
      expect(flows.some((flow) => flow.type === "data_transfer")).toBe(true);
    });

    it("emits a self-loop flow for validates :primary with email category only", () => {
      const file = makeFile(
        "app/models/user_email.rb",
        [
          "class UserEmail < ActiveRecord::Base",
          "  belongs_to :user",
          "  validates :primary, uniqueness: { scope: [:user_id] }, if: %i[user_id primary]",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "user_email_primary",
          name: "UserEmail Primary",
          type: "asset",
          subType: "database",
          sourceLocations: [{ filePath: "app/models/user_email.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const primaryFlow = flows.find((flow) => flow.sourceLocation?.startLine === 3);
      expect(primaryFlow).toBeDefined();
      expect(primaryFlow?.dataCategories).toEqual(["email_address"]);
    });

    it("emits a self-loop flow for scope :totps in UserSecondFactor model", () => {
      const file = makeFile(
        "app/models/user_second_factor.rb",
        [
          "class UserSecondFactor < ActiveRecord::Base",
          "  belongs_to :user",
          "  scope :totps, -> { where(method: UserSecondFactor.methods[:totp], enabled: true) }",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "totp_scope",
          name: "TOTP Scope",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "app/models/user_second_factor.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const totpFlow = flows.find((flow) => flow.sourceLocation?.startLine === 3);
      expect(totpFlow).toBeDefined();
      expect(totpFlow?.sourceComponentId).toBe("totp_scope");
      expect(totpFlow?.type).toBe("data_transfer");
    });

    it("scopes Ruby def bodies to matching end keyword", () => {
      const file = makeFile(
        "app/models/user_auth_token.rb",
        [
          "class UserAuthToken < ActiveRecord::Base",
          "  def self.generate(token)",
          "    log(action: 'generate', auth_token: token)",
          "  end",
          "",
          "  def self.lookup(unhashed_token)",
          "    token = hash_token(unhashed_token)",
          "    unexpired.where(auth_token: token)",
          "  end",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "auth_lookup",
          name: "lookup",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "app/models/user_auth_token.rb", startLine: 6, endLine: 6 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const lookupFlow = flows.find(
        (flow) =>
          flow.sourceLocation &&
          flow.sourceLocation.startLine <= 7 &&
          flow.sourceLocation.endLine >= 7,
      );
      const generateFlow = flows.find((flow) => flow.sourceLocation?.startLine === 3);
      expect(lookupFlow).toBeDefined();
      expect(lookupFlow?.sourceLocation?.endLine).toBeLessThanOrEqual(9);
      expect(generateFlow).toBeDefined();
      expect(generateFlow?.sourceLocation?.endLine).toBeLessThanOrEqual(4);
    });

    it("emits a self-loop flow for EmailToken ActiveRecord model header", () => {
      const file = makeFile(
        "app/models/email_token.rb",
        [
          "class EmailToken < ActiveRecord::Base",
          "  belongs_to :user",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "email_token_model",
          name: "EmailToken",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: "app/models/email_token.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const modelFlow = flows.find((flow) => flow.sourceLocation?.startLine === 1);
      expect(modelFlow).toBeDefined();
      expect(modelFlow?.sourceComponentId).toBe("email_token_model");
    });

    it("attaches EmailToken model flow to coarse database component when auth_service is absent", () => {
      const file = makeFile(
        "app/models/email_token.rb",
        [
          "class EmailToken < ActiveRecord::Base",
          "  belongs_to :user",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "email_token_db",
          name: "EmailToken",
          type: "asset",
          subType: "database",
          sourceLocations: [{ filePath: "app/models/email_token.rb", startLine: 1, endLine: 3 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const modelFlow = flows.find((flow) => flow.sourceLocation?.startLine === 1);
      expect(modelFlow).toBeDefined();
      expect(modelFlow?.sourceComponentId).toBe("email_token_db");
    });

    it("classifies ApiKey.hash_key assignment as data_transfer", () => {
      const file = makeFile(
        "app/models/api_key.rb",
        [
          "class ApiKey < ActiveRecord::Base",
          "  def generate_key",
          "    self.key_hash = ApiKey.hash_key(key)",
          "  end",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "api_key_db",
          name: "ApiKey",
          type: "asset",
          subType: "database",
          sourceLocations: [{ filePath: "app/models/api_key.rb", startLine: 1, endLine: 4 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const hashFlow = flows.find((flow) => flow.sourceLocation?.startLine === 3);
      expect(hashFlow).toBeDefined();
      expect(hashFlow?.type).toBe("data_transfer");
      expect(hashFlow?.sourceComponentId).toBe("api_key_db");
    });

    it("collects session-only categories for session/sso route declarations", () => {
      const file = makeFile(
        "config/routes.rb",
        [
          '  post "webhooks/sendgrid" => "webhooks#sendgrid"',
          '  get "session/sso" => "session#sso"',
          '  get "session/current" => "session#current"',
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "sso_api",
          name: "SSO API",
          type: "asset",
          subType: "api",
          sourceLocations: [{ filePath: "config/routes.rb", startLine: 2, endLine: 2 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const ssoFlow = flows.find((flow) => flow.sourceLocation?.startLine === 2);
      expect(ssoFlow).toBeDefined();
      expect(ssoFlow?.dataCategories).toEqual(["session"]);
    });

    it("emits a self-loop flow for after_create on User model", () => {
      const file = makeFile(
        "app/models/user.rb",
        [
          "class User < ApplicationRecord",
          "  after_create :create_user_stat",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "user_actor",
          name: "User",
          type: "actor",
          subType: "customer",
          sourceLocations: [{ filePath: "app/models/user.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const statFlow = flows.find((flow) => flow.sourceLocation?.startLine === 2);
      expect(statFlow).toBeDefined();
      expect(statFlow?.sourceComponentId).toBe("user_actor");
      expect(statFlow?.type).toBe("database_query");
    });

    it("skips belongs_to :category without personal-data association", () => {
      const file = makeFile(
        "app/models/post.rb",
        [
          "class Post < ApplicationRecord",
          "  belongs_to :category",
          "end",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "post_model",
          name: "Post",
          type: "asset",
          subType: "database",
          sourceLocations: [{ filePath: "app/models/post.rb", startLine: 1, endLine: 1 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      expect(flows).toHaveLength(0);
    });

    it("anchors Magento LoginPost authenticate inside execute() scope", () => {
      const file = makeFile(
        "app/code/Magento/Customer/Controller/Account/LoginPost.php",
        [
          "class LoginPost",
          "    public function execute()",
          "    {",
          "        if ($loggedIn) {",
          "            $resultRedirect = $this->resultRedirectFactory->create();",
          "        }",
          "        if ($this->getRequest()->isPost()) {",
          "            $login = $this->getRequest()->getPost('login');",
          "            if (!empty($login['username']) && !empty($login['password'])) {",
          "                try {",
          "                    $customer = $this->customerAccountManagement->authenticate($login['username'], $login['password']);",
          "                    $this->session->setCustomerDataAsLoggedIn($customer);",
          "                } catch (\\Exception $e) {",
          "                }",
          "            }",
          "        }",
          "    }",
          "}",
        ].join("\n"),
      );
      const components = [
        makeComponent({
          id: "login_post_api",
          name: "LoginPost",
          type: "asset",
          subType: "api",
          sourceLocations: [
            {
              filePath: "app/code/Magento/Customer/Controller/Account/LoginPost.php",
              startLine: 1,
              endLine: 1,
            },
          ],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const authenticateFlow = flows.find(
        (flow) =>
          flow.sourceLocation?.startLine === 11 &&
          flow.sourceLocation.endLine >= 11,
      );
      expect(authenticateFlow).toBeDefined();
      expect(authenticateFlow?.sourceComponentId).toBe("login_post_api");
      expect(authenticateFlow?.dataCategories).toEqual(["password", "session"]);
    });

    it("anchors Magento LoginPost authenticate in the materialized corpus file", () => {
      const cacheRoot = path.join(
        __dirname,
        "../../../tests/benchmark/.cache/repos",
      );
      const materialized = fs
        .readdirSync(cacheRoot)
        .find((entry) => entry.startsWith("magento@"));
      if (!materialized) {
        return;
      }
      const rel = "app/code/Magento/Customer/Controller/Account/LoginPost.php";
      const content = fs.readFileSync(path.join(cacheRoot, materialized, rel), "utf8");
      const file: FileInfo = {
        path: rel,
        name: "LoginPost.php",
        content,
        language: "php",
        size: content.length,
      };
      const components = [
        makeComponent({
          id: "login_post_api",
          name: "LoginPost",
          type: "asset",
          subType: "api",
          sourceLocations: [{ filePath: rel, startLine: 33, endLine: 33 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const overlapping = flows.filter(
        (flow) =>
          flow.sourceLocation &&
          flow.sourceLocation.startLine <= 192 &&
          flow.sourceLocation.endLine >= 191,
      );
      expect(overlapping.length).toBeGreaterThan(0);
    });

    it("emits flows at Magento gold evidence lines for remaining isolation misses", () => {
      const cacheRoot = path.join(
        __dirname,
        "../../../tests/benchmark/.cache/repos",
      );
      const materialized = fs
        .readdirSync(cacheRoot)
        .find((entry) => entry.startsWith("magento@"));
      if (!materialized) {
        return;
      }
      const cases = [
        {
          rel: "app/code/Magento/Customer/Controller/Account/Logout.php",
          line: 87,
          subType: "api" as const,
        },
        {
          rel: "app/code/Magento/Customer/Controller/Account/CreatePost.php",
          line: 398,
          subType: "api" as const,
        },
        {
          rel: "app/code/Magento/Customer/Model/AccountManagement.php",
          line: 1308,
          subType: "database" as const,
        },
        {
          rel: "app/code/Magento/Customer/Model/ResourceModel/Customer.php",
          line: 274,
          subType: "database" as const,
        },
      ];

      for (const { rel, line, subType } of cases) {
        const content = fs.readFileSync(path.join(cacheRoot, materialized, rel), "utf8");
        const file: FileInfo = {
          path: rel,
          name: path.basename(rel),
          content,
          language: "php",
          size: content.length,
        };
        const components = [
          makeComponent({
            id: `${rel}:${subType}`,
            name: path.basename(rel),
            type: "asset",
            subType,
            sourceLocations: [{ filePath: rel, startLine: 1, endLine: 9999 }],
          }),
        ];
        const { flows } = detectIntraComponentLineage([file], components, 0);
        const hit = flows.find(
          (flow) =>
            flow.sourceLocation &&
            flow.sourceLocation.startLine <= line &&
            flow.sourceLocation.endLine >= line,
        );
        expect(hit).toBeDefined();
      }
    });

    it("anchors Directus LocalAuthDriver email lookup in the materialized corpus file", () => {
      const cacheRoot = path.join(
        __dirname,
        "../../../tests/benchmark/.cache/repos",
      );
      const materialized = fs
        .readdirSync(cacheRoot)
        .find((entry) => entry.startsWith("directus@"));
      if (!materialized) {
        return;
      }
      const rel = "api/src/auth/drivers/local.ts";
      const content = fs.readFileSync(path.join(cacheRoot, materialized, rel), "utf8");
      const file: FileInfo = {
        path: rel,
        name: "local.ts",
        content,
        language: "typescript",
        size: content.length,
      };
      const components = [
        makeComponent({
          id: "directus-local-auth-driver",
          name: "LocalAuthDriver",
          type: "asset",
          subType: "auth_service",
          sourceLocations: [{ filePath: rel, startLine: 19, endLine: 19 }],
        }),
      ];

      const { flows } = detectIntraComponentLineage([file], components, 0);
      const emailLookup = flows.find(
        (flow) =>
          flow.type === "data_transfer" &&
          flow.dataCategories?.includes("email_address") &&
          flow.sourceLocation &&
          flow.sourceLocation.startLine <= 35 &&
          flow.sourceLocation.endLine >= 25,
      );
      expect(emailLookup).toBeDefined();
      const passwordVerify = flows.find(
        (flow) =>
          flow.type === "data_transfer" &&
          flow.dataCategories?.includes("password") &&
          flow.sourceLocation &&
          flow.sourceLocation.startLine <= 45 &&
          flow.sourceLocation.endLine >= 39,
      );
      expect(passwordVerify).toBeDefined();
      expect(passwordVerify?.dataCategories).toEqual(["password"]);
    });

    it("emits flows at WordPress gold evidence lines for accepted canonical cases", () => {
      const cacheRoot = path.join(
        __dirname,
        "../../../tests/benchmark/.cache/repos",
      );
      const materialized = fs
        .readdirSync(cacheRoot)
        .find((entry) => entry.startsWith("wordpress@"));
      if (!materialized) {
        return;
      }
      const cases = [
        { rel: "src/wp-includes/user.php", start: 109, end: 115 },
        { rel: "src/wp-includes/user.php", start: 2300, end: 2301 },
        { rel: "src/wp-includes/pluggable.php", start: 1131, end: 1137 },
        { rel: "src/wp-includes/user.php", start: 208, end: 208 },
        { rel: "src/wp-includes/class-wp-application-passwords.php", start: 98, end: 99 },
        { rel: "src/wp-includes/pluggable.php", start: 2753, end: 2753 },
        { rel: "src/wp-includes/pluggable.php", start: 2843, end: 2843 },
        { rel: "src/wp-includes/pluggable.php", start: 3103, end: 3103 },
        { rel: "src/wp-includes/pluggable.php", start: 684, end: 684 },
        { rel: "src/wp-includes/user.php", start: 372, end: 372 },
        { rel: "src/wp-includes/user.php", start: 3000, end: 3000 },
        { rel: "src/wp-includes/user.php", start: 181, end: 181 },
        { rel: "src/wp-includes/user.php", start: 275, end: 275 },
        { rel: "src/wp-includes/user.php", start: 3178, end: 3178 },
        { rel: "src/wp-includes/user.php", start: 873, end: 873 },
        { rel: "src/wp-includes/author-template.php", start: 492, end: 492 },
      ];
      const repoRoot = path.join(cacheRoot, materialized);

      for (const { rel, start, end } of cases) {
        const content = fs.readFileSync(path.join(repoRoot, rel), "utf8");
        const file: FileInfo = {
          path: rel,
          name: path.basename(rel),
          content,
          language: "php",
          size: content.length,
        };
        const components = [
          makeComponent({
            id: `${rel}:auth`,
            name: path.basename(rel),
            type: "asset",
            subType: "auth_service",
            sourceLocations: [{ filePath: rel, startLine: 1, endLine: 9999 }],
          }),
        ];
        const { flows } = detectIntraComponentLineage([file], components, 0);
        const hit = flows.find(
          (flow) =>
            flow.sourceLocation &&
            flow.sourceLocation.startLine <= end &&
            flow.sourceLocation.endLine >= start,
        );
        expect(hit).toBeDefined();
      }
    });
  });
});
