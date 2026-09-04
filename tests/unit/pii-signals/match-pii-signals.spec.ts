import {
  matchPiiSignalsInFile,
  matchPiiSignalsInFiles,
  piiSignalIdentity,
} from "../../../src/pii-signals/match-pii-signals";
import { loadPiiSignalRules } from "../../../src/pii-signals/pii-signal-rules";

describe("matchPiiSignalsInFile", () => {
  const rules = loadPiiSignalRules();

  it("matches username and password on separate lines", () => {
    const content = [
      "spring:",
      "  datasource:",
      "    username: billing_app",
      "    password: super-secret-value",
    ].join("\n");

    const hits = matchPiiSignalsInFile(
      { filePath: "application.yml", content },
      rules,
    );

    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "username",
          category: "credentials",
          labels: ["username"],
          evidence: {
            filePath: "application.yml",
            startLine: 3,
            endLine: 3,
            reason: "matched pii:username signal",
          },
        }),
        expect.objectContaining({
          id: "password",
          category: "credentials",
          labels: ["user_password"],
          evidence: {
            filePath: "application.yml",
            startLine: 4,
            endLine: 4,
            reason: "matched pii:password signal",
          },
        }),
      ]),
    );
  });

  it("matches email on a parameter declaration", () => {
    const content = "Customer findByEmail(String email);";
    const hits = matchPiiSignalsInFile(
      { filePath: "CustomerRepository.java", content },
      rules,
    );

    expect(hits).toEqual([
      {
        id: "email",
        category: "credentials",
        labels: ["user_email"],
        evidence: {
          filePath: "CustomerRepository.java",
          startLine: 1,
          endLine: 1,
          reason: "matched pii:email signal",
        },
      },
    ]);
  });

  it("does not match passport auth middleware without passport number tokens", () => {
    const content = "passport.authenticate(\"jwt\", { session: false }),";
    const hits = matchPiiSignalsInFile(
      { filePath: "server.ts", content },
      rules,
    );

    expect(hits).toEqual([]);
  });

  it("does not match standalone address on terraform resource attributes", () => {
    const content = "DATABASE_URL = aws_db_instance.main.address";
    const hits = matchPiiSignalsInFile(
      { filePath: "main.tf", content },
      rules,
    );

    expect(hits).toEqual([]);
  });

  it("aggregates hits across files", () => {
    const hits = matchPiiSignalsInFiles(
      [
        { filePath: "a.yml", content: "username: app" },
        { filePath: "b.yml", content: "password: secret" },
      ],
      rules,
    );

    expect(hits.map((hit) => hit.id)).toEqual(["username", "password"]);
  });

  it("formats pii signal identity for eval subjects", () => {
    expect(piiSignalIdentity("email")).toBe("raw_hit:email");
  });

  it("matches user_email via identifier alias", () => {
    const content = "* @property string $user_email";
    const hits = matchPiiSignalsInFile(
      { filePath: "class-wp-user.php", content },
      rules,
    );

    expect(hits).toEqual([
      expect.objectContaining({
        id: "email",
        evidence: expect.objectContaining({
          startLine: 1,
          reason: "matched pii:email alias:user_email",
        }),
      }),
    ]);
  });

  it("matches user_pass via identifier alias", () => {
    const content = "* @property string $user_pass";
    const hits = matchPiiSignalsInFile(
      { filePath: "class-wp-user.php", content },
      rules,
    );

    expect(hits).toEqual([
      expect.objectContaining({
        id: "password",
        evidence: expect.objectContaining({
          reason: "matched pii:password alias:user_pass",
        }),
      }),
    ]);
  });

  it("matches external_email via identifier alias", () => {
    const content = "#  external_email                  :string";
    const hits = matchPiiSignalsInFile(
      { filePath: "single_sign_on_record.rb", content },
      rules,
    );

    expect(hits).toEqual([
      expect.objectContaining({
        id: "email",
        evidence: expect.objectContaining({
          reason: "matched pii:email alias:external_email",
        }),
      }),
    ]);
  });

  it("matches birthday via identifier alias", () => {
    const content = '            "birthday",';
    const hits = matchPiiSignalsInFile(
      { filePath: "employee.py", content },
      rules,
    );

    expect(hits).toEqual([
      expect.objectContaining({
        id: "date_of_birth",
        evidence: expect.objectContaining({
          reason: "matched pii:date_of_birth alias:birthday",
        }),
      }),
    ]);
  });

  it("matches bare address field declarations via gated alias", () => {
    const pythonField =
      '    address = models.CharField(max_length=150, default="Not Set")';
    const javaField = "\tprivate String address;";

    expect(
      matchPiiSignalsInFile({ filePath: "models.py", content: pythonField }, rules),
    ).toEqual([
      expect.objectContaining({
        id: "address",
        evidence: expect.objectContaining({
          reason: "matched pii:address alias:address",
        }),
      }),
    ]);

    expect(
      matchPiiSignalsInFile({ filePath: "Owner.java", content: javaField }, rules),
    ).toEqual([
      expect.objectContaining({
        id: "address",
      }),
    ]);
  });

  it("matches getter forms via camelCase token splitting", () => {
    const content = [
      "public function getFirstname();",
      "public function getFax();",
    ].join("\n");

    const hits = matchPiiSignalsInFile(
      { filePath: "Address.php", content },
      rules,
    );

    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "first_name",
          evidence: expect.objectContaining({
            startLine: 1,
            reason: "matched pii:first_name alias:getFirstname",
          }),
        }),
        expect.objectContaining({
          id: "phone_number",
          evidence: expect.objectContaining({
            startLine: 2,
            reason: "matched pii:phone_number alias:getFax",
          }),
        }),
      ]),
    );
  });
});
