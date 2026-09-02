import fs from "fs";
import path from "path";
import YAML from "yaml";

import {
  ANNOTATION_STATUSES,
  type AnnotationProvenance,
  type AnnotationCanonical,
  type AnnotationCandidate,
  type AnnotationRecord,
  type BenchmarkLayer,
  type BenchmarkManifest,
  BENCHMARK_LAYERS,
  type DataItemAnnotationCandidate,
  type DataItemEvidenceValidation,
  type FlowAnnotationCandidate,
  type FlowAnnotationCanonical,
  type FlowCandidateEndpoint,
  type FlowDispositionCandidate,
  type LayerScopeRecord,
  normalizeBenchmarkLayer,
  REVIEW_STATES,
  type ReviewState,
} from "./schema";

const LAYER_SUBJECT_PREFIX: Partial<Record<BenchmarkLayer, string>> = {
  raw_hits: "raw_hit:",
  mentions: "mention:",
  data_items: "data_item:",
};

/**
 * Normalize corpus subject keys on load.
 *
 * Legacy `pii_signal:` prefixes migrate to `mention:` / `raw_hit:`.
 */
export function normalizeSubjectKey(layer: BenchmarkLayer, key: string): string {
  const trimmed = key.trim();
  const canonical = normalizeBenchmarkLayer(layer);

  if (canonical === "mentions" && trimmed.startsWith("pii_signal:")) {
    return `mention:${trimmed.slice("pii_signal:".length)}`;
  }
  if (canonical === "raw_hits" && trimmed.startsWith("pii_signal:")) {
    return `raw_hit:${trimmed.slice("pii_signal:".length)}`;
  }

  return trimmed;
}

function assertCanonicalSubjectKey(
  layer: BenchmarkLayer,
  key: string,
  field: string,
): void {
  const canonical = normalizeBenchmarkLayer(layer);
  const expectedPrefix = LAYER_SUBJECT_PREFIX[canonical];
  if (!expectedPrefix) {
    return;
  }

  if (key.startsWith("pii_signal:")) {
    throw new Error(
      `${field}: stale subject.key prefix 'pii_signal:' for layer '${canonical}' — use '${expectedPrefix}'`,
    );
  }

  if (key.startsWith("pii:")) {
    throw new Error(
      `${field}: stale subject.key prefix 'pii:' for layer '${canonical}' — use '${expectedPrefix}'`,
    );
  }

  if (!key.startsWith(expectedPrefix)) {
    throw new Error(
      `${field}: subject.key must start with '${expectedPrefix}' for layer '${canonical}', got '${key}'`,
    );
  }
}

function isNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string for ${field}`);
  }
  return value.trim();
}

function isRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for ${field}`);
  }
  return value as Record<string, unknown>;
}

function isStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected string array for ${field}`);
  }
  return value;
}

function validateManifest(raw: Record<string, unknown>, manifestPath: string): BenchmarkManifest {
  const scope = isRecord(raw.scope, `${manifestPath}:scope`);
  const coverage = isRecord(raw.coverage, `${manifestPath}:coverage`);

  const excludeRaw = scope.exclude;
  let exclude: BenchmarkManifest["scope"]["exclude"];
  if (excludeRaw !== undefined) {
    if (!Array.isArray(excludeRaw)) {
      throw new Error(`Expected array for ${manifestPath}:scope.exclude`);
    }
    exclude = excludeRaw.map((entry, index) => {
      const row = isRecord(entry, `${manifestPath}:scope.exclude[${index}]`);
      return {
        path: isNonEmptyString(row.path, `${manifestPath}:scope.exclude[${index}].path`),
        reason: isNonEmptyString(
          row.reason,
          `${manifestPath}:scope.exclude[${index}].reason`,
        ),
      };
    });
  }

  const layers = isStringArray(coverage.layers, `${manifestPath}:coverage.layers`);
  const normalizedLayers: BenchmarkLayer[] = [];
  for (const layer of layers) {
    if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
      throw new Error(`Unknown coverage layer '${layer}' in ${manifestPath}`);
    }
    const normalized = normalizeBenchmarkLayer(layer);
    if (!normalizedLayers.includes(normalized)) {
      normalizedLayers.push(normalized);
    }
  }

  const commit = isNonEmptyString(raw.commit, `${manifestPath}:commit`);
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Expected full commit SHA in ${manifestPath}:commit`);
  }

  const annotationVersion = raw.annotation_version;
  if (typeof annotationVersion !== "number" || !Number.isInteger(annotationVersion)) {
    throw new Error(`Expected integer annotation_version in ${manifestPath}`);
  }

  return {
    repository: isNonEmptyString(raw.repository, `${manifestPath}:repository`),
    commit,
    license: isNonEmptyString(raw.license, `${manifestPath}:license`),
    scope: {
      include: isStringArray(scope.include, `${manifestPath}:scope.include`),
      exclude,
    },
    coverage: {
      layers: normalizedLayers,
      languages: isStringArray(coverage.languages, `${manifestPath}:coverage.languages`),
      domains: isStringArray(coverage.domains, `${manifestPath}:coverage.domains`),
    },
    selection_rationale: isNonEmptyString(
      raw.selection_rationale,
      `${manifestPath}:selection_rationale`,
    ),
    annotation_version: annotationVersion,
  };
}

function validateAnnotation(
  raw: Record<string, unknown>,
  filePath: string,
  index: number,
): AnnotationRecord {
  const prefix = `${filePath}:annotations[${index}]`;
  const layer = isNonEmptyString(raw.layer, `${prefix}:layer`);
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown annotation layer '${layer}' in ${prefix}`);
  }
  const normalizedLayer = normalizeBenchmarkLayer(layer);

  const subject = isRecord(raw.subject, `${prefix}:subject`);
  const evidence = isRecord(raw.evidence, `${prefix}:evidence`);
  const expected = isRecord(raw.expected, `${prefix}:expected`);
  const provenance = isRecord(raw.provenance, `${prefix}:provenance`);

  const status = isNonEmptyString(expected.status, `${prefix}:expected.status`);
  if (!ANNOTATION_STATUSES.includes(status as AnnotationRecord["expected"]["status"])) {
    throw new Error(`Unknown expected.status '${status}' in ${prefix}`);
  }

  const reviewState = isNonEmptyString(
    provenance.review_state,
    `${prefix}:provenance.review_state`,
  );
  if (!REVIEW_STATES.includes(reviewState as ReviewState)) {
    throw new Error(`Unknown provenance.review_state '${reviewState}' in ${prefix}`);
  }

  const startLine = evidence.start_line;
  const endLine = evidence.end_line;
  if (typeof startLine !== "number" || typeof endLine !== "number") {
    throw new Error(`Expected numeric line evidence in ${prefix}`);
  }

  const labels = expected.labels;
  if (!Array.isArray(labels) || labels.some((item) => typeof item !== "string")) {
    throw new Error(`Expected string array for ${prefix}:expected.labels`);
  }

  if (expected.exhaustive_scope_files !== undefined) {
    throw new Error(
      `${prefix}:expected.exhaustive_scope_files is no longer supported — ` +
        "use layer-scopes.yaml at the packet root (KDATAP-f9bb0f)",
    );
  }

  const record: AnnotationRecord = {
    id: isNonEmptyString(raw.id, `${prefix}:id`),
    layer: normalizedLayer,
    subject: {
      key: (() => {
        const rawKey = isNonEmptyString(subject.key, `${prefix}:subject.key`);
        const normalizedKey = normalizeSubjectKey(normalizedLayer, rawKey);
        assertCanonicalSubjectKey(
          normalizedLayer,
          normalizedKey,
          `${prefix}:subject.key`,
        );
        return normalizedKey;
      })(),
      name:
        typeof subject.name === "string" && subject.name.trim().length > 0
          ? subject.name.trim()
          : undefined,
    },
    evidence: {
      file_path: isNonEmptyString(evidence.file_path, `${prefix}:evidence.file_path`),
      start_line: startLine,
      end_line: endLine,
    },
    rationale: isNonEmptyString(raw.rationale, `${prefix}:rationale`),
    expected: {
      status: status as AnnotationRecord["expected"]["status"],
      labels,
    },
    provenance: {
      proposed_by: isNonEmptyString(
        provenance.proposed_by,
        `${prefix}:provenance.proposed_by`,
      ),
      proposed_at: isNonEmptyString(
        provenance.proposed_at,
        `${prefix}:provenance.proposed_at`,
      ),
      reviewed_by:
        typeof provenance.reviewed_by === "string" &&
        provenance.reviewed_by.trim().length > 0
          ? provenance.reviewed_by.trim()
          : undefined,
      reviewed_at:
        typeof provenance.reviewed_at === "string" &&
        provenance.reviewed_at.trim().length > 0
          ? provenance.reviewed_at.trim()
          : undefined,
      review_state: reviewState as ReviewState,
    },
  };

  if (raw.canonical !== undefined) {
    const canonical = isRecord(raw.canonical, `${prefix}:canonical`);
    const parsedCanonical: AnnotationCanonical = {
      entity_id: isNonEmptyString(canonical.entity_id, `${prefix}:canonical.entity_id`),
      identity_key: isNonEmptyString(
        canonical.identity_key,
        `${prefix}:canonical.identity_key`,
      ),
      component_type: isNonEmptyString(
        canonical.component_type,
        `${prefix}:canonical.component_type`,
      ),
      component_subtype: isNonEmptyString(
        canonical.component_subtype,
        `${prefix}:canonical.component_subtype`,
      ),
    };
    if (canonical.vendor !== undefined) {
      parsedCanonical.vendor = isNonEmptyString(canonical.vendor, `${prefix}:canonical.vendor`);
    }
    record.canonical = parsedCanonical;
  }

  if (raw.flow_canonical !== undefined) {
    if (normalizedLayer !== "data_flows") {
      throw new Error(`${prefix}:flow_canonical is only supported on data_flows layer`);
    }
    record.flow_canonical = validateFlowCanonicalBlock(raw.flow_canonical, prefix);
  }

  if (raw.candidate !== undefined) {
    record.candidate = validateAnnotationCandidate(
      raw.candidate,
      normalizedLayer,
      prefix,
    );
  }

  return record;
}

const FLOW_DISPOSITION_CANDIDATES: readonly FlowDispositionCandidate[] = [
  "graph_edge",
  "intra_component_lineage",
  "rejection",
  "unresolved",
];

function validateFlowCanonicalBlock(
  raw: unknown,
  prefix: string,
): FlowAnnotationCanonical {
  const block = isRecord(raw, `${prefix}:flow_canonical`);
  const dispositionCandidate = isNonEmptyString(
    block.disposition_candidate,
    `${prefix}:flow_canonical.disposition_candidate`,
  );
  if (!FLOW_DISPOSITION_CANDIDATES.includes(dispositionCandidate as FlowDispositionCandidate)) {
    throw new Error(
      `Unknown flow_canonical.disposition_candidate '${dispositionCandidate}' in ${prefix}`,
    );
  }

  const endpoints = isRecord(block.endpoints, `${prefix}:flow_canonical.endpoints`);
  const parsed: FlowAnnotationCanonical = {
    identity_key: isNonEmptyString(block.identity_key, `${prefix}:flow_canonical.identity_key`),
    disposition_candidate: dispositionCandidate as FlowDispositionCandidate,
    source_entity_id: isNonEmptyString(
      block.source_entity_id,
      `${prefix}:flow_canonical.source_entity_id`,
    ),
    target_entity_id: isNonEmptyString(
      block.target_entity_id,
      `${prefix}:flow_canonical.target_entity_id`,
    ),
    endpoints: {
      source: validateFlowCandidateEndpoint(
        endpoints.source,
        `${prefix}:flow_canonical.endpoints.source`,
      ),
      target: validateFlowCandidateEndpoint(
        endpoints.target,
        `${prefix}:flow_canonical.endpoints.target`,
      ),
    },
  };

  if (block.flow_type !== undefined) {
    parsed.flow_type = isNonEmptyString(block.flow_type, `${prefix}:flow_canonical.flow_type`);
  }
  if (block.data_categories !== undefined) {
    parsed.data_categories = isStringArray(
      block.data_categories,
      `${prefix}:flow_canonical.data_categories`,
    );
  }

  return parsed;
}

function validateAnnotationCandidate(
  raw: unknown,
  layer: BenchmarkLayer,
  prefix: string,
): AnnotationCandidate {
  const candidate = isRecord(raw, `${prefix}:candidate`);
  const kind = isNonEmptyString(candidate.kind, `${prefix}:candidate.kind`);

  if (kind === "flow") {
    if (layer !== "data_flows") {
      throw new Error(`${prefix}:candidate.kind 'flow' is only supported on data_flows layer`);
    }
    return validateFlowCandidate(candidate, prefix);
  }

  if (kind === "data_item") {
    if (layer !== "data_items") {
      throw new Error(`${prefix}:candidate.kind 'data_item' is only supported on data_items layer`);
    }
    return validateDataItemCandidate(candidate, prefix);
  }

  throw new Error(`${prefix}:candidate.kind must be 'flow' or 'data_item'`);
}

function validateDataItemCandidate(
  candidate: Record<string, unknown>,
  prefix: string,
): DataItemAnnotationCandidate {
  const parsed: DataItemAnnotationCandidate = {
    kind: "data_item",
    proposed_identity_key: isNonEmptyString(
      candidate.proposed_identity_key,
      `${prefix}:candidate.proposed_identity_key`,
    ),
    proposed_concept_leaf: isNonEmptyString(
      candidate.proposed_concept_leaf,
      `${prefix}:candidate.proposed_concept_leaf`,
    ),
    proposed_ancestry: isStringArray(
      candidate.proposed_ancestry,
      `${prefix}:candidate.proposed_ancestry`,
    ),
  };

  if (candidate.candidate_confidence !== undefined) {
    parsed.candidate_confidence = isNonEmptyString(
      candidate.candidate_confidence,
      `${prefix}:candidate.candidate_confidence`,
    ) as DataItemAnnotationCandidate["candidate_confidence"];
  }
  if (candidate.candidate_notes !== undefined) {
    parsed.candidate_notes = isNonEmptyString(
      candidate.candidate_notes,
      `${prefix}:candidate.candidate_notes`,
    );
  }
  if (candidate.evidence_validation !== undefined) {
    parsed.evidence_validation = isNonEmptyString(
      candidate.evidence_validation,
      `${prefix}:candidate.evidence_validation`,
    ) as DataItemEvidenceValidation;
  }

  return parsed;
}

function validateFlowCandidateEndpoint(
  raw: unknown,
  prefix: string,
): FlowCandidateEndpoint {
  const endpoint = isRecord(raw, prefix);
  const parsed: FlowCandidateEndpoint = {
    component_type: isNonEmptyString(endpoint.component_type, `${prefix}.component_type`),
    endpoint_key: isNonEmptyString(endpoint.endpoint_key, `${prefix}.endpoint_key`),
  };
  if (endpoint.component_subtype !== undefined) {
    parsed.component_subtype = isNonEmptyString(
      endpoint.component_subtype,
      `${prefix}.component_subtype`,
    );
  }
  if (endpoint.vendor !== undefined) {
    parsed.vendor = isNonEmptyString(endpoint.vendor, `${prefix}.vendor`);
  }
  return parsed;
}

function validateFlowCandidate(
  candidate: Record<string, unknown>,
  prefix: string,
): FlowAnnotationCandidate {
  const kind = isNonEmptyString(candidate.kind, `${prefix}:candidate.kind`);
  if (kind !== "flow") {
    throw new Error(`${prefix}:candidate.kind must be 'flow'`);
  }

  const disposition = isNonEmptyString(
    candidate.disposition_candidate,
    `${prefix}:candidate.disposition_candidate`,
  ) as FlowAnnotationCandidate["disposition_candidate"];
  const confidence = isNonEmptyString(
    candidate.candidate_confidence,
    `${prefix}:candidate.candidate_confidence`,
  ) as FlowAnnotationCandidate["candidate_confidence"];

  const parsed: FlowAnnotationCandidate = {
    kind: "flow",
    disposition_candidate: disposition,
    candidate_confidence: confidence,
    candidate_notes: isNonEmptyString(candidate.candidate_notes, `${prefix}:candidate.candidate_notes`),
  };

  if (candidate.candidate_identity_key !== undefined) {
    parsed.candidate_identity_key = isNonEmptyString(
      candidate.candidate_identity_key,
      `${prefix}:candidate.candidate_identity_key`,
    );
  }
  if (candidate.proposed_flow_type !== undefined) {
    parsed.proposed_flow_type = isNonEmptyString(
      candidate.proposed_flow_type,
      `${prefix}:candidate.proposed_flow_type`,
    );
  }
  if (candidate.proposed_data_categories !== undefined) {
    const categories = candidate.proposed_data_categories;
    if (!Array.isArray(categories) || categories.some((item) => typeof item !== "string")) {
      throw new Error(`${prefix}:candidate.proposed_data_categories must be a string array`);
    }
    parsed.proposed_data_categories = categories.map((item) => item.trim());
  }
  if (candidate.source_entity_id !== undefined) {
    parsed.source_entity_id = isNonEmptyString(
      candidate.source_entity_id,
      `${prefix}:candidate.source_entity_id`,
    );
  }
  if (candidate.target_entity_id !== undefined) {
    parsed.target_entity_id = isNonEmptyString(
      candidate.target_entity_id,
      `${prefix}:candidate.target_entity_id`,
    );
  }
  if (candidate.endpoints !== undefined) {
    const endpoints = isRecord(candidate.endpoints, `${prefix}:candidate.endpoints`);
    parsed.endpoints = {
      source: validateFlowCandidateEndpoint(endpoints.source, `${prefix}:candidate.endpoints.source`),
      target: validateFlowCandidateEndpoint(endpoints.target, `${prefix}:candidate.endpoints.target`),
    };
  }

  return parsed;
}

export function loadBenchmarkManifest(repoDir: string): BenchmarkManifest {
  const manifestPath = path.join(repoDir, "manifest.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest at ${manifestPath}`);
  }

  const text = fs.readFileSync(manifestPath, "utf8");
  const parsed = YAML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object in ${manifestPath}`);
  }

  return validateManifest(parsed as Record<string, unknown>, manifestPath);
}

export function loadAnnotations(repoDir: string, layer: string): AnnotationRecord[] {
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown annotation layer '${layer}'`);
  }

  const canonicalLayer = normalizeBenchmarkLayer(layer);
  const filePath = path.join(repoDir, "annotations", `${canonicalLayer}.yaml`);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing annotations for layer '${canonicalLayer}' at ${filePath}`,
    );
  }

  const text = fs.readFileSync(filePath, "utf8");
  const parsed = YAML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object in ${filePath}`);
  }

  const root = parsed as Record<string, unknown>;
  const annotationsRaw = root.annotations;
  if (!Array.isArray(annotationsRaw)) {
    throw new Error(`Expected annotations array in ${filePath}`);
  }

  return annotationsRaw.map((entry, index) =>
    validateAnnotation(isRecord(entry, `${filePath}:annotations[${index}]`), filePath, index),
  );
}

function validateLayerScopeProvenance(
  raw: Record<string, unknown>,
  field: string,
): AnnotationProvenance {
  const reviewState = isNonEmptyString(raw.review_state, `${field}.review_state`);
  if (!REVIEW_STATES.includes(reviewState as ReviewState)) {
    throw new Error(`Unknown provenance.review_state '${reviewState}' in ${field}`);
  }

  return {
    proposed_by: isNonEmptyString(raw.proposed_by, `${field}.proposed_by`),
    proposed_at: isNonEmptyString(raw.proposed_at, `${field}.proposed_at`),
    reviewed_by:
      typeof raw.reviewed_by === "string" && raw.reviewed_by.trim().length > 0
        ? raw.reviewed_by.trim()
        : undefined,
    reviewed_at:
      typeof raw.reviewed_at === "string" && raw.reviewed_at.trim().length > 0
        ? raw.reviewed_at.trim()
        : undefined,
    review_state: reviewState as ReviewState,
  };
}

function validateLayerScopeRecord(
  raw: Record<string, unknown>,
  field: string,
): LayerScopeRecord {
  const provenanceRaw = isRecord(raw.provenance, `${field}.provenance`);
  const files = isStringArray(raw.exhaustive_scope_files, `${field}.exhaustive_scope_files`);
  const deduped = [...new Set(files.map((filePath) => filePath.trim()).filter(Boolean))].sort();
  return {
    exhaustive_scope_files: deduped,
    provenance: validateLayerScopeProvenance(provenanceRaw, `${field}.provenance`),
  };
}

export function loadLayerScopes(repoDir: string): Map<BenchmarkLayer, LayerScopeRecord> {
  const scopesPath = path.join(repoDir, "layer-scopes.yaml");
  if (!fs.existsSync(scopesPath)) {
    return new Map();
  }

  const text = fs.readFileSync(scopesPath, "utf8");
  const parsed = YAML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Expected YAML object in ${scopesPath}`);
  }

  const root = parsed as Record<string, unknown>;
  const layerScopesRaw = root.layer_scopes;
  if (layerScopesRaw === undefined) {
    return new Map();
  }
  if (typeof layerScopesRaw !== "object" || layerScopesRaw === null || Array.isArray(layerScopesRaw)) {
    throw new Error(`Expected object for ${scopesPath}:layer_scopes`);
  }

  const merged = new Map<BenchmarkLayer, LayerScopeRecord>();
  for (const [layerKey, entry] of Object.entries(layerScopesRaw as Record<string, unknown>)) {
    if (!BENCHMARK_LAYERS.includes(layerKey as BenchmarkLayer)) {
      throw new Error(`Unknown layer '${layerKey}' in ${scopesPath}:layer_scopes`);
    }
    const canonical = normalizeBenchmarkLayer(layerKey);
    const record = validateLayerScopeRecord(
      isRecord(entry, `${scopesPath}:layer_scopes.${layerKey}`),
      `${scopesPath}:layer_scopes.${layerKey}`,
    );
    const existing = merged.get(canonical);
    if (!existing) {
      merged.set(canonical, record);
      continue;
    }
    merged.set(canonical, {
      exhaustive_scope_files: [
        ...new Set([...existing.exhaustive_scope_files, ...record.exhaustive_scope_files]),
      ].sort(),
      provenance: record.provenance,
    });
  }

  return merged;
}
