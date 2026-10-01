import {
  dataItemIdentity,
  occurrenceIdentity,
} from "../../eval-layers/identities";
import type { PersonalDataInventory } from "../../eval-layers/personal-data-inventory";
import type { ScanDataItem, ScanOccurrence } from "./orchestrator-result";

function lineSnippet(content: string, startLine: number, endLine: number): string | undefined {
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine);
  if (slice.length === 0) {
    return undefined;
  }
  const text = slice.join("\n");
  return text.length > 0 ? text : undefined;
}

export function buildScanPersonalDataLayers(
  inventory: PersonalDataInventory,
): { occurrences: ScanOccurrence[]; dataItems: ScanDataItem[] } {
  const contentByPath = new Map(inventory.files.map((file) => [file.path, file.content]));

  const occurrences: ScanOccurrence[] = inventory.hits.map((hit) => {
    const content = contentByPath.get(hit.evidence.filePath);
    const code =
      content !== undefined
        ? lineSnippet(content, hit.evidence.startLine, hit.evidence.endLine)
        : undefined;

    return {
      id: occurrenceIdentity(hit.id, hit.evidence.filePath, hit.evidence.startLine),
      filePath: hit.evidence.filePath,
      startLine: hit.evidence.startLine,
      endLine: hit.evidence.endLine,
      labels: [...hit.labels],
      ...(code !== undefined ? { code } : {}),
      ...(hit.location ? { location: hit.location } : {}),
      ...(hit.commentContext ? { commentContext: hit.commentContext } : {}),
      ...(hit.group ? { group: hit.group } : {}),
    };
  });

  const dataItemsById = new Map<
    string,
    { labels: Set<string>; occurrenceIds: string[]; groups: Map<string, string[]> }
  >();

  // Data items roll up code matches; comment matches stay on the occurrence list as context.
  for (const hit of inventory.hits.filter((candidate) => candidate.location !== "comment")) {
    const id = dataItemIdentity(hit.id);
    const occurrenceId = occurrenceIdentity(
      hit.id,
      hit.evidence.filePath,
      hit.evidence.startLine,
    );
    let entry = dataItemsById.get(id);
    if (!entry) {
      entry = { labels: new Set(hit.labels), occurrenceIds: [], groups: new Map() };
      dataItemsById.set(id, entry);
    } else {
      for (const label of hit.labels) {
        entry.labels.add(label);
      }
    }
    if (!entry.occurrenceIds.includes(occurrenceId)) {
      entry.occurrenceIds.push(occurrenceId);
    }
    // A location-named singleton (`email~file:line`) is a occurrence no evidence grouped; it
    // stays on the occurrence for external labels but is not listed as a data item group.
    if (hit.group && !hit.group.startsWith(`${hit.id}~`)) {
      const groupOccurrences = entry.groups.get(hit.group) ?? [];
      if (!groupOccurrences.includes(occurrenceId)) {
        groupOccurrences.push(occurrenceId);
      }
      entry.groups.set(hit.group, groupOccurrences);
    }
  }

  const dataItems: ScanDataItem[] = [...dataItemsById.entries()]
    .map(([id, entry]) => ({
      id,
      occurrenceIds: [...entry.occurrenceIds],
      labels: [...entry.labels].sort((left, right) => left.localeCompare(right)),
      ...(entry.groups.size > 0
        ? {
            groups: [...entry.groups.entries()]
              .map(([groupId, occurrenceIds]) => ({ id: groupId, occurrenceIds }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          }
        : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { occurrences, dataItems };
}
