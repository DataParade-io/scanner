import type { EvalCase } from "../../types";

/**
 * Ground-truth data-item cases: identity (type/name/aliases) independent of a
 * single line. Evidence file anchors unread detection; matching is key-only.
 */
export const dataItemEvalCases: EvalCase[] = [
  {
    id: "data-item-jvm-username",
    fixture: "jvm-manifests-basic",
    layer: "data-items",
    subject: { key: "data_item:username", name: "username" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Fixture contains a username data item (Spring datasource username property).",
  },
  {
    id: "data-item-jvm-username-multi-file",
    fixture: "jvm-manifests-basic",
    layer: "data-items",
    subject: { key: "data_item:username", name: "username" },
    evidence: {
      file_path: "src/main/resources/bootstrap.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Username in application.yml and bootstrap.yml rolls up to one data_item:username.",
  },
  {
    id: "data-item-jvm-username-identity-only",
    fixture: "jvm-manifests-basic",
    layer: "data-items",
    subject: { key: "data_item:username", name: "username" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Data items match by identity only; evidence line need not overlap the username hit span.",
  },
  {
    id: "data-item-jvm-password",
    fixture: "jvm-manifests-basic",
    layer: "data-items",
    subject: { key: "data_item:password", name: "password" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["user_password"] },
    rationale:
      "Fixture contains a password data item (Spring datasource password property).",
  },
  {
    id: "data-item-java-email",
    fixture: "java-basic",
    layer: "data-items",
    subject: { key: "data_item:email", name: "email" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 9,
      end_line: 9,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale: "Fixture contains an email data item (repository email parameter).",
  },
  {
    id: "data-item-dotnet-username",
    fixture: "dotnet-manifests-basic",
    layer: "data-items",
    subject: { key: "data_item:username", name: "username" },
    evidence: {
      file_path: "src/Api/appsettings.json",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Fixture contains a username data item (connection string Username token).",
  },
  {
    id: "data-item-tf-no-address",
    fixture: "terraform-basic",
    layer: "data-items",
    subject: { key: "data_item:address", name: "address" },
    evidence: { file_path: "main.tf", start_line: 29, end_line: 29 },
    expected: { status: "negative", labels: [] },
    rationale:
      "Terraform db instance address attribute must not surface a postal-address data item.",
  },
  {
    id: "data-item-ts-no-passport",
    fixture: "typescript-basic",
    layer: "data-items",
    subject: { key: "data_item:passport", name: "passport" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate middleware must not surface a passport-number data item.",
  },
];
