import type { EvalCase } from "../../types";

/** Ground-truth mention (file+line receipt) cases from committed fixtures. */
export const mentionEvalCases: EvalCase[] = [
  {
    id: "mention-jvm-yaml-username",
    fixture: "jvm-manifests-basic",
    layer: "mentions",
    subject: { key: "mention:username", name: "username mention" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Spring datasource username property is a credentials-category username mention.",
  },
  {
    id: "mention-jvm-yaml-password",
    fixture: "jvm-manifests-basic",
    layer: "mentions",
    subject: { key: "mention:password", name: "password mention" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["user_password"] },
    rationale:
      "Spring datasource password property is a credentials-category password mention.",
  },
  {
    id: "mention-java-email-parameter",
    fixture: "java-basic",
    layer: "mentions",
    subject: { key: "mention:email", name: "email mention" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 9,
      end_line: 9,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale:
      "Repository method parameter named email is an email data-item mention at this span.",
  },
  {
    id: "mention-dotnet-connection-username",
    fixture: "dotnet-manifests-basic",
    layer: "mentions",
    subject: { key: "mention:username", name: "username mention" },
    evidence: {
      file_path: "src/Api/appsettings.json",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Connection string Username token in appsettings.json is a username mention.",
  },
  {
    id: "mention-tf-address-not-profile",
    fixture: "terraform-basic",
    layer: "mentions",
    subject: { key: "mention:address", name: "address mention" },
    evidence: { file_path: "main.tf", start_line: 29, end_line: 29 },
    expected: { status: "negative", labels: [] },
    rationale:
      "aws_db_instance.main.address is a Terraform hostname attribute, not a postal-address mention.",
  },
  {
    id: "mention-ts-passport-auth-not-number",
    fixture: "typescript-basic",
    layer: "mentions",
    subject: { key: "mention:passport", name: "passport mention" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate is local JWT middleware, not a passport-number mention.",
  },
];
