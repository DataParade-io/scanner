import { runWithConcurrency } from "../../benchmark/run-benchmark";

describe("benchmark/runWithConcurrency", () => {
  it("runs work with bounded parallelism while preserving order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await runWithConcurrency(["a", "b", "c", "d"], 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item.toUpperCase();
    });

    expect(results).toEqual(["A", "B", "C", "D"]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
