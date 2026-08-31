import type { AnnotationRecord } from "../../../benchmark/schema";
import type { EvalCase } from "../../types";
import { annotationRecordToLegacyInput, loadLegacyGoldRecord } from "../compat";
import type { CompatLoadResult, LegacyGoldRecord, LoadLegacyGoldOptions } from "../compat/types";
import { evalCaseToLegacyInput } from "./fixture-input";

/** Load one legacy gold row through the shared compat normalizer. */
export function loadCanonicalGoldFromLegacyRecord(
  input: LegacyGoldRecord,
  options: LoadLegacyGoldOptions = {},
): CompatLoadResult {
  return loadLegacyGoldRecord(input, options);
}

/** Corpus annotation YAML row → canonical gold expectation. */
export function loadCanonicalGoldFromAnnotation(
  record: AnnotationRecord,
  options: LoadLegacyGoldOptions = {},
): CompatLoadResult {
  return loadCanonicalGoldFromLegacyRecord(annotationRecordToLegacyInput(record), options);
}

/** Jest fixture EvalCase → canonical gold expectation. */
export function loadCanonicalGoldFromEvalCase(
  caseRecord: EvalCase,
  options: LoadLegacyGoldOptions = {},
): CompatLoadResult {
  return loadCanonicalGoldFromLegacyRecord(evalCaseToLegacyInput(caseRecord), options);
}

/** Batch corpus loader for tests and migration accounting. */
export function loadCanonicalGoldFromAnnotations(
  records: AnnotationRecord[],
  options: LoadLegacyGoldOptions = {},
): CompatLoadResult[] {
  return records.map((record) => loadCanonicalGoldFromAnnotation(record, options));
}
