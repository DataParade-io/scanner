import { spawnSync } from "child_process";
import path from "path";

describe("benchmark:materialize entrypoint", () => {
  it("compiled script loads modules without ERR_MODULE_NOT_FOUND", () => {
    const script = path.join(
      __dirname,
      "../../../dist/tests/benchmark/scripts/materialize-repo.js",
    );
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      cwd: path.join(__dirname, "../../.."),
    });

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Usage:");
  });
});
