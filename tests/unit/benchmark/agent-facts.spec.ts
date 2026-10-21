import { validateFactsText } from "../../benchmark/agents/validate-facts";
import { itemsFromFacts, scoreLayer } from "../../benchmark/agents/score-facts";
import { parsePiEvents, requestCostUsd, type ModelPrice } from "../../benchmark/agents/pi-runner";

const ev = (startLine: number, endLine: number) => [{ filePath: "app/models.py", startLine, endLine }];

describe("agent facts.json", () => {
  const valid = {
    schemaVersion: 1,
    components: [{ name: "db", type: "asset", subType: "database", evidence: ev(4, 6) }],
    dataFlows: [{ source: "db", target: "db", type: "database_query", evidence: ev(4, 6) }],
  };

  it("accepts valid facts", () => {
    expect(validateFactsText(JSON.stringify(valid)).ok).toBe(true);
  });

  it("rejects out-of-vocabulary subType, unknown flow endpoint and bad spans", () => {
    const bad = {
      ...valid,
      components: [{ name: "db", type: "asset", subType: "actor_thing", evidence: ev(6, 4) }],
      dataFlows: [{ source: "db", target: "nope", type: "database_query", evidence: ev(1, 1) }],
    };
    const result = validateFactsText(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("scores by kind plus overlapping evidence, not by name", () => {
    const parsed = validateFactsText(JSON.stringify(valid));
    if (!parsed.ok) throw new Error("expected valid");
    const items = itemsFromFacts(parsed.facts);
    const gold = [{ name: "Other name", kind: "asset:database", evidence: ev(5, 9) }];
    const score = scoreLayer(items.components, gold, ["app/models.py"]);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    const miss = scoreLayer(items.components, [{ ...gold[0], evidence: ev(20, 30) }], ["app/models.py"]);
    expect(miss.recall).toBe(0);
  });
});

describe("pi usage", () => {
  const price: ModelPrice = {
    provider: "openai", tier: "standard", retrievedOn: "x", sourceUrl: "x",
    usdPerMillion: { short: { input: 1, cachedInput: 0.1, output: 2 }, long: { input: 2, cachedInput: 0.2, output: 3 } },
    longContextThresholdInputTokens: 1000,
  };
  it("sums assistant message_end usage and prices it", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", stopReason: "stop", usage: { input: 100, output: 10, cacheRead: 50, cacheWrite: 0, cost: { total: 1 } } },
    });
    const { requests, summary } = parsePiEvents([line, '{"type":"agent_start"}']);
    expect(summary).toMatchObject({ requests: 1, inputTokens: 100, cachedInputTokens: 50, outputTokens: 10 });
    expect(requestCostUsd(requests[0], price)).toBeCloseTo((100 + 5 + 20) / 1e6, 10);
  });
});
