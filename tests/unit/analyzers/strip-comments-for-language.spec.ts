import {
  blankPythonDocstrings,
  stripCommentsForLanguage,
} from "../../../src/analyzers/shared/strip-comments-for-language";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
import { projectPersonalDataFindings } from "../../../src/eval-layers/collect-personal-data-findings";
import type { FileInfo } from "../../../src/core/types/file";

function file(path: string, language: FileInfo["language"], content: string): FileInfo {
  return { path, language, content, size: content.length } as FileInfo;
}

describe("stripCommentsForLanguage", () => {
  it("blanks JS line and block comments but keeps strings and line numbers", () => {
    const source = [
      "// send the welcome email",
      "/** @param {string} email */",
      "const to = user.email; // the member's email",
      "const tpl = `email: ${email}`;",
    ].join("\n");
    const out = stripCommentsForLanguage(source, "javascript");
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].trim()).toBe("");
    expect(lines[1].trim()).toBe("");
    expect(lines[2].trim()).toBe("const to = user.email;");
    expect(lines[3]).toBe("const tpl = `email: ${email}`;");
  });

  it("blanks Python comments and docstrings, keeps other triple-quoted strings", () => {
    const source = [
      '"""Module docstring about email."""',
      "def send(email):",
      '    """Send an email to the customer."""',
      "    query = run(",
      '        """SELECT email FROM users"""',
      "    )",
      "    return email  # the address",
    ].join("\n");
    const out = stripCommentsForLanguage(source, "python").split("\n");
    expect(out).toHaveLength(7);
    expect(out[0].trim()).toBe("");
    expect(out[1]).toBe("def send(email):");
    expect(out[2].trim()).toBe("");
    expect(out[4]).toContain("SELECT email FROM users");
    expect(out[6].trim()).toBe("return email");
  });

  it("blanks multi-line docstrings without shifting lines", () => {
    const source = ["class User:", '    """User account.', "", "    Holds the email.", '    """', "    email = models.EmailField()"].join("\n");
    const out = blankPythonDocstrings(source).split("\n");
    expect(out).toHaveLength(6);
    expect(out.slice(1, 5).every((line) => line.trim() === "")).toBe(true);
    expect(out[5]).toBe("    email = models.EmailField()");
  });

  it("leaves config formats unchanged", () => {
    const yaml = "url: https://example.com/#email # comment";
    expect(stripCommentsForLanguage(yaml, "yaml")).toBe(yaml);
  });
});

describe("personal-data inventory tags comment matches", () => {
  function emailHits(path: string, language: FileInfo["language"], lines: string[]) {
    const { hits } = buildPersonalDataInventoryFromIngest([file(path, language, lines.join("\n"))], []);
    return hits.filter((hit) => hit.id === "email");
  }

  it("keeps comment matches tagged as comment and code matches tagged as code", () => {
    const hits = emailHits("src/a.js", "javascript", ["// email the member", "const email = member.get('email');"]);
    expect(hits.map((hit) => [hit.evidence.startLine, hit.location])).toEqual([
      [1, "comment"],
      [2, "code"],
    ]);
  });

  it("occurrence and data-item projections use code matches only", () => {
    const content = ["// email the member", "const email = member.get('email');"].join("\n");
    const inventory = buildPersonalDataInventoryFromIngest([file("src/a.js", "javascript", content)], []);
    const occurrences = projectPersonalDataFindings(inventory, "occurrences").filter((f) => f.subjectKey.startsWith("occurrence:email"));
    expect(occurrences.map((f) => f.evidenceLocations[0]?.startLine)).toEqual([2]);
    const raw = projectPersonalDataFindings(inventory, "raw-hits").filter((f) => f.subjectKey.includes("email"));
    expect(raw).toHaveLength(2);
  });

  it("attaches a multi-line comment block above the match", () => {
    const [hit] = emailHits("src/a.ts", "typescript", [
      "const x = 1;",
      "// The member's login address.",
      "// Verified on signup.",
      "const email = member.email;",
    ]);
    expect(hit.commentContext?.above).toEqual(["// The member's login address.", "// Verified on signup."]);
  });

  it("reaches over a decorator to a JSDoc block", () => {
    const [hit] = emailHits("src/a.ts", "typescript", [
      "/**",
      " * Where receipts are sent.",
      " */",
      "@Column()",
      "email: string;",
    ]);
    expect(hit.location).toBe("code");
    expect(hit.commentContext?.above).toEqual(["/**", "* Where receipts are sent.", "*/"]);
  });

  it("collects the same-line comment and comment lines below", () => {
    const [hit] = emailHits("src/a.js", "javascript", [
      "const email = req.body.email; // customer supplied",
      "// never logged",
      "",
      "// unrelated",
    ]);
    expect(hit.commentContext?.sameLine).toBe("// customer supplied");
    expect(hit.commentContext?.below).toEqual(["// never logged"]);
  });

  it("stops at a blank line and handles Python hash comments", () => {
    const hits = emailHits("app/models.py", "python", [
      "# unrelated note",
      "",
      "# Staff contact address",
      "email = models.EmailField()",
    ]);
    const code = hits.filter((hit) => hit.location === "code");
    expect(code).toHaveLength(1);
    expect(code[0].commentContext?.above).toEqual(["# Staff contact address"]);
  });
});
