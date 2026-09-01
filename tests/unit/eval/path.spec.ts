import path from "path";

import { isEvalPathContractValid, normalizeEvalPath, parseIdentityKey } from "../../../src/eval/path";

describe("eval path contract", () => {
  it("accepts repo-relative paths", () => {
    expect(isEvalPathContractValid("src/app.ts")).toBe(true);
    expect(normalizeEvalPath("./src/app.ts")).toBe("src/app.ts");
  });

  it("rejects absolute and traversing paths", () => {
    expect(isEvalPathContractValid("/etc/passwd")).toBe(false);
    expect(isEvalPathContractValid("src/../secret.ts")).toBe(false);
    expect(isEvalPathContractValid("")).toBe(false);
  });

  it("parses identity keys for census tooling", () => {
    expect(parseIdentityKey("asset:main")).toEqual({ prefix: "asset", rest: "main" });
    expect(parseIdentityKey("flow")).toEqual({ prefix: "", rest: "flow" });
  });
});

describe("package eval subpath export", () => {
  it("declares @dataparade/scanner/eval in package.json exports", () => {
    const packageJson = require(path.join(__dirname, "../../../package.json"));
    expect(packageJson.exports["./eval"]).toEqual({
      types: "./dist/src/eval/index.d.ts",
      default: "./dist/src/eval/index.js",
    });
  });
});
