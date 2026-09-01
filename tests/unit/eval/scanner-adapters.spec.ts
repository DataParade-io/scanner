import {
  adaptDetectedComponent,
  adaptDetectedDataFlow,
  adaptPersonalDataFinding,
  CANONICAL_CONTRACT_VERSION,
  extractPersonalDataRuleId,
  parseTypedFlowKey,
  resolveScannerAdapterMapVersion,
  ruleIdToConceptLeaf,
  scannerFindingHasEntityId,
} from "../../eval/canonical";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { componentEvalCases } from "../../eval/layers/components/cases";
import { scanCanonicalComponents } from "../../eval/layers/components/adapter";
import { scanCanonicalDataFlows } from "../../eval/layers/data-flows/adapter";
import { scanCanonicalMentions } from "../../eval/layers/mentions/adapter";
import { scanCanonicalRawHits } from "../../eval/layers/raw-hits/adapter";

function component(overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">): DetectedComponent {
  return {
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [
      {
        filePath: "src/app.ts",
        startLine: 1,
        endLine: 1,
      },
    ],
    properties: {},
    ...overrides,
  };
}

function flow(overrides: Partial<DetectedDataFlow> & Pick<DetectedDataFlow, "id" | "sourceComponentId" | "targetComponentId" | "type">): DetectedDataFlow {
  return {
    confidence: 1,
    sourceLocation: {
      filePath: "src/app.ts",
      startLine: 2,
      endLine: 2,
    },
    ...overrides,
  };
}

describe("scanner canonical adapters", () => {
  it("stamps CANONICAL_CONTRACT_VERSION and adapter map digest on every finding", async () => {
    const scan = await scanCanonicalMentions("jvm-manifests-basic");
    expect(scan.findings.length).toBeGreaterThan(0);
    const digest = resolveScannerAdapterMapVersion();
    for (const finding of scan.findings) {
      expect(finding.contractVersion).toBe(CANONICAL_CONTRACT_VERSION);
      expect(finding.adapterMapVersion).toBe(digest);
      expect(scannerFindingHasEntityId(finding)).toBe(false);
    }
  });

  it("maps personal-data labels to observed tokens, not classification", () => {
    const finding = adaptPersonalDataFinding(
      {
        subjectKey: "mention:username",
        labels: ["username", "credentials"],
        filePath: "src/config.yml",
        startLine: 6,
        endLine: 6,
      },
      "mentions",
    );

    expect(extractPersonalDataRuleId("mention:username")).toBe("username");
    expect(finding.classification.conceptLeaf).toBe(ruleIdToConceptLeaf("username"));
    expect(finding.identity.identityKey).toBe("mention:username");
    expect(finding.observedTokenCandidates?.map((token) => token.value)).toEqual([
      "username",
      "credentials",
    ]);
    expect(finding.classification.conceptLeaf).not.toBe("credentials");
  });

  it("uses taxonomy subtype for component conceptLeaf, never component name", async () => {
    const scan = await scanCanonicalComponents("typescript-basic");
    const pg = scan.findings.find((entry) => entry.identity.identityKey === "asset:pg");
    expect(pg).toBeDefined();
    expect(pg!.classification.componentSubtype).toBe("database");
    expect(pg!.classification.conceptLeaf).toBe("database");
    expect(pg!.classification.conceptLeaf).not.toBe("pg");
    expect(pg!.display?.displayText).toBeTruthy();
    expect(pg!.optionalAssertion?.instance).toBeUndefined();
  });

  it("records capability gap when component subtype is missing", () => {
    const adapted = adaptDetectedComponent(
      component({
        id: "c1",
        name: "Stripe",
        type: "third_party",
      }),
    );

    expect(adapted.identity.identityKey).toBe("third_party:stripe");
    expect(adapted.classification.componentSubtype).toBeUndefined();
    expect(adapted.classification.conceptLeaf).toBe("");
    expect(adapted.declaredCapabilitySupported).toEqual({
      supported: false,
      reason: "missing_component_subtype",
    });
    expect(adapted.classification.conceptLeaf).not.toBe("stripe");
  });

  it("sets optional vendor from scanner properties for third parties", async () => {
    const scan = await scanCanonicalComponents("typescript-basic");
    const stripe = scan.findings.find(
      (entry) => entry.identity.identityKey === "third_party:stripe",
    );
    expect(stripe).toBeDefined();
    expect(stripe!.optionalAssertion?.vendor).toBe("stripe");
    expect(stripe!.classification.conceptLeaf).not.toBe("stripe");
  });

  it("emits typed flow endpoints only when parseTypedFlowKey succeeds", async () => {
    const scan = await scanCanonicalDataFlows("typescript-basic");
    const typed = scan.findings.find(
      (entry) => entry.identity.identityKey === "flow:asset:api->third_party:stripe",
    );
    expect(typed).toBeDefined();
    expect(typed!.flowEndpoints).toBeDefined();
    expect(parseTypedFlowKey(typed!.identity.identityKey).parsed).toBe(true);
    expect(typed!.classification.conceptLeaf).toBe("api_call");
    expect(typed!.classification.conceptLeaf).not.toBe("data_transfer");
  });

  it("omits flowEndpoints for prose flow keys", () => {
    const adapted = adaptDetectedDataFlow(
      flow({
        id: "f1",
        sourceComponentId: "password",
        targetComponentId: "wp_check_password",
        type: "api_call",
      }),
      new Map(),
    );

    expect(adapted.identity.identityKey).toBe("flow:password->wp_check_password");
    expect(adapted.flowEndpoints).toBeUndefined();
    expect(parseTypedFlowKey(adapted.identity.identityKey).parsed).toBe(false);
  });

  it("records capability gap when flow type is missing instead of inventing data_transfer", () => {
    const source = component({
      id: "s",
      name: "api",
      type: "asset",
      subType: "api",
    });
    const target = component({
      id: "t",
      name: "stripe",
      type: "third_party",
      subType: "payment_processor",
    });
    const componentsById = new Map([
      [source.id, source],
      [target.id, target],
    ]);
    const adapted = adaptDetectedDataFlow(
      flow({
        id: "f1",
        sourceComponentId: "s",
        targetComponentId: "t",
        type: "" as DetectedDataFlow["type"],
      }),
      componentsById,
    );

    expect(adapted.classification.conceptLeaf).toBe("");
    expect(adapted.declaredCapabilitySupported).toEqual({
      supported: false,
      reason: "missing_flow_type",
    });
    expect(adapted.flowEndpoints).toBeDefined();
  });

  it("derives mentions and raw hits from the same rule inventory", async () => {
    const [mentions, rawHits] = await Promise.all([
      scanCanonicalMentions("jvm-manifests-basic"),
      scanCanonicalRawHits("jvm-manifests-basic"),
    ]);
    const mention = mentions.findings.find(
      (entry) => entry.identity.identityKey === "mention:username",
    );
    const raw = rawHits.findings.find((entry) => entry.identity.identityKey === "raw_hit:username");
    expect(mention).toBeDefined();
    expect(raw).toBeDefined();
    expect(mention!.classification.conceptLeaf).toBe(raw!.classification.conceptLeaf);
  });

  it("covers a committed component eval case end-to-end", async () => {
    const evalCase = componentEvalCases.find((entry) => entry.id === "ts-stripe-third-party");
    expect(evalCase).toBeDefined();
    const scan = await scanCanonicalComponents(evalCase!.fixture);
    const match = scan.findings.find(
      (entry) =>
        entry.identity.identityKey === evalCase!.subject.key &&
        entry.evidenceLocations.some(
          (location) =>
            location.file_path === evalCase!.evidence.file_path &&
            location.start_line === evalCase!.evidence.start_line,
        ),
    );
    expect(match).toBeDefined();
  });
});
