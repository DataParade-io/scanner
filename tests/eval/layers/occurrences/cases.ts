import type { EvalCase } from "../../types";
import { withExhaustiveScope } from "../../exhaustive-scopes";

/** Ground-truth occurrence (file+line receipt) cases from committed fixtures. */
const occurrenceEvalCaseList: EvalCase[] = [
  {
    id: "occurrence-ruby-email",
    fixture: "ruby-basic",
    layer: "occurrences",
    subject: { key: "occurrence:email", name: "email occurrence" },
    evidence: {
      file_path: "app/controllers/api/users_controller.rb",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale: "Rails strong parameters contain an email-field occurrence.",
  },
  {
    id: "occurrence-jvm-yaml-username",
    fixture: "jvm-manifests-basic",
    layer: "occurrences",
    subject: { key: "occurrence:username", name: "username occurrence" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Spring datasource username property is a credentials-category username occurrence.",
  },
  {
    id: "occurrence-jvm-yaml-username-bootstrap",
    fixture: "jvm-manifests-basic",
    layer: "occurrences",
    subject: { key: "occurrence:username", name: "username occurrence" },
    evidence: {
      file_path: "src/main/resources/bootstrap.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Bootstrap datasource username is a second username occurrence; exhaustive precision requires this span.",
  },
  {
    id: "occurrence-jvm-yaml-password",
    fixture: "jvm-manifests-basic",
    layer: "occurrences",
    subject: { key: "occurrence:password", name: "password occurrence" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["user_password"] },
    rationale:
      "Spring datasource password property is a credentials-category password occurrence.",
  },
  {
    id: "occurrence-java-email-parameter",
    fixture: "java-basic",
    layer: "occurrences",
    subject: { key: "occurrence:email", name: "email occurrence" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 9,
      end_line: 9,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale:
      "Repository method parameter named email is an email data-item occurrence at this span.",
  },
  {
    id: "occurrence-dotnet-connection-username",
    fixture: "dotnet-manifests-basic",
    layer: "occurrences",
    subject: { key: "occurrence:username", name: "username occurrence" },
    evidence: {
      file_path: "src/Api/appsettings.json",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Connection string Username token in appsettings.json is a username occurrence.",
  },
  {
    id: "occurrence-tf-address-not-profile",
    fixture: "terraform-basic",
    layer: "occurrences",
    subject: { key: "occurrence:address", name: "address occurrence" },
    evidence: { file_path: "main.tf", start_line: 29, end_line: 29 },
    expected: { status: "negative", labels: [] },
    rationale:
      "aws_db_instance.main.address is a Terraform hostname attribute, not a postal-address occurrence.",
  },
  {
    id: "occurrence-ts-passport-auth-not-number",
    fixture: "typescript-basic",
    layer: "occurrences",
    subject: { key: "occurrence:passport", name: "passport occurrence" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate is local JWT middleware, not a passport-number occurrence.",
  },
  {
    id: "occurrence-tf-bind-address-not-profile",
    fixture: "terraform-basic",
    layer: "occurrences",
    subject: { key: "occurrence:address", name: "address occurrence" },
    evidence: { file_path: "main.tf", start_line: 36, end_line: 36 },
    expected: { status: "negative", labels: [] },
    rationale:
      "output bind_address is an infra hostname alias, not a postal-address occurrence.",
  },
  {
    id: "occurrence-ts-passport-strategy-not-number",
    fixture: "typescript-basic",
    layer: "occurrences",
    subject: { key: "occurrence:passport", name: "passport occurrence" },
    evidence: { file_path: "server.ts", start_line: 31, end_line: 31 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport_strategy is a local JWT strategy name, not a passport-number occurrence.",
  },
  {
    id: "occurrence-py-no-email",
    fixture: "python-basic",
    layer: "occurrences",
    subject: { key: "occurrence:email", name: "email occurrence" },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "negative", labels: [] },
    rationale:
      "The OpenAI HTTP call must not be an email occurrence; keeps python-basic in the PII precision world.",
  },
];

export const occurrenceEvalCases = withExhaustiveScope(occurrenceEvalCaseList);
