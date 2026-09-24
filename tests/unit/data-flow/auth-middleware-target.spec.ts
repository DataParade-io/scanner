import type { DetectedComponent } from "../../../src/core/types/component";
import type { RawFinding } from "../../../src/core/types/detection";
import {
  normalizeAuthFindingToken,
  resolveAuthMiddlewareTarget,
} from "../../../src/data-flow/auth-middleware-target";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 1,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
  };
}

function makeFinding(
  overrides: Partial<RawFinding> & Pick<RawFinding, "pattern" | "name">,
): RawFinding {
  return {
    pattern: overrides.pattern,
    name: overrides.name,
    confidence: overrides.confidence ?? 0.9,
    location: overrides.location ?? {
      filePath: "src/auth.rb",
      startLine: 1,
      endLine: 1,
    },
    properties: overrides.properties ?? {},
  };
}

describe("auth-middleware-target", () => {
  describe("normalizeAuthFindingToken", () => {
    it("lowercases and strips guard/middleware noise", () => {
      expect(normalizeAuthFindingToken("auth0 guard")).toBe("auth0");
      expect(normalizeAuthFindingToken("jwt middleware")).toBe("jwt");
      expect(normalizeAuthFindingToken(undefined, "session_cookie")).toBe(
        "session",
      );
    });
  });

  describe("resolveAuthMiddlewareTarget", () => {
    it("matches auth_service by finding name when multiple exist", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "jwt",
          name: "Jwt",
          type: "asset",
          subType: "auth_service",
        }),
        makeComponent({
          id: "devise",
          name: "Devise",
          type: "asset",
          subType: "auth_service",
        }),
      ];

      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({ pattern: "auth_middleware", name: "jwt" }),
          components,
        )?.id,
      ).toBe("jwt");
      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({ pattern: "auth_middleware", name: "devise" }),
          components,
        )?.id,
      ).toBe("devise");
      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({ pattern: "auth_middleware", name: "warden" }),
          components,
        )?.id,
      ).toBe("devise");
    });

    it("falls back to sole auth_service when finding name does not match", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "jwt",
          name: "Jwt",
          type: "asset",
          subType: "auth_service",
        }),
      ];
      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({ pattern: "auth_middleware", name: "unknown_lib" }),
          components,
        )?.id,
      ).toBe("jwt");
    });

    it("prefers section-scoped Auth0 third_party when no auth_service", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "auth0-backend",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0", section_id: "backend" },
        }),
        makeComponent({
          id: "auth0-frontend",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0", section_id: "frontend" },
        }),
      ];
      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({
            pattern: "auth_middleware",
            name: "auth0 guard",
            properties: { section_id: "backend" },
          }),
          components,
        )?.id,
      ).toBe("auth0-backend");
    });

    it("does not cross concrete sections when no in-section match", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "jwt-frontend",
          name: "Jwt",
          type: "asset",
          subType: "auth_service",
          properties: { section_id: "frontend" },
        }),
      ];
      expect(
        resolveAuthMiddlewareTarget(
          makeFinding({
            pattern: "auth_middleware",
            name: "jwt",
            properties: { section_id: "backend" },
          }),
          components,
        ),
      ).toBeUndefined();
    });
  });
});
