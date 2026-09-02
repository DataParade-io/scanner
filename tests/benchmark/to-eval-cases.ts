import type { EvalCase, EvalLayer } from "../eval/types";
import type { AnnotationRecord, BenchmarkLayer, LayerScopeRecord, ReviewState } from "./schema";
import { normalizeBenchmarkLayer } from "./schema";

export interface ToEvalCasesOptions {
  includeProposed?: boolean;
  reviewStates?: ReviewState[];
  layerScopes?: Map<BenchmarkLayer, LayerScopeRecord>;
}

const DEFAULT_REVIEW_STATES: ReviewState[] = ["accepted"];

function resolveReviewStates(options: ToEvalCasesOptions): ReviewState[] {
  if (options.reviewStates) {
    return options.reviewStates;
  }
  if (options.includeProposed) {
    return ["accepted", "proposed", "needs_adjudication"];
  }
  return DEFAULT_REVIEW_STATES;
}

function isIncludedReviewState(
  reviewState: AnnotationRecord["provenance"]["review_state"],
  allowedStates: ReviewState[],
): boolean {
  return allowedStates.includes(reviewState);
}

const LAYER_MAP: Record<AnnotationRecord["layer"], EvalLayer> = {
  components: "components",
  data_flows: "data-flows",
  raw_hits: "raw-hits",
  mentions: "mentions",
  data_items: "data-items",
  pii_signals: "mentions",
};

function toEvalLayer(layer: AnnotationRecord["layer"]): EvalLayer {
  const mapped = LAYER_MAP[layer];
  if (!mapped) {
    throw new Error(`Unsupported annotation layer '${layer}' for eval conversion`);
  }
  return mapped;
}

function acceptedLayerScopeFiles(
  layer: BenchmarkLayer,
  layerScopes: Map<BenchmarkLayer, LayerScopeRecord> | undefined,
): string[] | undefined {
  if (!layerScopes) {
    return undefined;
  }
  const record = layerScopes.get(normalizeBenchmarkLayer(layer));
  if (!record || record.provenance.review_state !== "accepted") {
    return undefined;
  }
  if (record.exhaustive_scope_files.length === 0) {
    return undefined;
  }
  return [...record.exhaustive_scope_files];
}

export function annotationToEvalCase(
  annotation: AnnotationRecord,
  fixture: string,
  options: ToEvalCasesOptions = {},
): EvalCase | null {
  const allowedStates = resolveReviewStates(options);
  if (!isIncludedReviewState(annotation.provenance.review_state, allowedStates)) {
    return null;
  }

  const scopeFiles = acceptedLayerScopeFiles(annotation.layer, options.layerScopes);

  return {
    id: annotation.id,
    fixture,
    layer: toEvalLayer(annotation.layer),
    subject: {
      key: annotation.subject.key,
      ...(annotation.subject.name !== undefined ? { name: annotation.subject.name } : {}),
    },
    evidence: {
      file_path: annotation.evidence.file_path,
      start_line: annotation.evidence.start_line,
      end_line: annotation.evidence.end_line,
    },
    expected: {
      status: annotation.expected.status,
      labels: [...annotation.expected.labels],
    },
    rationale: annotation.rationale,
    ...(scopeFiles !== undefined ? { exhaustiveScopeFiles: scopeFiles } : {}),
    ...(annotation.flow_canonical !== undefined
      ? { flow_canonical: annotation.flow_canonical }
      : {}),
    ...(annotation.candidate?.kind === "flow"
      ? { flowCandidate: annotation.candidate }
      : {}),
  };
}

export function annotationsToEvalCases(
  annotations: AnnotationRecord[],
  fixture: string,
  options: ToEvalCasesOptions = {},
): EvalCase[] {
  return annotations.flatMap((annotation) => {
    const evalCase = annotationToEvalCase(annotation, fixture, options);
    return evalCase === null ? [] : [evalCase];
  });
}
