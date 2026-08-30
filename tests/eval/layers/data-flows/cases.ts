import type { EvalCase } from "../../types";

/** Ground-truth data-flow cases across committed fixtures. */
export const dataFlowEvalCases: EvalCase[] = [
  {
    id: "ts-stripe-api-flow",
    fixture: "typescript-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->third_party:stripe",
      name: "API → Stripe",
    },
    evidence: { file_path: "external-api.ts", start_line: 6, end_line: 6 },
    expected: { status: "positive", labels: ["api_call"] },
    rationale:
      "fetch to api.stripe.com wires the section API asset to the Stripe third-party as an api_call.",
  },
  {
    id: "ts-pg-database-flow",
    fixture: "typescript-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:root api->asset:pg",
      name: "Root API → Pg",
    },
    evidence: { file_path: "db-client-import.ts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale:
      "pg module import surfaces a database_query from the root API asset to the pg database asset.",
  },
  {
    id: "ts-passport-no-external-flow",
    fixture: "typescript-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:root api->third_party:passport",
      name: "Root API → Passport",
    },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate('jwt') is local auth middleware; no outbound third-party flow should be emitted.",
  },
  {
    id: "py-openai-api-flow",
    fixture: "python-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:python-basic->third_party:openai",
      name: "Python-basic → OpenAI",
    },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "positive", labels: ["api_call"] },
    rationale:
      "requests.get to api.openai.com produces an api_call from the app asset to OpenAI.",
  },
  {
    id: "py-psycopg2-database-gap",
    fixture: "python-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:python-basic->asset:psycopg2",
      name: "Python-basic → Psycopg2",
    },
    evidence: { file_path: "app.py", start_line: 7, end_line: 7 },
    expected: {
      status: "positive",
      labels: ["database_query"],
      documentedGap: true,
    },
    rationale:
      "psycopg2.connect should emit a database_query to a psycopg2 database asset; scanner currently infers other drivers only.",
  },
  {
    id: "py-stripe-not-openai-flow",
    fixture: "python-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:python-basic->third_party:stripe",
      name: "Python-basic → Stripe",
    },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "negative", labels: [] },
    rationale:
      "The OpenAI HTTP call at this line must not be mislabeled as a Stripe third-party flow.",
  },
  {
    id: "java-stripe-api-flow",
    fixture: "java-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->third_party:stripe",
      name: "API → Stripe",
    },
    evidence: {
      file_path: "src/main/java/com/acme/billing/web/CustomersController.java",
      start_line: 31,
      end_line: 31,
    },
    expected: { status: "positive", labels: ["api_call"] },
    rationale:
      "RestTemplate post to api.stripe.com wires the section API asset to Stripe as an api_call.",
  },
  {
    id: "tf-lambda-db-query-flow",
    fixture: "terraform-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api (aws_lambda_function)->asset:main (aws_db_instance)",
      name: "Lambda API → aws_db_instance",
    },
    evidence: { file_path: "main.tf", start_line: 21, end_line: 32 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale:
      "Lambda DATABASE_URL from aws_db_instance.main.address is a database_query to the managed Postgres asset.",
  },
];
