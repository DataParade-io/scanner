import type { EvalCase } from "../../types";
import { withExhaustiveScope } from "../../exhaustive-scopes";

/** Ground-truth data-flow cases across committed fixtures. */
const dataFlowEvalCaseList: EvalCase[] = [
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
  {
    id: "java-jdbc-database-flow",
    fixture: "java-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:root api->asset:jdbc:postgresql",
      name: "Root API → JDBC PostgreSQL",
    },
    evidence: {
      file_path: "src/main/java/com/acme/billing/config/DatabaseConfiguration.java",
      start_line: 11,
      end_line: 11,
    },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Root API queries the JDBC PostgreSQL asset from the Hikari URL.",
  },
  {
    id: "java-jpa-database-flow",
    fixture: "java-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:root api->asset:spring data jpa",
      name: "Root API → Spring Data JPA",
    },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 1,
      end_line: 1,
    },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Root API queries Spring Data JPA from the repository.",
  },
  {
    id: "jvm-ledger-postgres-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:postgresql jdbc",
      name: "Ledger → PostgreSQL JDBC",
    },
    evidence: { file_path: "pom.xml", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries PostgreSQL JDBC from the Maven manifest.",
  },
  {
    id: "jvm-ledger-jpa-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:spring data jpa",
      name: "Ledger → Spring Data JPA",
    },
    evidence: { file_path: "pom.xml", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries Spring Data JPA from the Maven manifest.",
  },
  {
    id: "jvm-ledger-jedis-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:jedis",
      name: "Ledger → Jedis",
    },
    evidence: { file_path: "pom.xml", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries Jedis from the Maven manifest.",
  },
  {
    id: "jvm-ledger-mongo-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:jdbc:mongo",
      name: "Ledger → Mongo",
    },
    evidence: { file_path: "src/main/resources/application.yml", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries Mongo from the Spring YAML uri.",
  },
  {
    id: "jvm-ledger-hikaricp-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:hikaricp",
      name: "Ledger → HikariCP",
    },
    evidence: { file_path: "services/ledger/build.gradle.kts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries HikariCP from the Gradle module.",
  },
  {
    id: "jvm-ledger-mysql-flow",
    fixture: "jvm-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:ledger->asset:mysql jdbc",
      name: "Ledger → MySQL JDBC",
    },
    evidence: { file_path: "services/ledger/build.gradle.kts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "Ledger app queries MySQL JDBC from the Gradle module.",
  },
  {
    id: "dotnet-api-npgsql-flow",
    fixture: "dotnet-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->asset:npgsql",
      name: "API → Npgsql",
    },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "API queries Npgsql from the project package and connection string.",
  },
  {
    id: "dotnet-api-cache-flow",
    fixture: "dotnet-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->asset:cache",
      name: "API → Cache",
    },
    evidence: { file_path: "src/Api/appsettings.json", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["database_query"] },
    rationale: "API queries the cache connection string.",
  },
  {
    id: "dotnet-api-stripe-flow",
    fixture: "dotnet-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->third_party:stripe",
      name: "API → Stripe",
    },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["api_call"] },
    rationale: "API calls Stripe from the Stripe.net package reference.",
  },
  {
    id: "dotnet-api-sentry-flow",
    fixture: "dotnet-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->third_party:sentry",
      name: "API → Sentry",
    },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["api_call"] },
    rationale: "API calls Sentry from the Sentry.AspNetCore package reference.",
  },
  {
    id: "dotnet-api-aws-flow",
    fixture: "dotnet-manifests-basic",
    layer: "data-flows",
    subject: {
      key: "flow:asset:api->third_party:aws",
      name: "API → AWS",
    },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["api_call"] },
    rationale: "API calls AWS from the AWSSDK.S3 package reference.",
  },
];

export const dataFlowEvalCases = withExhaustiveScope(dataFlowEvalCaseList);
