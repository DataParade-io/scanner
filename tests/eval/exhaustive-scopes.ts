import type { EvalCase } from "./types";

/**
 * Files reviewed as a closed world for precision. Scanner findings whose
 * source paths overlap these lists count in the precision denominator.
 * Findings that do not match an accepted positive are false positives.
 *
 * A repo that does not use Stripe is not a negative case. Extra Stripe
 * hits in an exhaustive file lower precision automatically.
 */
export const EXHAUSTIVE_SCOPE_FILES: Record<string, string[]> = {
  "typescript-basic": [
    "app/route.ts",
    "db-client-import.ts",
    "db.ts",
    "external-api.ts",
    "pg-client.ts",
    "server.ts",
  ],
  "python-basic": ["app.py"],
  "java-basic": [
    "src/main/java/com/acme/billing/config/DatabaseConfiguration.java",
    "src/main/java/com/acme/billing/data/CustomerRepository.java",
    "src/main/java/com/acme/billing/web/CustomersController.java",
  ],
  "terraform-basic": ["main.tf", "providers.tf", "variables.tf"],
  "jvm-manifests-basic": [
    "pom.xml",
    "services/ledger/build.gradle.kts",
    "src/main/resources/application.yml",
    "src/main/resources/bootstrap.yml",
  ],
  "dotnet-manifests-basic": ["src/Api/Api.csproj", "src/Api/appsettings.json"],
  "php-dependency-manifests-basic": ["composer.json"],
  "data-actions-basic": [
    "collect.ts",
    "generate.ts",
    "transform.ts",
    "use.ts",
    "combine.ts",
    "relay.ts",
    "display.ts",
    "log.ts",
    "delete.ts",
    "combos.ts",
  ],
  "data-actions-python": ["app.py"],
  "data-actions-php": ["src/CheckoutController.php", "composer.json"],
};

export function withExhaustiveScope(cases: EvalCase[]): EvalCase[] {
  return cases.map((caseRecord) => {
    const files = EXHAUSTIVE_SCOPE_FILES[caseRecord.fixture];
    if (!files) {
      return caseRecord;
    }
    return { ...caseRecord, exhaustiveScopeFiles: files };
  });
}
