import { spawnSync } from "child_process";
import path from "path";

describe("benchmark:census entrypoint", () => {
  it("compiled script loads modules without ERR_MODULE_NOT_FOUND", () => {
    const script = path.join(
      __dirname,
      "../../../dist/tests/benchmark/scripts/run-detection-census.js",
    );
    const result = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
      cwd: path.join(__dirname, "../../.."),
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });
});
