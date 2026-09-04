import type { EvalCase } from "../../types";
import { withExhaustiveScope } from "../../exhaustive-scopes";

/**
 * Data-action ground truth from fixture intent + PRD — never from scan() output.
 * ≥3 positives per canonical verb. Cases that derivation already covers omit
 * documentedGap; remaining intentional fixture subjects keep documentedGap until
 * component detection + patterns attach (follow-ups after 1.3).
 */
const dataActionEvalCaseList: EvalCase[] = [
  // --- store (≥3 from existing fixtures) ---
  {
    id: "ts-pg-store",
    fixture: "typescript-basic",
    layer: "data-actions",
    subject: { key: "asset:pg", name: "Pg" },
    evidence: { file_path: "db-client-import.ts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["store"] },
    rationale:
      "pg-backed database asset persists subject data (PRD store / retention).",
  },
  {
    id: "tf-rds-store",
    fixture: "terraform-basic",
    layer: "data-actions",
    subject: { key: "asset:main (aws_db_instance)", name: "Main (aws_db_instance)" },
    evidence: { file_path: "main.tf", start_line: 5, end_line: 10 },
    expected: { status: "positive", labels: ["store"] },
    rationale: "aws_db_instance.main is managed PostgreSQL storage (DA-4 store).",
  },
  {
    id: "tf-s3-store",
    fixture: "terraform-basic",
    layer: "data-actions",
    subject: { key: "asset:data (aws_s3_bucket)", name: "Data (aws_s3_bucket)" },
    evidence: { file_path: "main.tf", start_line: 12, end_line: 14 },
    expected: { status: "positive", labels: ["store"] },
    rationale: "aws_s3_bucket.data is object storage retention (DA-4 store).",
  },
  {
    id: "java-jdbc-store",
    fixture: "java-basic",
    layer: "data-actions",
    subject: { key: "asset:jdbc:postgresql", name: "Jdbc:postgresql" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/config/DatabaseConfiguration.java",
      start_line: 11,
      end_line: 11,
    },
    expected: { status: "positive", labels: ["store"] },
    rationale: "Hikari JDBC PostgreSQL URL is a database persistence target.",
  },

  // --- disclose (≥3 from existing fixtures) ---
  {
    id: "ts-stripe-disclose",
    fixture: "typescript-basic",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: { file_path: "external-api.ts", start_line: 6, end_line: 6 },
    expected: { status: "positive", labels: ["disclose"] },
    rationale: "Outbound fetch to api.stripe.com discloses data to a third party.",
  },
  {
    id: "py-openai-disclose",
    fixture: "python-basic",
    layer: "data-actions",
    subject: { key: "third_party:openai", name: "Openai" },
    evidence: { file_path: "app.py", start_line: 11, end_line: 11 },
    expected: { status: "positive", labels: ["disclose"] },
    rationale: "requests.get to api.openai.com is outbound disclosure to OpenAI.",
  },
  {
    id: "java-stripe-disclose",
    fixture: "java-basic",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/web/CustomersController.java",
      start_line: 31,
      end_line: 31,
    },
    expected: { status: "positive", labels: ["disclose"] },
    rationale: "RestTemplate POST of customer payload to Stripe discloses PII.",
  },
  {
    id: "dotnet-stripe-disclose",
    fixture: "dotnet-manifests-basic",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["disclose"] },
    rationale: "Stripe.net package indicates outbound payment disclosure sink.",
  },

  // --- negative: passport is local auth, not disclose ---
  {
    id: "ts-passport-no-disclose",
    fixture: "typescript-basic",
    layer: "data-actions",
    subject: { key: "third_party:passport", name: "Passport" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: ["disclose"] },
    rationale:
      "passport.authenticate is local JWT middleware, not third-party disclosure.",
  },

  // --- collect (data-actions-basic) ---
  {
    id: "dab-signup-collect",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:signup-api", name: "Signup-api" },
    evidence: { file_path: "collect.ts", start_line: 29, end_line: 33 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale: "POST /signup captures email and name from the data subject (PRD collect).",
  },
  {
    id: "dab-geo-collect",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:geo-client", name: "Geo-client" },
    evidence: { file_path: "collect.ts", start_line: 37, end_line: 39 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale: "navigator.geolocation.getCurrentPosition first-captures subject location.",
  },
  {
    id: "dab-segment-collect",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "third_party:segment", name: "Segment" },
    evidence: { file_path: "collect.ts", start_line: 43, end_line: 44 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale: "Segment analytics.load/track ingests subject events (collect/ingest).",
  },

  // --- generate ---
  {
    id: "dab-score-generate",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:risk-scorer", name: "Risk-scorer" },
    evidence: { file_path: "generate.ts", start_line: 5, end_line: 8 },
    expected: { status: "positive", labels: ["generate"], documentedGap: true },
    rationale: "scoreUser derives a new numeric score from subject features (PRD generate).",
  },
  {
    id: "dab-infer-generate",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:risk-inferencer", name: "Risk-inferencer" },
    evidence: { file_path: "generate.ts", start_line: 10, end_line: 13 },
    expected: { status: "positive", labels: ["generate"], documentedGap: true },
    rationale: "inferRisk creates a new risk label about the subject from email.",
  },
  {
    id: "dab-derive-generate",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:profile-deriver", name: "Profile-deriver" },
    evidence: { file_path: "generate.ts", start_line: 15, end_line: 18 },
    expected: { status: "positive", labels: ["generate"], documentedGap: true },
    rationale: "deriveProfileField creates a new profile string from name PII.",
  },

  // --- transform ---
  {
    id: "dab-hash-transform",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:email-hasher", name: "Email-hasher" },
    evidence: { file_path: "transform.ts", start_line: 6, end_line: 9 },
    expected: { status: "positive", labels: ["transform"], documentedGap: true },
    rationale: "createHash(sha256) of email is a pseudonymizing transform.",
  },
  {
    id: "dab-anonymize-transform",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:record-anonymizer", name: "Record-anonymizer" },
    evidence: { file_path: "transform.ts", start_line: 11, end_line: 15 },
    expected: { status: "positive", labels: ["transform"], documentedGap: true },
    rationale: "anonymizeRecord strips email and keeps only an age bucket (anonymize→transform).",
  },
  {
    id: "dab-aggregate-transform",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:purchase-aggregator", name: "Purchase-aggregator" },
    evidence: { file_path: "transform.ts", start_line: 17, end_line: 20 },
    expected: { status: "positive", labels: ["transform"], documentedGap: true },
    rationale: "aggregatePurchases reduces amounts to a single metric (aggregate→transform).",
  },

  // --- use ---
  {
    id: "dab-approve-use",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:order-approver", name: "Order-approver" },
    evidence: { file_path: "use.ts", start_line: 5, end_line: 8 },
    expected: { status: "positive", labels: ["use"], documentedGap: true },
    rationale: "approveOrder decides from in-memory balance/price without persisting.",
  },
  {
    id: "dab-plan-use",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:plan-selector", name: "Plan-selector" },
    evidence: { file_path: "use.ts", start_line: 10, end_line: 13 },
    expected: { status: "positive", labels: ["use"], documentedGap: true },
    rationale: "selectPlan consults userTier for a decision with no store write.",
  },
  {
    id: "dab-adult-use",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:age-gate", name: "Age-gate" },
    evidence: { file_path: "use.ts", start_line: 15, end_line: 18 },
    expected: { status: "positive", labels: ["use"], documentedGap: true },
    rationale: "isAdult uses age for a boolean decision without retention.",
  },

  // --- combine ---
  {
    id: "dab-merge-combine",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:profile-merger", name: "Profile-merger" },
    evidence: { file_path: "combine.ts", start_line: 5, end_line: 11 },
    expected: { status: "positive", labels: ["combine"], documentedGap: true },
    rationale: "mergeProfile joins local profile with CRM fields (merge→combine).",
  },
  {
    id: "dab-join-combine",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:order-joiner", name: "Order-joiner" },
    evidence: { file_path: "combine.ts", start_line: 13, end_line: 22 },
    expected: { status: "positive", labels: ["combine"], documentedGap: true },
    rationale: "joinOrdersWithUsers joins users and orders across sources (join→combine).",
  },
  {
    id: "dab-enrich-combine",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:segment-enricher", name: "Segment-enricher" },
    evidence: { file_path: "combine.ts", start_line: 24, end_line: 30 },
    expected: { status: "positive", labels: ["combine"], documentedGap: true },
    rationale: "enrichWithSegment enriches a user with traits from another source.",
  },

  // --- relay (proxy/passthrough intent; documentedGap until corroboration) ---
  {
    id: "dab-proxy-relay",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:billing-proxy", name: "Billing-proxy" },
    evidence: { file_path: "relay.ts", start_line: 20, end_line: 26 },
    expected: { status: "positive", labels: ["relay"], documentedGap: true },
    rationale:
      "createProxyMiddleware passthrough to billing.internal is a conduit (proxy→relay); needs pattern corroboration before asserted.",
  },
  {
    id: "dab-forward-relay",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:webhook-forwarder", name: "Webhook-forwarder" },
    evidence: { file_path: "relay.ts", start_line: 29, end_line: 35 },
    expected: { status: "positive", labels: ["relay"], documentedGap: true },
    rationale: "forwardWebhook POSTs payload upstream without local store/use (forward→relay).",
  },
  {
    id: "dab-passthrough-relay",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:passthrough-gateway", name: "Passthrough-gateway" },
    evidence: { file_path: "relay.ts", start_line: 38, end_line: 40 },
    expected: { status: "positive", labels: ["relay"], documentedGap: true },
    rationale: "passthroughGateway returns method/url only — no meaningful processing (passthrough→relay).",
  },

  // --- display ---
  {
    id: "dab-email-html-display",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:welcome-page", name: "Welcome-page" },
    evidence: { file_path: "display.ts", start_line: 10, end_line: 13 },
    expected: { status: "positive", labels: ["display"], documentedGap: true },
    rationale: "renderEmailPage sends HTML that surfaces subject email to the viewer.",
  },
  {
    id: "dab-profile-json-display",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:profile-api", name: "Profile-api" },
    evidence: { file_path: "display.ts", start_line: 15, end_line: 21 },
    expected: { status: "positive", labels: ["display"], documentedGap: true },
    rationale: "returnProfileJson returns email/name PII in an API response (display).",
  },
  {
    id: "dab-ssn-display",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:ssn-viewer", name: "Ssn-viewer" },
    evidence: { file_path: "display.ts", start_line: 23, end_line: 26 },
    expected: { status: "positive", labels: ["display"], documentedGap: true },
    rationale: "showSsnLast4 surfaces truncated SSN to an authenticated viewer.",
  },

  // --- log ---
  {
    id: "dab-signup-log",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:signup-logger", name: "Signup-logger" },
    evidence: { file_path: "log.ts", start_line: 13, end_line: 13 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "logger.info logs email on the same line (PRAM logging / PII co-occurrence).",
  },
  {
    id: "dab-ssn-log",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:payment-logger", name: "Payment-logger" },
    evidence: { file_path: "log.ts", start_line: 18, end_line: 18 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "logger.error includes ssn on the same call — shadow store via logs.",
  },
  {
    id: "dab-phone-log",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:debug-logger", name: "Debug-logger" },
    evidence: { file_path: "log.ts", start_line: 23, end_line: 23 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "logger.debug writes phone into telemetry logs.",
  },

  // --- delete (existing java + data-actions-basic) ---
  {
    id: "java-jpa-delete",
    fixture: "java-basic",
    layer: "data-actions",
    subject: { key: "asset:spring data jpa", name: "Spring data jpa" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/web/CustomersController.java",
      start_line: 39,
      end_line: 39,
    },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "repository.delete(id) on DELETE /customers/{id} is disposal (PRD delete).",
  },
  {
    id: "dab-http-delete",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:user-store", name: "User-store" },
    evidence: { file_path: "delete.ts", start_line: 21, end_line: 24 },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "DELETE /users/:id calls userStore.erase — retention enforcement.",
  },
  {
    id: "dab-purge-delete",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:session-purger", name: "Session-purger" },
    evidence: { file_path: "delete.ts", start_line: 26, end_line: 29 },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "purgeExpiredSessions invokes purgeExpired (purge→delete).",
  },
  {
    id: "dab-ttl-delete",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:retention-ttl", name: "Retention-ttl" },
    evidence: { file_path: "delete.ts", start_line: 31, end_line: 31 },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "RETENTION_TTL_DAYS config encodes disposal/TTL enforcement.",
  },

  // Extra store/disclose from existing fixtures for depth
  {
    id: "py-psycopg2-store",
    fixture: "python-basic",
    layer: "data-actions",
    subject: { key: "asset:psycopg2", name: "Psycopg2" },
    evidence: { file_path: "app.py", start_line: 7, end_line: 7 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "psycopg2.connect targets Postgres persistence (store).",
  },
  {
    id: "dotnet-npgsql-store",
    fixture: "dotnet-manifests-basic",
    layer: "data-actions",
    subject: { key: "asset:npgsql", name: "Npgsql" },
    evidence: { file_path: "src/Api/Api.csproj", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["store"] },
    rationale: "Npgsql package is a PostgreSQL persistence client (store).",
  },

  // =========================================================================
  // Multi-verb subjects (set-valued model) — one case row per verb
  // =========================================================================

  // asset:checkout-api — collect + store + disclose + log
  {
    id: "dab-checkout-collect",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "combos.ts", start_line: 41, end_line: 43 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale:
      "POST /checkout captures email/card/name from the subject (collect); same node also stores, discloses, and logs.",
  },
  {
    id: "dab-checkout-store",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "combos.ts", start_line: 46, end_line: 46 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "db.insertUser persists checkout customer data on the same checkout-api node.",
  },
  {
    id: "dab-checkout-disclose",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "combos.ts", start_line: 49, end_line: 53 },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale: "fetch to api.stripe.com/v1/charges discloses payment PII from checkout-api.",
  },
  {
    id: "dab-checkout-log",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "combos.ts", start_line: 56, end_line: 56 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "logger.info logs email on the same checkout handler (disclose+store+collect sibling verbs).",
  },

  // asset:hash-writer — transform (pseudonymized) + store
  {
    id: "dab-hash-writer-transform",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:hash-writer", name: "Hash-writer" },
    evidence: { file_path: "combos.ts", start_line: 66, end_line: 66 },
    expected: { status: "positive", labels: ["transform"], documentedGap: true },
    rationale:
      "createHash(sha256) of email is a transform with qualifier intent pseudonymized; node also stores the hash.",
  },
  {
    id: "dab-hash-writer-store",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:hash-writer", name: "Hash-writer" },
    evidence: { file_path: "combos.ts", start_line: 68, end_line: 68 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "db.insertHashed persists the pseudonym after transform on hash-writer.",
  },

  // asset:crm-sync — combine + store
  {
    id: "dab-crm-sync-combine",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:crm-sync", name: "Crm-sync" },
    evidence: { file_path: "combos.ts", start_line: 79, end_line: 79 },
    expected: { status: "positive", labels: ["combine"], documentedGap: true },
    rationale: "syncCrmProfile merges local + CRM records (combine) before upsert.",
  },
  {
    id: "dab-crm-sync-store",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:crm-sync", name: "Crm-sync" },
    evidence: { file_path: "combos.ts", start_line: 81, end_line: 81 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "db.upsertMerged stores the combined CRM profile on crm-sync.",
  },

  // asset:edge-proxy — relay + log
  {
    id: "dab-edge-proxy-relay",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:edge-proxy", name: "Edge-proxy" },
    evidence: { file_path: "combos.ts", start_line: 87, end_line: 96 },
    expected: { status: "positive", labels: ["relay"], documentedGap: true },
    rationale:
      "createProxyMiddleware passthrough is relay on edge-proxy; needs corroboration before asserted (documentedGap).",
  },
  {
    id: "dab-edge-proxy-log",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "asset:edge-proxy", name: "Edge-proxy" },
    evidence: { file_path: "combos.ts", start_line: 94, end_line: 94 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "edge-proxy logs authorization metadata while also relaying upstream.",
  },

  // Existing fixture multi-verb: spring data jpa store + delete
  {
    id: "java-jpa-store",
    fixture: "java-basic",
    layer: "data-actions",
    subject: { key: "asset:spring data jpa", name: "Spring data jpa" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 1,
      end_line: 1,
    },
    expected: { status: "positive", labels: ["store"] },
    rationale:
      "Spring Data JPA repository is a persistence asset (store); same subject also deletes via repository.delete.",
  },

  // Negatives — DA-1 actor must not carry dataActions
  {
    id: "dab-actor-no-store",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "actor:end-user", name: "End-user" },
    evidence: { file_path: "combos.ts", start_line: 103, end_line: 103 },
    expected: { status: "negative", labels: ["store"] },
    rationale: "DA-1: actor nodes must never receive dataActions (store must not fire).",
  },
  {
    id: "dab-actor-no-collect",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "actor:end-user", name: "End-user" },
    evidence: { file_path: "combos.ts", start_line: 103, end_line: 103 },
    expected: { status: "negative", labels: ["collect"] },
    rationale: "DA-1: actor nodes must never receive dataActions (collect must not fire).",
  },
  {
    id: "dab-actor-no-disclose",
    fixture: "data-actions-basic",
    layer: "data-actions",
    subject: { key: "actor:end-user", name: "End-user" },
    evidence: { file_path: "combos.ts", start_line: 103, end_line: 103 },
    expected: { status: "negative", labels: ["disclose"] },
    rationale: "DA-1: actor nodes must never receive dataActions (disclose must not fire).",
  },

  // =========================================================================
  // Language breadth — Python (dedicated fixture; leave python-basic PII-clean)
  // =========================================================================
  {
    id: "dap-signup-collect",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:signup-api", name: "Signup-api" },
    evidence: { file_path: "app.py", start_line: 27, end_line: 28 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale: "FastAPI POST /signup captures email/name from the subject (collect).",
  },
  {
    id: "dap-order-store",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:order-writer", name: "Order-writer" },
    evidence: { file_path: "app.py", start_line: 38, end_line: 41 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "psycopg2 INSERT INTO orders persists subject email (store).",
  },
  {
    id: "dap-stripe-disclose",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: { file_path: "app.py", start_line: 50, end_line: 55 },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale: "requests.post to api.stripe.com discloses payment PII (disclose).",
  },
  {
    id: "dap-signup-log",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:signup-logger", name: "Signup-logger" },
    evidence: { file_path: "app.py", start_line: 64, end_line: 64 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "logger.info includes email on the same call (PRAM logging).",
  },
  {
    id: "dap-user-delete",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:user-store", name: "User-store" },
    evidence: { file_path: "app.py", start_line: 74, end_line: 74 },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "DELETE FROM users on HTTP DELETE is disposal (delete).",
  },
  {
    id: "dap-checkout-collect",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "app.py", start_line: 85, end_line: 87 },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale:
      "POST /checkout captures email/card/name; same node also stores, discloses, and logs.",
  },
  {
    id: "dap-checkout-store",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "app.py", start_line: 91, end_line: 94 },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "INSERT INTO customers persists checkout PII on checkout-api.",
  },
  {
    id: "dap-checkout-disclose",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "app.py", start_line: 98, end_line: 103 },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale: "checkout handler POSTs payment PII to api.stripe.com (disclose).",
  },
  {
    id: "dap-checkout-log",
    fixture: "data-actions-python",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: { file_path: "app.py", start_line: 106, end_line: 106 },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "checkout logs email on the same multi-verb handler.",
  },

  // =========================================================================
  // Language breadth — PHP source + dependency-manifest disclose
  // =========================================================================
  {
    id: "daphp-signup-collect",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:signup-api", name: "Signup-api" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 28,
      end_line: 29,
    },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale: "signup() reads email/name from the request payload (collect).",
  },
  {
    id: "daphp-order-store",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:order-writer", name: "Order-writer" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 40,
      end_line: 43,
    },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "PDO INSERT INTO orders persists subject email (store).",
  },
  {
    id: "daphp-stripe-disclose",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 52,
      end_line: 55,
    },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale: "StripeClient customers->create discloses email/card PII.",
  },
  {
    id: "daphp-signup-log",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:signup-logger", name: "Signup-logger" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 66,
      end_line: 66,
    },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "error_log writes email into application logs (log).",
  },
  {
    id: "daphp-user-delete",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:user-store", name: "User-store" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 75,
      end_line: 76,
    },
    expected: { status: "positive", labels: ["delete"], documentedGap: true },
    rationale: "PDO DELETE FROM users is disposal (delete).",
  },
  {
    id: "daphp-checkout-collect",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 85,
      end_line: 87,
    },
    expected: { status: "positive", labels: ["collect"], documentedGap: true },
    rationale:
      "checkout() captures email/card/name; same node also stores, discloses, and logs.",
  },
  {
    id: "daphp-checkout-store",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 90,
      end_line: 93,
    },
    expected: { status: "positive", labels: ["store"], documentedGap: true },
    rationale: "PDO INSERT INTO customers persists checkout PII on checkout-api.",
  },
  {
    id: "daphp-checkout-disclose",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 96,
      end_line: 99,
    },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale: "checkout charges->create discloses payment PII to Stripe.",
  },
  {
    id: "daphp-checkout-log",
    fixture: "data-actions-php",
    layer: "data-actions",
    subject: { key: "asset:checkout-api", name: "Checkout-api" },
    evidence: {
      file_path: "src/CheckoutController.php",
      start_line: 102,
      end_line: 102,
    },
    expected: { status: "positive", labels: ["log"], documentedGap: true },
    rationale: "checkout error_log includes email on the multi-verb handler.",
  },
  {
    id: "php-manifest-stripe-disclose",
    fixture: "php-dependency-manifests-basic",
    layer: "data-actions",
    subject: { key: "third_party:stripe", name: "Stripe" },
    evidence: { file_path: "composer.json", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["disclose"], documentedGap: true },
    rationale:
      "stripe/stripe-php in composer require indicates outbound payment disclosure sink.",
  },
];

export const dataActionEvalCases = withExhaustiveScope(dataActionEvalCaseList);
