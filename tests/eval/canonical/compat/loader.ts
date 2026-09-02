import {
  buildCanonicalRecord,
  canonicalSubjectKey,
  componentStructuredIdentity,
  corpusLayerToCanonical,
  dataActionStructuredIdentity,
  dataItemCandidateBlock,
  expectedLabelsProvenance,
  expectedStatusDisposition,
  flowCandidateIdentity,
  initialConversionState,
  legacySubjectName,
  piiSignalPrefixRewrite,
  ruleIdToConceptLeafConversion,
  type ConversionState,
} from "./conversions";
import type { CompatLoadResult, LegacyGoldRecord, LoadLegacyGoldOptions } from "./types";

export function loadLegacyGoldRecord(
  input: LegacyGoldRecord,
  options: LoadLegacyGoldOptions = {},
): CompatLoadResult {
  const warn = options.warn ?? console.warn.bind(console);
  const diagnostics: CompatLoadResult["diagnostics"] = [];

  let state: ConversionState = initialConversionState(input);

  const layerStep = corpusLayerToCanonical(input);
  state = { ...state, ...layerStep.state };
  diagnostics.push(layerStep.diagnostic);

  const piiSignalStep = piiSignalPrefixRewrite(state, input.id);
  state = { ...state, ...piiSignalStep.state };
  if (piiSignalStep.diagnostic) {
    diagnostics.push(piiSignalStep.diagnostic);
  }

  const subjectKeyStep = canonicalSubjectKey(state, input.id);
  state = { ...state, ...subjectKeyStep.state };
  if (subjectKeyStep.diagnostic) {
    diagnostics.push(subjectKeyStep.diagnostic);
  }

  const componentIdentityStep = componentStructuredIdentity(state, input, options);
  state = { ...state, ...componentIdentityStep.state };
  diagnostics.push(...componentIdentityStep.diagnostics);

  const dataActionIdentityStep = dataActionStructuredIdentity(state, input);
  state = { ...state, ...dataActionIdentityStep.state };
  diagnostics.push(...dataActionIdentityStep.diagnostics);

  const flowCandidateStep = flowCandidateIdentity(state, input);
  state = { ...state, ...flowCandidateStep.state };
  diagnostics.push(...flowCandidateStep.diagnostics);

  const dataItemCandidateStep = dataItemCandidateBlock(state, input);
  state = { ...state, ...dataItemCandidateStep.state };
  diagnostics.push(...dataItemCandidateStep.diagnostics);

  const ruleIdStep = ruleIdToConceptLeafConversion(state, input);
  state = { ...state, ...ruleIdStep.state };
  if (ruleIdStep.diagnostic) {
    diagnostics.push(ruleIdStep.diagnostic);
  }

  const subjectNameStep = legacySubjectName(state, input);
  state = { ...state, ...subjectNameStep.state };
  if (subjectNameStep.diagnostic) {
    diagnostics.push(subjectNameStep.diagnostic);
  }

  const labelsStep = expectedLabelsProvenance(state, input);
  state = { ...state, ...labelsStep.state };
  if (labelsStep.diagnostic) {
    diagnostics.push(labelsStep.diagnostic);
  }

  const dispositionStep = expectedStatusDisposition(state, input);
  state = { ...state, ...dispositionStep.state };
  diagnostics.push(dispositionStep.diagnostic);

  const record = {
    ...buildCanonicalRecord(state, input, options.adapterMapVersion),
    id: input.id,
  };

  warn(
    `[legacy-compat-loader] converted ${input.id}: ${diagnostics.length} migration step(s)`,
  );

  return { record, diagnostics };
}
