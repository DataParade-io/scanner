/** Evaluation-contract semantics version (canonicalization-map meaning). */
export const CANONICAL_CONTRACT_VERSION = "1.0.0" as const;

export interface ContractEnvelope {
  readonly contractVersion: typeof CANONICAL_CONTRACT_VERSION;
  readonly adapterMapVersion: string;
}

export const SYNTHETIC_ADAPTER_MAP_VERSION = "test-manifest-digest" as const;

export function stampEnvelope(
  adapterMapVersion: string = SYNTHETIC_ADAPTER_MAP_VERSION,
): ContractEnvelope {
  return {
    contractVersion: CANONICAL_CONTRACT_VERSION,
    adapterMapVersion,
  };
}

export function contractVersionsMatch(
  left: ContractEnvelope,
  right: ContractEnvelope,
): boolean {
  return left.contractVersion === right.contractVersion;
}
