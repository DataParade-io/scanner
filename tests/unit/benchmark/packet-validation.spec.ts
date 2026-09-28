import fs from "fs";
import os from "os";
import path from "path";
import YAML from "yaml";

import { validateAnnotation } from "../../benchmark/manifest";
import {
  type CandidateLine,
  loadCandidateLines,
  validatePacket,
} from "../../benchmark/packet-validation";

const PINNED = "a".repeat(40);

const SOURCE = [
  "import mailer from './mailer';",
  "function addSignup(email) {",
  "  // send the welcome mail",
  "  return mailer.send({ to: email });",
  "}",
  "",
].join("\n");

const CANDIDATES: CandidateLine[] = [
  { file: "src/signup.js", line: 1 },
  { file: "src/signup.js", line: 2 },
  { file: "src/signup.js", line: 4 },
];

function record(id: string, line: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    layer: "mentions",
    subject: { key: "mention:email", name: "email" },
    evidence: { file_path: "src/signup.js", start_line: line, end_line: line },
    rationale: "Labeled for the packet validator test.",
    expected: { status: "positive", labels: ["email"] },
    provenance: {
      proposed_by: "test-agent",
      proposed_at: "2026-09-28",
      review_state: "proposed",
    },
    ...extra,
  };
}

function validPacket() {
  return {
    packet: {
      repo: "example",
      concept: "email",
      kanbus_issue: "KDATAP-000000",
      files: ["src/signup.js"],
    },
    annotations: [
      record("import-mailer", 1, {
        expected: { status: "negative", labels: ["email"] },
        mention_attributes: { syntax_kind: "import_specifier" },
      }),
      record("add-signup-param", 2, {
        mention_attributes: {
          syntax_kind: "identifier",
          declaration: { file_path: "src/signup.js", line: 2, kind: "parameter" },
          owner: "api",
        },
      }),
      record("send-to", 4, {
        mention_attributes: {
          syntax_kind: "identifier",
          declaration: { file_path: "src/signup.js", line: 2, kind: "parameter" },
          owner: "api",
          touches: ["third_party:mailer"],
          group: "signup-email",
        },
      }),
    ],
  };
}

describe("benchmark/packet-validation", () => {
  let dir: string;
  let sourceRoot: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "packet-validation-"));
    sourceRoot = path.join(dir, "source");
    fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "src", "signup.js"), SOURCE);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(packet: unknown, head: string | undefined = PINNED) {
    const packetPath = path.join(dir, "packet.yaml");
    fs.writeFileSync(packetPath, YAML.stringify(packet));
    return validatePacket(packetPath, CANDIDATES, {
      sourceRoot,
      pinnedCommit: PINNED,
      readHeadCommit: () => head,
    });
  }

  it("accepts a packet that covers every candidate line once", () => {
    const result = run(validPacket());
    expect(result.errors).toEqual([]);
    expect(result.recordCount).toBe(3);
    expect(result.candidateCount).toBe(3);
  });

  it("rejects a packet that misses a candidate line", () => {
    const packet = validPacket();
    packet.annotations = packet.annotations.filter((entry) => entry.id !== "send-to");
    expect(run(packet).errors).toContain("Missing record for candidate src/signup.js:4");
  });

  it("rejects a record whose line is outside the file", () => {
    const packet = validPacket();
    packet.annotations.push(record("past-end", 99));
    const { errors } = run(packet);
    expect(errors).toContain("annotations[3]: line 99 is outside 'src/signup.js' (5 lines)");
  });

  it("rejects unknown fields on records and in mention_attributes", () => {
    const packet = validPacket();
    packet.annotations[0] = { ...packet.annotations[0], confidence: 0.9 } as never;
    packet.annotations[1] = record("add-signup-param", 2, {
      mention_attributes: { syntax_kind: "identifier", purpose: "signup" },
    });
    const { errors } = run(packet);
    expect(errors).toContain("annotations[0]: unknown field 'confidence'");
    expect(errors.some((error) => error.includes("Unknown field 'purpose'"))).toBe(true);
  });

  it("rejects two records for one candidate line", () => {
    const packet = validPacket();
    packet.annotations.push(record("send-to-again", 4));
    expect(run(packet).errors).toContain(
      "Candidate src/signup.js:4 has 2 records; expected exactly one",
    );
  });

  it("rejects records that are not proposed or not mentions", () => {
    const packet = validPacket();
    packet.annotations[1] = record("add-signup-param", 2, {
      provenance: { proposed_by: "agent", proposed_at: "2026-09-28", review_state: "accepted" },
    });
    expect(run(packet).errors).toContain(
      "annotations[1]: packet records must have review_state 'proposed'",
    );
  });

  it("rejects a declaration that points outside the file", () => {
    const packet = validPacket();
    packet.annotations[2] = record("send-to", 4, {
      mention_attributes: {
        declaration: { file_path: "src/signup.js", line: 40, kind: "parameter" },
      },
    });
    expect(run(packet).errors).toContain(
      "annotations[2].declaration: line 40 is outside 'src/signup.js' (5 lines)",
    );
  });

  it("rejects source that is not at the pinned commit", () => {
    const { errors } = run(validPacket(), "b".repeat(40));
    expect(errors[0]).toMatch(/expected pinned a{40}/);
  });

  it("warns about records that are not candidate lines", () => {
    const packet = validPacket();
    packet.annotations.push(record("comment-line", 3));
    const result = run(packet);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toMatch(/comment-line.*not a candidate line/);
  });

  it("reads candidate files written as a list or under 'candidates'", () => {
    const listPath = path.join(dir, "list.yaml");
    const nestedPath = path.join(dir, "nested.yaml");
    fs.writeFileSync(listPath, YAML.stringify([{ file: "a.js", line: 3, text: "email" }]));
    fs.writeFileSync(nestedPath, YAML.stringify({ candidates: [{ file_path: "a.js", line: 3 }] }));
    expect(loadCandidateLines(listPath)).toEqual([{ file: "a.js", line: 3 }]);
    expect(loadCandidateLines(nestedPath)).toEqual([{ file: "a.js", line: 3 }]);
  });
});

describe("benchmark/manifest mention_attributes", () => {
  it("parses asserted mention attributes", () => {
    const parsed = validateAnnotation(
      record("x", 2, {
        mention_attributes: {
          syntax_kind: "property_key",
          declaration: "unresolved",
          type_annotation: "SignupDto",
          touches: ["third_party:mailer"],
        },
      }),
      "file.yaml",
      0,
    );
    expect(parsed.mention_attributes).toEqual({
      syntax_kind: "property_key",
      declaration: "unresolved",
      type_annotation: "SignupDto",
      touches: ["third_party:mailer"],
    });
  });

  it("rejects mention attributes on other layers and unknown syntax kinds", () => {
    const onComponents = {
      ...record("x", 2, { mention_attributes: { owner: "api" } }),
      layer: "components",
      subject: { key: "asset:api" },
    };
    expect(() => validateAnnotation(onComponents, "file.yaml", 0)).toThrow(
      /only supported on mentions layer/,
    );
    expect(() =>
      validateAnnotation(
        record("x", 2, { mention_attributes: { syntax_kind: "keyword" } }),
        "file.yaml",
        0,
      ),
    ).toThrow(/syntax_kind 'keyword'/);
  });
});
