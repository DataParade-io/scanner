import type { DetectedComponent } from "../../../src/core/types/component";
import {
  deriveFromSubtypes,
  readDataActions,
  runDataActionPhase,
  TERRAFORM_GATEWAY_SUBTYPES,
} from "../../../src/data-actions";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

function hasAsserted(component: DetectedComponent, action: string): boolean {
  return readDataActions(component).some(
    (a) => a.action === action && (a.status ?? "asserted") === "asserted",
  );
}

describe("deriveFromSubtypes (DA-4)", () => {
  it("assigns store for database, storage, and cache asset subtypes", () => {
    const db = makeComponent({
      id: "db",
      name: "pg",
      type: "asset",
      subType: "database",
    });
    const bucket = makeComponent({
      id: "s3",
      name: "data",
      type: "asset",
      subType: "storage",
    });
    const cache = makeComponent({
      id: "redis",
      name: "redis",
      type: "asset",
      subType: "cache",
    });
    const api = makeComponent({
      id: "api",
      name: "api",
      type: "asset",
      subType: "api",
    });

    runDataActionPhase([db, bucket, cache, api], [], undefined, undefined, {
      enableDataActionPatterns: false,
    });

    expect(hasAsserted(db, "store")).toBe(true);
    expect(hasAsserted(bucket, "store")).toBe(true);
    expect(hasAsserted(cache, "store")).toBe(true);
    expect(hasAsserted(api, "store")).toBe(false);
  });

  it("assigns disclose on third_party sink nodes themselves", () => {
    const stripe = makeComponent({
      id: "stripe",
      name: "stripe",
      type: "third_party",
      subType: "payment_processor",
    });
    const openai = makeComponent({
      id: "openai",
      name: "openai",
      type: "third_party",
      subType: "ai_provider",
    });

    runDataActionPhase([stripe, openai], [], undefined, undefined, {
      enableDataActionPatterns: false,
    });

    expect(hasAsserted(stripe, "disclose")).toBe(true);
    expect(hasAsserted(openai, "disclose")).toBe(true);
    expect(
      readDataActions(stripe).find((a) => a.action === "disclose")?.evidence,
    ).toMatchObject({ kind: "outbound_to_third_party" });
  });

  it("never asserts relay from terraform gateway-like subtype defaults", () => {
    const gw = makeComponent({
      id: "gw",
      name: "api",
      type: "asset",
      subType: "api",
      properties: { terraform_address: "aws_api_gateway_rest_api.main" },
      detectedFrom: [{ pattern: "terraform:aws_api_gateway_rest_api" }],
    });

    const proposed = deriveFromSubtypes([gw]);
    const assignments = proposed.get(gw.id) ?? [];
    expect(assignments.some((a) => a.action === "relay")).toBe(false);
    expect(TERRAFORM_GATEWAY_SUBTYPES.has("api")).toBe(true);
  });

  it("still assigns store for terraform database/storage resources", () => {
    const rds = makeComponent({
      id: "rds",
      name: "main (aws_db_instance)",
      type: "asset",
      subType: "database",
      properties: {
        terraform_address: "aws_db_instance.main",
        cloud_provider: "aws",
      },
      detectedFrom: [{ pattern: "terraform:aws_db_instance" }],
    });
    const s3 = makeComponent({
      id: "s3",
      name: "data (aws_s3_bucket)",
      type: "asset",
      subType: "storage",
      properties: {
        terraform_address: "aws_s3_bucket.data",
        cloud_provider: "aws",
      },
      detectedFrom: [{ pattern: "terraform:aws_s3_bucket" }],
    });

    runDataActionPhase([rds, s3], [], undefined, undefined, {
      enableDataActionPatterns: false,
    });

    expect(hasAsserted(rds, "store")).toBe(true);
    expect(hasAsserted(s3, "store")).toBe(true);
    expect(hasAsserted(rds, "relay")).toBe(false);
    expect(hasAsserted(s3, "relay")).toBe(false);
  });

  it("does not attach subtype verbs to actors", () => {
    const actor = makeComponent({
      id: "user",
      name: "User",
      type: "actor",
      subType: "customer",
    });
    runDataActionPhase([actor], []);
    expect(actor.properties.dataActions).toBeUndefined();
  });

  it("honors enableDataActionSubtypes=false kill-switch for TP sink disclose", () => {
    const stripe = makeComponent({
      id: "stripe",
      name: "stripe",
      type: "third_party",
      subType: "payment_processor",
    });
    // No flows → topology will not disclose; subtypes disabled → no sink default.
    runDataActionPhase([stripe], [], undefined, undefined, {
      enableDataActionPatterns: false,
      enableDataActionSubtypes: false,
    });
    expect(hasAsserted(stripe, "disclose")).toBe(false);
  });
});
