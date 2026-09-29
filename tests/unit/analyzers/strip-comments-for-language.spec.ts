import {
  blankPythonDocstrings,
  stripCommentsForLanguage,
} from "../../../src/analyzers/shared/strip-comments-for-language";
import { buildPersonalDataInventoryFromIngest } from "../../../src/eval-layers/personal-data-inventory";
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

describe("personal-data inventory ignores comments", () => {
  it("drops email hits on comment lines and keeps code hits on the same line numbers", () => {
    const content = ["// email the member", "const email = member.get('email');"].join("\n");
    const { hits } = buildPersonalDataInventoryFromIngest([file("src/a.js", "javascript", content)], []);
    const emailLines = hits.filter((hit) => hit.id === "email").map((hit) => hit.evidence.startLine);
    expect(emailLines).toEqual([2]);
  });
});
