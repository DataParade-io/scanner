import type { PathEligibilityOutcome } from "../ingest/eligibility";
import type { PiiSignalHit } from "../pii-signals/match-pii-signals";
import {
  dataItemIdentity,
  mentionIdentity,
  rawHitIdentity,
} from "./identities";
import { buildPersonalDataLayerLedger } from "./build-layer-ledger";
import type { EvalLayerId } from "./layer-capability";
import {
  buildPersonalDataInventory,
  type PersonalDataInventory,
} from "./personal-data-inventory";

export interface PersonalDataEvidence {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface PersonalDataFinding {
  subjectKey: string;
  labels: string[];
  evidenceLocations: PersonalDataEvidence[];
}

export interface PersonalDataFindingsPayload {
  findings: PersonalDataFinding[];
  filesScanned: string[];
  layerOutcomes: PathEligibilityOutcome[];
}

export function evidenceLocationKey(location: PersonalDataEvidence): string {
  return `${location.filePath}:${location.startLine}:${location.endLine}`;
}

export function sortEvidenceLocations(
  locations: PersonalDataEvidence[],
): PersonalDataEvidence[] {
  return [...locations].sort((left, right) => {
    const fileCmp = left.filePath.localeCompare(right.filePath);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }
    return left.endLine - right.endLine;
  });
}

function hitToEvidence(hit: PiiSignalHit): PersonalDataEvidence {
  return {
    filePath: hit.evidence.filePath,
    startLine: hit.evidence.startLine,
    endLine: hit.evidence.endLine,
  };
}

function hitToRawFinding(hit: PiiSignalHit): PersonalDataFinding {
  return {
    subjectKey: rawHitIdentity(hit.id),
    labels: [...hit.labels],
    evidenceLocations: [hitToEvidence(hit)],
  };
}

function hitToMentionFinding(hit: PiiSignalHit): PersonalDataFinding {
  return {
    subjectKey: mentionIdentity(hit.id),
    labels: [...hit.labels],
    evidenceLocations: [hitToEvidence(hit)],
  };
}

function hitsToDataItemFindings(hits: PiiSignalHit[]): PersonalDataFinding[] {
  const byKey = new Map<
    string,
    { labels: Set<string>; locations: Map<string, PersonalDataEvidence> }
  >();

  for (const hit of hits) {
    const key = dataItemIdentity(hit.id);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { labels: new Set(hit.labels), locations: new Map() };
      byKey.set(key, entry);
    } else {
      for (const label of hit.labels) {
        entry.labels.add(label);
      }
    }

    const evidence = hitToEvidence(hit);
    entry.locations.set(evidenceLocationKey(evidence), evidence);
  }

  return [...byKey.entries()]
    .map(([subjectKey, entry]) => ({
      subjectKey,
      labels: [...entry.labels].sort((left, right) => left.localeCompare(right)),
      evidenceLocations: sortEvidenceLocations([...entry.locations.values()]),
    }))
    .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey));
}

export type PersonalDataEvalLayer = "raw-hits" | "mentions" | "data-items";

const PERSONAL_DATA_LAYER_MAP: Record<PersonalDataEvalLayer, EvalLayerId> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

export function projectPersonalDataFindings(
  inventory: PersonalDataInventory,
  layer: PersonalDataEvalLayer,
): PersonalDataFinding[] {
  switch (layer) {
    case "raw-hits":
      return inventory.hits.map(hitToRawFinding);
    case "mentions":
      return inventory.hits.map(hitToMentionFinding);
    case "data-items":
      return hitsToDataItemFindings(inventory.hits);
  }
}

export function buildPersonalDataFindingsPayload(
  inventory: PersonalDataInventory,
  layer: PersonalDataEvalLayer,
): PersonalDataFindingsPayload {
  const layerOutcomes = buildPersonalDataLayerLedger(
    PERSONAL_DATA_LAYER_MAP[layer],
    inventory.ingestOutcomes,
    inventory.files,
  );

  return {
    findings: projectPersonalDataFindings(inventory, layer),
    filesScanned: inventory.files.map((file) => file.path),
    layerOutcomes,
  };
}

export async function collectPersonalDataFindings(
  rootPath: string,
  layer: PersonalDataEvalLayer,
): Promise<PersonalDataFindingsPayload> {
  const inventory = await buildPersonalDataInventory(rootPath);
  return buildPersonalDataFindingsPayload(inventory, layer);
}

export { buildPersonalDataInventory, type PersonalDataInventory } from "./personal-data-inventory";
