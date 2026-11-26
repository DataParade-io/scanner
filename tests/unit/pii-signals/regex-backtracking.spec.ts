import {
  IMPORT_LINE,
  matchPiiSignalsInFile,
  PATH_OR_PROSE_STRING,
} from "../../../src/pii-signals/match-pii-signals";
import { occurrenceQualifier } from "../../../src/pii-signals/occurrence-group";
import {
  isBareAddressFieldDeclaration,
  resolveAliasRuleIdsForToken,
} from "../../../src/pii-signals/pii-signal-aliases";

/** PATH_OR_PROSE_STRING as added in 19ce1d13: O(n^3) on a long capitalised string. */
const LEGACY_PATH_OR_PROSE_STRING =
  /(['"`])(?:[\w.@-]*\/[\w./@-]*|[A-Z](?:(?![$#]\{)[^'"`\n])*\s(?:(?![$#]\{)[^'"`\n])*\s(?:(?![$#]\{)[^'"`\n])*[.!?])\1/g;

/** IMPORT_LINE before this change: O(n^3) on `from a import` and a long run of spaces. */
const LEGACY_IMPORT_LINE =
  /^\s*(?:(?:const|let|var)\s+[^=]+=\s*require\(\s*(['"`])[^'"`]*\1\s*\)(?:\(\s*(['"`])[^'"`]*\2\s*\))?(?:\.\w+)*\s*;?|import\b[^'"`]*\bfrom\s*(['"`])[^'"`]*\3\s*;?|import\s*(['"`])[^'"`]*\4\s*;?|from\s+[\w.]+\s+import\s+[\w\s,()*]+|import\s+[\w.]+(?:\s+as\s+\w+)?|require(?:_relative)?\s+(['"])[^'"]*\5)\s*$/;

const SPACES = " ".repeat(50_000);

const ids = (filePath: string, line: string): string[] =>
  matchPiiSignalsInFile({ filePath, content: line }).map((hit) => hit.id);

const elapsedMs = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

/** A deterministic generator so the comparison is the same on every run. */
function lcg(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % bound;
  };
}

const svgPathLine = (length: number): string => {
  const body = "1.5 2.5 ".repeat(Math.ceil(length / 8)).slice(0, length);
  return `export const I = () => (<svg><path d="M${body}Z"/></svg>);`;
};

describe("PATH_OR_PROSE_STRING", () => {
  const representative = [
    "throw new Error('Email not found.');",
    "throw new Error('Email address is required');",
    "import x from '../../services/email-service';",
    "const p = fetch('/api/users/email');",
    'logger.info "Logout failed for #{channel.email}."',
    "const msg = `Sent mail to ${user.email} today.`;",
    'const msg = "Please enter a valid email address!";',
    'const msg = "Is this your email address?";',
    'db.query("SELECT email, phone FROM users WHERE id = ?");',
    "const contact = { email: 'jane@example.com', phone: '+1 555 0100' };",
    '<path d="M48.43 58V53.63H50.06 email" />',
    '<path d="M48.43 58V53.63H50.06 email." />',
    "const a = 'Two  spaces.', b = 'One space.', c = 'A\tb\tc!';",
    "t('Hello world') + \"Hello big world.\" + `Hi ${name} there.`",
    "const s = 'Mixed \"quotes\" here.';",
    "const s = 'Ends with dollar $ sign here.';",
    "const s = 'Template #{not} closed here.';",
    "const s = '@scope/pkg/sub-path';",
    "",
  ];

  it.each(representative)("replaces exactly what the previous pattern did: %s", (line) => {
    expect(line.replace(PATH_OR_PROSE_STRING, '""')).toBe(
      line.replace(LEGACY_PATH_OR_PROSE_STRING, '""'),
    );
  });

  it("replaces exactly what the previous pattern did on generated single lines", () => {
    const next = lcg(20261022);
    const quotes = ["'", '"', "`"];
    const inner = ["A", "b", "1", ".", "!", "?", " ", " ", "\t", "/", "$", "#", "{", "@", "-", "'", '"', "`", " "];
    let changed = 0;
    for (let i = 0; i < 20000; i += 1) {
      let line = "";
      const strings = 1 + next(4);
      for (let s = 0; s < strings; s += 1) {
        const quote = quotes[next(3)];
        line += `x = ${quote}${next(2) ? "H" : ""}`;
        const length = next(14);
        for (let c = 0; c < length; c += 1) line += inner[next(inner.length)];
        line += [".", "!", "?", "", " "][next(5)] + (next(5) ? quote : quotes[next(3)]) + "; ";
      }
      const expected = line.replace(LEGACY_PATH_OR_PROSE_STRING, '""');
      if (expected !== line) changed += 1;
      expect(line.replace(PATH_OR_PROSE_STRING, '""')).toBe(expected);
    }
    // The generator exercises the pattern, not only lines it leaves alone.
    expect(changed).toBeGreaterThan(200);
  });

  it("matches a 50 KB single-line SVG path in linear time", () => {
    const line = svgPathLine(50_000);
    expect(elapsedMs(() => line.replace(PATH_OR_PROSE_STRING, '""'))).toBeLessThan(100);
  });
});

describe("PII signal matching on long lines", () => {
  it("scans a file with a 50 KB single-line SVG path in well under a second", () => {
    const content = `import React from "react";\n${svgPathLine(50_000)}\nconst email = user.email;\n`;
    let hits: string[] = [];
    const ms = elapsedMs(() => {
      hits = matchPiiSignalsInFile({ filePath: "icon.tsx", content }).map((hit) => hit.id);
    });
    expect(ms).toBeLessThan(1000);
    expect(hits).toEqual(["email"]);
  });

  it("keeps the same hits on paths, prose and PII-like strings", () => {
    expect(ids("src/a.ts", "const email = req.body.email;")).toEqual(["email"]);
    expect(ids("src/a.ts", "throw new Error('Email not found.');")).toEqual([]);
    expect(ids("src/a.ts", "throw new Error('Email address is required');")).toEqual(["email"]);
    expect(ids("src/a.ts", "const p = fetch('/api/users/email');")).toEqual([]);
    expect(ids("src/a.rb", 'logger.info "Logout failed for #{channel.email}."')).toEqual(["email"]);
    expect(ids("src/a.ts", "const msg = `Sent mail to ${user.email} today.`;")).toEqual(["email"]);
    expect(ids("src/a.ts", 'const msg = "Please enter a valid email address!";')).toEqual([]);
    expect(
      ids("src/a.ts", "const contact = { email: 'jane@example.com', phone: '+1 555 0100' };"),
    ).toEqual(["phone_number", "email"]);
    expect(ids("src/a.ts", '<path d="M48.43 58V53.63H50.06 email" />')).toEqual(["email"]);
  });
});

describe("address and phone alias patterns", () => {
  it("still read Rails validations of an address field", () => {
    expect(isBareAddressFieldDeclaration("validates :address, presence: true", 11)).toBe(true);
    expect(isBareAddressFieldDeclaration("validates_format_of :address, with: /x/", 21)).toBe(true);
    expect(isBareAddressFieldDeclaration("validates__ :address", 12)).toBe(true);
    expect(isBareAddressFieldDeclaration("validates_ :address", 11)).toBe(false);
    expect(ids("app/models/user.rb", "validates :email_address, presence: true")).toEqual([
      "email",
      "address",
    ]);
  });

  it("does not backtrack exponentially on a long validates_ name", () => {
    const line = `validates${"_a".repeat(40)}! :address`;
    expect(elapsedMs(() => isBareAddressFieldDeclaration(line, line.length - 7))).toBeLessThan(100);
  });

  it("still treats a multi-word PascalCase phone name as a type", () => {
    expect(ids("src/a.ts", "const MFAEnrollPhoneParams = {};")).toEqual([]);
    expect(ids("src/a.ts", "const phoneNumber = user.phone_number;")).toEqual(["phone_number"]);
    expect(ids("src/a.ts", "const ATTENDEE_PHONE_NUMBER_FIELD = 'phone';")).toEqual(["phone_number"]);
  });

  it("checks a long PascalCase phone token in linear time", () => {
    const token = `X${"a".repeat(50_000)}_phone`;
    let ruleIds: string[] = [];
    const ms = elapsedMs(() => {
      ruleIds = resolveAliasRuleIdsForToken(token, token, 0, "a.ts");
    });
    expect(ruleIds).toEqual(["phone_number"]);
    expect(ms).toBeLessThan(200);
  });
});

describe("IMPORT_LINE", () => {
  it("matches exactly what the previous pattern did", () => {
    const fixed = [
      "const mail = require('../mail');",
      "const debug = require('@tryghost/debug')('email-service:mailgun');",
      "const x = require(\"a\").b.c ;  ",
      "import renderImportEmail, { type ImportEmailSummary } from './email-template';",
      "import './styles.css'",
      "from email.mime.text import MIMEText",
      "from a import (b, c,\td)  ",
      "from a import   ",
      "from a import b # comment",
      "import os.path as p",
      "require 'mail'",
      "require_relative \"x\"",
      "const email = req.body.email;",
      "const  x = require('a') ; ;",
    ];
    for (const line of fixed) expect(IMPORT_LINE.test(line)).toBe(LEGACY_IMPORT_LINE.test(line));

    const next = lcg(7);
    const templates = ['const x = require("a")', "import x from 'a'", "import 'a'", "from a import b", "import a.b", "require 'm'", ""];
    const pieces = ["const", "import", "from", "require", "as", " ", "  ", "\t", "x", "a.b", "=", '"a"', "'b'", "(", ")", ";", ",", "*", ".w", "!", "#"];
    let matched = 0;
    for (let i = 0; i < 20000; i += 1) {
      let line = templates[next(templates.length)];
      const count = next(6);
      for (let j = 0; j < count; j += 1) {
        const piece = pieces[next(pieces.length)];
        line = next(4) ? line + piece : piece + line;
      }
      if (next(3) === 0) line = " ".repeat(next(3)) + line + [" ", ";", " ; ", "\t", "", "  "][next(6)];
      const expected = LEGACY_IMPORT_LINE.test(line);
      if (expected) matched += 1;
      expect(IMPORT_LINE.test(line)).toBe(expected);
    }
    expect(matched).toBeGreaterThan(2000);
  });

  it("rejects an import-like line with a long run of spaces in linear time", () => {
    for (const line of [
      `from a import${SPACES}!`,
      `const${SPACES}= require("a") !`,
      `const x = require("a")${SPACES}!`,
      `import x from "a"${SPACES}!`,
    ]) {
      expect(elapsedMs(() => IMPORT_LINE.test(line))).toBeLessThan(100);
    }
  });
});

describe("Java field and occurrence qualifier patterns", () => {
  it("still spans a Java field's evidence through its annotations", () => {
    const content = ["class User {", '  @Column(name = "email")', "  @NotNull", "  private String email;", "}"].join("\n");
    const spans = matchPiiSignalsInFile({ filePath: "User.java", content }).map((hit) => [
      hit.id,
      hit.evidence.startLine,
      hit.evidence.endLine,
    ]);
    expect(spans).toEqual([
      ["email", 2, 2],
      ["email", 2, 4],
    ]);
  });

  it("checks a long Java line in linear time", () => {
    const content = ["  @Column", `  private${SPACES}String email!`].join("\n");
    expect(elapsedMs(() => matchPiiSignalsInFile({ filePath: "User.java", content }))).toBeLessThan(500);
  });

  it("keeps the qualifiers of local copies and assigned functions", () => {
    expect(occurrenceQualifier("const parentMemberEmail = parentMember.get('email')", "email")).toBe("member");
    expect(occurrenceQualifier("const verificationEmail: string = user?.email ?? input.email", "email")).toBe("user");
    expect(occurrenceQualifier("customer_email = order.email", "email")).toBe("order");
    expect(occurrenceQualifier("const sendEmail = async (to) => x", "email")).toBeUndefined();
    expect(occurrenceQualifier("sendEmail: (a: string): void => {}", "email")).toBeUndefined();
  });

  it("qualifies a line with a long type annotation or arrow signature in linear time", () => {
    for (const line of [
      `const parentMemberEmail:${SPACES}!`,
      `const parentMemberEmail${SPACES}:${SPACES}!`,
      `sendUserEmail = ():${SPACES}!`,
    ]) {
      expect(elapsedMs(() => occurrenceQualifier(line, "email"))).toBeLessThan(500);
    }
  });
});
