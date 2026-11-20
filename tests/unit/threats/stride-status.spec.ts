import type { FlowControlEvidence } from "../../../src/core/types/data-flow";
import {
  isStructuralFlowForStride,
  strideThreatsForComponent,
  strideThreatsForFlow,
  type ElementThreat,
} from "../../../src/threats/stride";

/** Threat statuses from control evidence (DATAP-915). */

const byCategory = (threats: ElementThreat[]) => Object.fromEntries(threats.map((t) => [t.category, t]));

function control(id: string, effect: FlowControlEvidence["effect"], line = 1): FlowControlEvidence {
  return { control: id, effect, filePath: "app.py", line };
}

describe("STRIDE statuses", () => {
  it("leaves every category unknown without evidence", () => {
    const threats = strideThreatsForFlow({ controls: [] });
    expect(threats.every((t) => t.status === "unknown" && t.evidence === undefined && t.statusRuleId === undefined)).toBe(
      true,
    );
  });

  it("marks T and I mitigated by TLS and D by a timeout, with the rule and evidence", () => {
    const t = byCategory(strideThreatsForFlow({ controls: [control("tls", "mitigates", 4), control("timeout", "mitigates", 9)] }));
    expect(t.T!.status).toBe("mitigated");
    expect(t.I!.status).toBe("mitigated");
    expect(t.I!.statusRuleId).toBe("stride/v2/data_flow/I");
    expect(t.I!.evidence).toEqual([{ control: "tls", filePath: "app.py", line: 4 }]);
    expect(t.D!.status).toBe("mitigated");
    expect(t.D!.evidence).toEqual([{ control: "timeout", filePath: "app.py", line: 9 }]);
  });

  it("lets a weakening control win: plain HTTP opens T and I", () => {
    const t = byCategory(
      strideThreatsForFlow({ controls: [control("tls", "mitigates", 2), control("plaintext_http", "weakens", 7)] }),
    );
    expect(t.T!.status).toBe("open");
    expect(t.I!.status).toBe("open");
    expect(t.I!.evidence).toEqual([{ control: "plaintext_http", filePath: "app.py", line: 7 }]);
    expect(t.D!.status).toBe("unknown");
  });

  it("counts a webhook signature check against tampering, not disclosure", () => {
    const t = byCategory(
      strideThreatsForFlow({
        controls: [],
        authentication: {
          status: "seen",
          kinds: ["webhook_signature"],
          evidence: [{ kind: "webhook_signature", filePath: "hook.py", line: 12 }],
        },
      }),
    );
    expect(t.T!.status).toBe("mitigated");
    expect(t.T!.evidence).toEqual([{ control: "auth:webhook_signature", filePath: "hook.py", line: 12 }]);
    expect(t.I!.status).toBe("unknown");
  });

  it("marks an external entity mitigated only when every checked flow is", () => {
    const vendor = { type: "third_party", subType: "saas_service" };
    const tls = { controls: [control("tls", "mitigates")] };
    const none = { controls: [] };
    const notChecked = {};
    expect(byCategory(strideThreatsForComponent(vendor, [tls, notChecked])).S!.status).toBe("mitigated");
    expect(byCategory(strideThreatsForComponent(vendor, [tls, none])).S!.status).toBe("unknown");
    expect(byCategory(strideThreatsForComponent(vendor, [])).S!.status).toBe("unknown");
    const open = byCategory(strideThreatsForComponent(vendor, [tls, { controls: [control("tls_verify_disabled", "weakens", 5)] }]));
    expect(open.S!.status).toBe("open");
    expect(open.S!.statusRuleId).toBe("stride/v2/external_entity/S");
    expect(open.R!.status).toBe("unknown");
  });

  it("has no status rules for processes and data stores yet", () => {
    const flows = [{ controls: [control("tls", "mitigates")] }];
    const threats = [
      ...strideThreatsForComponent({ type: "asset", subType: "service" }, flows),
      ...strideThreatsForComponent({ type: "asset", subType: "database" }, flows),
    ];
    expect(threats.every((t) => t.status === "unknown")).toBe(true);
  });
});

describe("structural flows", () => {
  const tlsControl = { control: "tls", effect: "mitigates" as const, filePath: "app.ts", line: 3 };

  it.each(["uses_in_process", "exposes", "depends_on", "provisions"] as const)(
    "gives a %s flow no threats",
    (relationship) => {
      expect(isStructuralFlowForStride({ relationship })).toBe(true);
      expect(strideThreatsForFlow({ relationship, controls: [tlsControl] })).toEqual([]);
    },
  );

  it.each(["invokes", "queries", "interacts", "authenticates_via"] as const)(
    "keeps threats on a %s flow",
    (relationship) => {
      expect(isStructuralFlowForStride({ relationship })).toBe(false);
      expect(strideThreatsForFlow({ relationship }).map((threat) => threat.category)).toEqual(["T", "I", "D"]);
    },
  );

  it("does not read a structural flow when deciding an external entity's status", () => {
    const vendor = { type: "third_party", subType: "saas_service" };
    const structuralFlowWithoutEvidence = { relationship: "depends_on" as const, controls: [] };
    const realFlowWithTls = { relationship: "invokes" as const, controls: [tlsControl] };
    const spoofing = strideThreatsForComponent(vendor, [realFlowWithTls, structuralFlowWithoutEvidence]).find(
      (threat) => threat.category === "S",
    );
    expect(spoofing?.status).toBe("mitigated");
  });
});
