/**
 * Unit tests for candidate line extraction from the real implementation.
 */
import fs from "fs";
import path from "path";
import os from "os";

import {
  createTokenPatterns,
  lineContainsToken,
  listScopeFiles,
  extractCandidates,
  classifyFiles,
} from "../../benchmark/candidate-inventory";

describe("extract-candidates functionality", () => {
  describe("createTokenPatterns and lineContainsToken", () => {
    it("should match exact word boundaries (case-insensitive)", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken("const email = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const EMAIL = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const Email = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("// email validation", patterns)).toBe(true);
    });

    it("should match camelCase tokens", () => {
      const patterns = [createTokenPatterns("fromAddress")];
      expect(lineContainsToken("const fromAddress = 'sender@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const FROM_ADDRESS = 'sender@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("from-address: string", patterns)).toBe(true);
      expect(lineContainsToken("this.fromaddress = value", patterns)).toBe(true);
    });

    it("should match snake_case tokens", () => {
      const patterns = [createTokenPatterns("mail_to")];
      expect(lineContainsToken("const mail_to = recipient", patterns)).toBe(true);
      expect(lineContainsToken("const MAIL_TO = recipient", patterns)).toBe(true);
      expect(lineContainsToken("const mailTo = recipient", patterns)).toBe(true);
      expect(lineContainsToken("mail-to: 'user@example.com'", patterns)).toBe(true);
    });

    it("should match kebab-case tokens", () => {
      const patterns = [createTokenPatterns("e_mail")];
      expect(lineContainsToken("const e-mail = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const E_MAIL = 'test@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const eMail = 'test@example.com'", patterns)).toBe(true);
    });

    it("should match SCREAMING_CASE tokens", () => {
      const patterns = [createTokenPatterns("recipient")];
      expect(lineContainsToken("const RECIPIENT = 'user@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const recipient = 'user@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const Recipient = 'user@example.com'", patterns)).toBe(true);
    });

    it("should match tokens in identifiers", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken("function sendEmail(to, subject) {", patterns)).toBe(true);
      expect(lineContainsToken("class EmailValidator {", patterns)).toBe(true);
      expect(lineContainsToken("interface UserEmail {", patterns)).toBe(true);
    });

    it("should match tokens in property keys", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken('{ "email": "user@example.com" }', patterns)).toBe(true);
      expect(lineContainsToken('{ email: "user@example.com" }', patterns)).toBe(true);
      expect(lineContainsToken("user.email = 'test@example.com'", patterns)).toBe(true);
    });

    it("should match tokens in strings", () => {
      const patterns = [createTokenPatterns("sender")];
      expect(lineContainsToken("const msg = 'sender: user@example.com'", patterns)).toBe(true);
      expect(lineContainsToken('const label = "from_sender"', patterns)).toBe(true);
    });

    it("should match tokens in comments", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken("// TODO: validate email format", patterns)).toBe(true);
      expect(lineContainsToken("/* email address parsing */", patterns)).toBe(true);
      expect(lineContainsToken("# recipient email validation", patterns)).toBe(true);
    });

    it("should not match partial words without boundaries", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken("unreliable source", patterns)).toBe(false);
      expect(lineContainsToken("reemails are okay", patterns)).toBe(false);
    });

    it("should not match when no token is present", () => {
      const patterns = [createTokenPatterns("email")];
      expect(lineContainsToken("const address = 'user@example.com'", patterns)).toBe(false);
      expect(lineContainsToken("function sendMessage(to, body) {", patterns)).toBe(false);
      expect(lineContainsToken("// validate recipient address format", patterns)).toBe(false);
    });

    it("should match additional email concept tokens", () => {
      const tokens = ["email", "e_mail", "mail_to", "mailto", "recipient", "sender", "from_address"];
      const patterns = tokens.map((t) => createTokenPatterns(t));

      expect(lineContainsToken("const emails = ['a@b.com', 'c@d.com']", patterns)).toBe(true);
      expect(lineContainsToken("const userEmail = user.email", patterns)).toBe(true);
      expect(lineContainsToken("const EMAIL_FROM = 'noreply@example.com'", patterns)).toBe(true);
      expect(lineContainsToken("const fromAddress = data.sender", patterns)).toBe(true);
      expect(lineContainsToken("const from-address: string", patterns)).toBe(true);
      expect(lineContainsToken("const eMail = contact.email", patterns)).toBe(true);
      expect(lineContainsToken("const recipients = getRecipients()", patterns)).toBe(true);
      expect(lineContainsToken("// send the mail to the sender", patterns)).toBe(true);
    });

    it("should not match lines without mail-related tokens", () => {
      const tokens = ["email", "e_mail", "mail_to", "mailto", "recipient", "sender", "from_address"];
      const patterns = tokens.map((t) => createTokenPatterns(t));

      expect(lineContainsToken("mail.send(x)", patterns)).toBe(false);
      expect(lineContainsToken("const name = 'John Doe'", patterns)).toBe(false);
    });
  });

  describe("listScopeFiles", () => {
    it("should return sorted files from scope paths", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-scope-"));
      try {
        // Create test structure
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
        // Create test files
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
