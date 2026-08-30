import type { EvalCase } from "../../types";
import { withExhaustiveScope } from "../../exhaustive-scopes";

/** Ground-truth raw YAML pattern hits before roll-up. */
const rawHitEvalCaseList: EvalCase[] = [
  {
    id: "raw-jvm-yaml-username",
    fixture: "jvm-manifests-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:username", name: "username pattern" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "YAML datasource username property triggers the username heuristic rule on this line.",
  },
  {
    id: "raw-jvm-yaml-username-bootstrap",
    fixture: "jvm-manifests-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:username", name: "username pattern" },
    evidence: {
      file_path: "src/main/resources/bootstrap.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Bootstrap datasource username is a second username hit; exhaustive precision requires this span.",
  },
  {
    id: "raw-jvm-yaml-password",
    fixture: "jvm-manifests-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:password", name: "password pattern" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["user_password"] },
    rationale:
      "YAML datasource password property triggers the password heuristic rule on this line.",
  },
  {
    id: "raw-java-email-parameter",
    fixture: "java-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:email", name: "email pattern" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 9,
      end_line: 9,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale:
      "Repository method parameter named email triggers the email heuristic on this line.",
  },
  {
    id: "raw-dotnet-connection-username",
    fixture: "dotnet-manifests-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:username", name: "username pattern" },
    evidence: {
      file_path: "src/Api/appsettings.json",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Connection string Username token triggers the username heuristic on this line.",
  },
  {
    id: "raw-tf-address-not-profile",
    fixture: "terraform-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:address", name: "address pattern" },
    evidence: { file_path: "main.tf", start_line: 29, end_line: 29 },
    expected: { status: "negative", labels: [] },
    rationale:
      "aws_db_instance.main.address is a Terraform hostname attribute; the address heuristic must not fire.",
  },
  {
    id: "raw-ts-passport-auth-not-number",
    fixture: "typescript-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:passport", name: "passport pattern" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate is local JWT middleware; the passport-number heuristic must not fire.",
  },
  {
    id: "raw-tf-bind-address-not-profile",
    fixture: "terraform-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:address", name: "address pattern" },
    evidence: { file_path: "main.tf", start_line: 36, end_line: 36 },
    expected: { status: "negative", labels: [] },
    rationale:
      "output bind_address is an infra hostname alias; street_/mailing_/postal_ address heuristics must not fire.",
  },
  {
    id: "raw-ts-passport-strategy-not-number",
    fixture: "typescript-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:passport", name: "passport pattern" },
    evidence: { file_path: "server.ts", start_line: 31, end_line: 31 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport_strategy is a local JWT strategy name; the passport_number heuristic must not fire.",
  },
  {
    id: "raw-py-no-email",
    fixture: "python-basic",
    layer: "raw-hits",
    subject: { key: "raw_hit:email", name: "email pattern" },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "negative", labels: [] },
    rationale:
      "The OpenAI HTTP call must not fire an email heuristic; keeps python-basic in the PII precision world.",
  },
];

export const rawHitEvalCases = withExhaustiveScope(rawHitEvalCaseList);
