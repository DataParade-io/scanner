import type {
  CanonicalDisposition,
  CanonicalGoldExpectation,
  EvidenceLocation,
} from "../types";
import { evidenceLocationsOverlap } from "../identity";
import { buildNeedsAdjudicationRecord } from "../builders";
import type {
  ComponentAnnotationRow,
  ConsolidatedComponentEntity,
  ConsolidationResult,
} from "./types";

function mergeEvidenceLocations(
  locations: EvidenceLocation[],
): EvidenceLocation[] {
  const merged: EvidenceLocation[] = [];
  for (const location of locations) {
    const duplicate = merged.some(
      (existing) =>
        existing.file_path === location.file_path &&
        existing.start_line === location.start_line &&
        existing.end_line === location.end_line,
    );
    if (!duplicate) {
      merged.push(location);
    }
  }
  return merged;
}

function rowsShareReviewedGroupingEvidence(rows: ComponentAnnotationRow[]): boolean {
  if (rows.length < 2) {
    return true;
  }

  const entityIds = rows
    .map((row) => row.record.entityId?.trim())
    .filter((entityId): entityId is string => Boolean(entityId));
  if (entityIds.length > 0 && new Set(entityIds).size === 1) {
    return true;
  }

  const identityKey = rows[0].record.identity.identityKey;
  if (!rows.every((row) => row.record.identity.identityKey === identityKey)) {
    return false;
  }

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (
        evidenceLocationsOverlap(
          rows[i].record.evidenceLocations,
          rows[j].record.evidenceLocations,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function isAmbiguousGrouping(rows: ComponentAnnotationRow[]): boolean {
  if (rows.length < 2) {
    return false;
  }

  const identityKeys = new Set(rows.map((row) => row.record.identity.identityKey));
  if (identityKeys.size !== 1) {
    return false;
  }

  const entityIds = rows
    .map((row) => row.record.entityId?.trim())
    .filter((entityId): entityId is string => Boolean(entityId));
  if (entityIds.length > 1 && new Set(entityIds).size > 1) {
    return true;
  }

  return !rowsShareReviewedGroupingEvidence(rows);
}

function toConsolidatedEntity(
  rows: ComponentAnnotationRow[],
  consolidatedId: string,
): ConsolidatedComponentEntity {
  const primary = rows[0].record;
  const evidenceLocations = mergeEvidenceLocations(
    rows.flatMap((row) => row.record.evidenceLocations),
  );
  const derivationLocations = mergeEvidenceLocations(
    rows.flatMap((row) => row.record.derivationLocations ?? []),
  );

  return {
    consolidatedId,
    entityId: primary.entityId,
    identity: primary.identity,
    classification: primary.classification,
    optionalAssertion: primary.optionalAssertion,
    evidenceLocations,
    derivationLocations:
      derivationLocations.length > 0 ? derivationLocations : undefined,
    sourceRowIds: rows.map((row) => row.id),
    disposition: primary.disposition,
  };
}

/**
 * Consolidate component annotation rows into repository entities before assignment.
 * Never merges distinct identity keys sharing only subtype; ambiguous groups adjudicate.
 */
export function consolidateComponentRows(
  rows: ComponentAnnotationRow[],
): ConsolidationResult {
  const entities: ConsolidatedComponentEntity[] = [];
  const adjudication: Array<CanonicalGoldExpectation & { id: string }> = [];

  const byIdentityKey = new Map<string, ComponentAnnotationRow[]>();
  for (const row of rows) {
    const key = row.record.identity.identityKey;
    const group = byIdentityKey.get(key) ?? [];
    group.push(row);
    byIdentityKey.set(key, group);
  }

  let consolidatedCounter = 0;

  for (const [, identityRows] of byIdentityKey) {
    if (identityRows.length === 1) {
      consolidatedCounter += 1;
      entities.push(
        toConsolidatedEntity(identityRows, `consolidated-${consolidatedCounter}`),
      );
      continue;
    }

    if (isAmbiguousGrouping(identityRows)) {
      const adjudicationRecord = buildNeedsAdjudicationRecord({
        layer: "components",
        identityKey: identityRows[0].record.identity.identityKey,
        conceptLeaf: identityRows[0].record.classification.conceptLeaf,
        conceptAncestry: identityRows[0].record.classification.conceptAncestry,
        componentType: identityRows[0].record.classification.componentType,
        componentSubtype: identityRows[0].record.classification.componentSubtype,
        optionalAssertion: identityRows[0].record.optionalAssertion,
        evidenceLocations: mergeEvidenceLocations(
          identityRows.flatMap((row) => row.record.evidenceLocations),
        ),
      });
      adjudication.push({
        ...adjudicationRecord,
        id: `adjudication-${identityRows.map((row) => row.id).join("-")}`,
      });
      continue;
    }

    if (rowsShareReviewedGroupingEvidence(identityRows)) {
      consolidatedCounter += 1;
      entities.push(
        toConsolidatedEntity(identityRows, `consolidated-${consolidatedCounter}`),
      );
      continue;
    }

    for (const row of identityRows) {
      consolidatedCounter += 1;
      entities.push(toConsolidatedEntity([row], `consolidated-${consolidatedCounter}`));
    }
  }

  return { entities, adjudication };
}

export function consolidatedEntityDisposition(
  entity: ConsolidatedComponentEntity,
): CanonicalDisposition {
  return entity.disposition;
}
