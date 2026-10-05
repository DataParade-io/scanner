/**
 * Unit tests for candidate line extraction from the real implementation.
 */
import fs from "fs";
import path from "path";
import os from "os";

import {
  splitSubwords,
  lineContainsToken,
  listScopeFiles,
  extractCandidates,
  classifyFiles,
} from "../../benchmark/candidate-inventory";

describe("extract-candidates functionality", () => {
  describe("splitSubwords", () => {
    it("should split on non-alphanumeric characters", () => {
      expect(splitSubwords("hello-world_test")).toEqual(["hello", "world", "test"]);
      expect(splitSubwords("foo.bar,baz")).toEqual(["foo", "bar", "baz"]);
    });

    it("should split on camelCase boundaries", () => {
      expect(splitSubwords("camelCase")).toEqual(["camel", "case"]);
      expect(splitSubwords("sendEmail")).toEqual(["send", "email"]);
      expect(splitSubwords("userEmail")).toEqual(["user", "email"]);
    });

    it("should handle ACRONYM boundaries", () => {
      expect(splitSubwords("HTMLEmail")).toEqual(["html", "email"]);
      expect(splitSubwords("FROMADDRESSValue")).toEqual(["fromaddress", "value"]);
    });

    it("should handle mixed styles", () => {
      expect(
        splitSubwords("last_confirm_email_request = userEmails; FROM_ADDRESS e-mail")
      ).toEqual([
        "last", "confirm", "email", "request", "user", "emails",
        "from", "address", "e", "mail"
      ]);
    });

    it("should lowercase everything", () => {
      expect(splitSubwords("HELLO")).toEqual(["hello"]);
      expect(splitSubwords("CamelCase")).toEqual(["camel", "case"]);
    });

    it("should drop empty strings", () => {
      expect(splitSubwords("__hello__")).toEqual(["hello"]);
      expect(splitSubwords("a--b")).toEqual(["a", "b"]);
    });
  });

  describe("lineContainsToken", () => {
    it("should match exact tokens", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("const email = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("// email validation", patterns)).toBe(true);
    });

    it("should match tokens with underscores (regression test)", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("last_confirm_email_request = models.DateTimeField(...)", patterns)).toBe(true);
      expect(lineContainsToken('name="user_email_idx"', patterns)).toBe(true);
    });

    it("should match camelCase tokens", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("function sendEmail(to, subject) {", patterns)).toBe(true);
      expect(lineContainsToken("class EmailValidator {", patterns)).toBe(true);
      expect(lineContainsToken("interface UserEmail {", patterns)).toBe(true);
      expect(lineContainsToken("const userEmails = ['a@b.com']", patterns)).toBe(true);
    });

    it("should match ACRONYM contexts", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("class HTMLEmailRenderer {", patterns)).toBe(true);
    });

    it("should match multi-part tokens", () => {
      const patterns = [splitSubwords("from_address")];
      expect(lineContainsToken("const FROM_ADDRESS = 'noreply@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const fromAddress = data.sender", patterns)).toBe(true);
      expect(lineContainsToken("const from-address: string", patterns)).toBe(true);
    });

    it("should match e-mail token", () => {
      const patterns = [splitSubwords("e_mail")];
      expect(lineContainsToken("const e-mail = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const E_MAIL = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const eMail = 'test@example.com'", patterns)).toBe(true);
    });

    it("should match mailto token", () => {
      const patterns = [splitSubwords("mail_to")];
      expect(lineContainsToken("mailto: 'user@example.com'", patterns)).toBe(true);
    });

    it("should match plural forms with s suffix", () => {
      const patterns = [splitSubwords("recipient")];
      expect(lineContainsToken("const recipients = getRecipients()", patterns)).toBe(true);
    });

    it("should match plural forms with es suffix", () => {
      const patterns = [splitSubwords("address")];
      expect(lineContainsToken("const addresses = getAllAddresses()", patterns)).toBe(true);
    });

    it("should match tokens in comments", () => {
      const tokens = ["email", "sender"];
      const patterns = tokens.map(t => splitSubwords(t));
      expect(lineContainsToken("// send the mail to the sender", patterns)).toBe(true);
      expect(lineContainsToken("// email validation needed", patterns)).toBe(true);
    });

    it("should not match partial words without boundaries", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("unreliable source", patterns)).toBe(false);
      expect(lineContainsToken("reemails are okay", patterns)).toBe(false);
      expect(lineContainsToken("emailing is easy", patterns)).toBe(false);
    });

    it("should not match generic 'mail' usage", () => {
      const patterns = [splitSubwords("email")];
      expect(lineContainsToken("mail.send(x)", patterns)).toBe(false);
    });

    it("should match all email concept tokens", () => {
      const tokens = ["email", "e_mail", "mail_to", "mailto", "recipient", "sender", "from_address"];
      const patterns = tokens.map((t) => splitSubwords(t));

      expect(lineContainsToken("const emails = ['a@b.com']", patterns)).toBe(true);
      expect(lineContainsToken("const userEmail = user.email", patterns)).toBe(true);
      expect(lineContainsToken("const EMAIL_FROM = 'noreply@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const fromAddress = data.sender", patterns)).toBe(true);
      expect(lineContainsToken("const from-address: string", patterns)).toBe(true);
      expect(lineContainsToken("const eMail = contact.email", patterns)).toBe(true);
      expect(lineContainsToken("const recipients = getRecipients()", patterns)).toBe(true);
    });
  });

  describe("listScopeFiles", () => {
    it("should return sorted files from scope paths", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-scope-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "file1.ts"), "content");
        fs.writeFileSync(path.join(tmpDir, "file2.ts"), "content");
        fs.mkdirSync(path.join(tmpDir, "subdir"));
        fs.writeFileSync(path.join(tmpDir, "subdir", "file3.ts"), "content");

        const files = listScopeFiles(["file1.ts", "subdir"], tmpDir);
        expect(files.sort()).toEqual(["file1.ts", "subdir/file3.ts"]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should skip node_modules, vendor, and other excluded paths", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-exclude-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "good.ts"), "content");
        fs.mkdirSync(path.join(tmpDir, "node_modules"));
        fs.writeFileSync(path.join(tmpDir, "node_modules", "bad.ts"), "content");
        fs.mkdirSync(path.join(tmpDir, "vendor"));
        fs.writeFileSync(path.join(tmpDir, "vendor", "bad.ts"), "content");
        fs.writeFileSync(path.join(tmpDir, "file.min.js"), "content");
        fs.writeFileSync(path.join(tmpDir, "package-lock.json"), "content");

        const files = listScopeFiles(["."], tmpDir);
        expect(files).toContain("good.ts");
        expect(files.some(f => f.includes("node_modules"))).toBe(false);
        expect(files.some(f => f.includes("vendor"))).toBe(false);
        expect(files.some(f => f.includes(".min.js"))).toBe(false);
        expect(files.some(f => f.includes("package-lock.json"))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe("extractCandidates", () => {
    it("should extract candidates and sort by file then line", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-extract-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "a.ts"), "line 1\nconst sender = 'x'\nline 3");
        fs.writeFileSync(path.join(tmpDir, "b.ts"), "const email = 'y'\nline 2");

        const tokens = ["email", "sender"];
        const candidates = extractCandidates(tokens, tmpDir, ["a.ts", "b.ts"]);

        expect(candidates).toEqual([
          { file: "a.ts", line: 2, text: "const sender = 'x'" },
          { file: "b.ts", line: 1, text: "const email = 'y'" },
        ]);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it("should produce byte-identical output across multiple runs", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-deterministic-"));
      try {
        fs.writeFileSync(path.join(tmpDir, "file.ts"), "const email = 'test'\nconst sender = 'me'");

        const tokens = ["email", "sender"];
        const run1 = extractCandidates(tokens, tmpDir, ["file.ts"]);
        const run2 = extractCandidates(tokens, tmpDir, ["file.ts"]);

        expect(JSON.stringify(run1)).toEqual(JSON.stringify(run2));
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  });

  describe("classifyFiles", () => {
    it("should separate test files from production files", () => {
      const files = [
        "src/index.ts",
        "src/app.test.ts",
        "src/__tests__/utils.ts",
        "tests/unit.spec.ts",
        "lib/helper.ts",
        "test/fixture.snap",
      ];

      const { test, production } = classifyFiles(files);

      expect(production).toContain("src/index.ts");
      expect(production).toContain("lib/helper.ts");
      expect(test).toContain("src/app.test.ts");
      expect(test).toContain("src/__tests__/utils.ts");
      expect(test).toContain("tests/unit.spec.ts");
      expect(test).toContain("test/fixture.snap");
    });
  });
});
