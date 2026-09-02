import type {
  ComponentDataActionFields,
  DataActionAssignment,
  TopologyEvidence,
} from "../../../src/core/types/data-action";
import { componentMayCarryDataActions } from "../../../src/core/types/data-action";

describe("componentMayCarryDataActions (DA-1)", () => {
  it("allows asset and third_party only", () => {
    expect(componentMayCarryDataActions("asset")).toBe(true);
    expect(componentMayCarryDataActions("third_party")).toBe(true);
    expect(componentMayCarryDataActions("actor")).toBe(false);
  });
});

describe("DataActionAssignment shape", () => {
  it("models an asserted store assignment with topology evidence", () => {
    const evidence: TopologyEvidence = {
      kind: "storage_subtype",
      description: "asset subtype database",
      relatedComponentId: "comp-pg",
    };
    const assignment: DataActionAssignment = {
      action: "store",
      source: "deterministic",
      confidence: 1,
      evidence,
      status: "asserted",
    };
    expect(assignment.action).toBe("store");
    expect(assignment.status).toBe("asserted");
    expect(Array.isArray(assignment.evidence)).toBe(false);
  });

  it("models a relay candidate without corroboration", () => {
    const evidence: TopologyEvidence = {
      kind: "relay_topology",
      description: "in-degree and out-degree with no store/use evidence",
      dataFlowId: "flow-1",
    };
    const assignment: DataActionAssignment = {
      action: "relay",
      source: "deterministic",
      confidence: 0.4,
      evidence,
      status: "candidate",
    };
    expect(assignment.status).toBe("candidate");
    expect("corroboration" in evidence && evidence.corroboration).toBeFalsy();
  });

  it("allows asserted relay only when topology evidence carries corroboration", () => {
    const evidence: TopologyEvidence = {
      kind: "relay_topology",
      description: "passthrough gateway",
      corroboration: "pattern:express-proxy-passthrough",
      ruleId: "da-relay-proxy",
    };
    const assignment: DataActionAssignment = {
      action: "relay",
      source: "deterministic",
      confidence: 0.9,
      evidence,
      status: "asserted",
    };
    expect(assignment.status).toBe("asserted");
    expect(evidence.corroboration).toMatch(/proxy/i);
  });

  it("accepts file:line SourceLocation[] evidence for pattern hits", () => {
    const assignment: DataActionAssignment = {
      action: "log",
      source: "deterministic",
      confidence: 1,
      evidence: [
        {
          filePath: "src/logger.ts",
          startLine: 12,
          endLine: 12,
          code: 'logger.info({ email })',
        },
      ],
    };
    expect(Array.isArray(assignment.evidence)).toBe(true);
    expect(assignment.evidence).toHaveLength(1);
  });
});

describe("ComponentDataActionFields (set-valued)", () => {
  it("allows multiple assignments plus display-only primaryDataAction", () => {
    const fields: ComponentDataActionFields = {
      dataActions: [
        {
          action: "store",
          source: "deterministic",
          confidence: 1,
          evidence: {
            kind: "storage_subtype",
            description: "database subtype",
          },
        },
        {
          action: "disclose",
          source: "deterministic",
          confidence: 1,
          evidence: {
            kind: "outbound_to_third_party",
            description: "outbound edge to stripe",
            relatedComponentId: "comp-stripe",
          },
        },
      ],
      primaryDataAction: "store",
    };
    expect(fields.dataActions).toHaveLength(2);
    expect(fields.primaryDataAction).toBe("store");
    const verbs = fields.dataActions!.map((a) => a.action).sort();
    expect(verbs).toEqual(["disclose", "store"]);
  });
});
