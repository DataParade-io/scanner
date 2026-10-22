import {
  dataItemIdentity,
  occurrenceIdentity,
} from "../../eval-layers/identities";
import type { PersonalDataInventory } from "../../eval-layers/personal-data-inventory";
import type { ScanDataItem, ScanOccurrence } from "./orchestrator-result";

function lineSnippet(lines: readonly string[], startLine: number, endLine: number): string | undefined {
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
  // Split each file into lines once, not once per occurrence: a file with thousands of
  // occurrences (i18n catalogs, generated clients) otherwise re-splits its whole text for
  // every one of them.
  const linesByPath = new Map<string, string[]>();
  const linesOf = (filePath: string): string[] | undefined => {
    let lines = linesByPath.get(filePath);
    if (lines) return lines;
    const content = contentByPath.get(filePath);
    if (content === undefined) return undefined;
    lines = content.split(/\r?\n/);
    linesByPath.set(filePath, lines);
    return lines;
  };

  const occurrences: ScanOccurrence[] = inventory.hits.map((hit) => {
    const lines = linesOf(hit.evidence.filePath);
    const code =
      lines !== undefined
        ? lineSnippet(lines, hit.evidence.startLine, hit.evidence.endLine)
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
      ...(hit.groupBasis ? { groupBasis: hit.groupBasis } : {}),
      ...(hit.groupColumn ? { groupColumn: hit.groupColumn } : {}),
      ...(hit.declaration
        ? {
            declaration:
              hit.declaration === "unresolved"
                ? ("unresolved" as const)
                : { line: hit.declaration.line, kind: hit.declaration.kind },
          }
        : {}),
    };
  });

  const dataItemsById = new Map<
    string,
    { labels: Set<string>; occurrenceIds: Set<string>; groups: Map<string, Set<string>> }
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
      entry = { labels: new Set(hit.labels), occurrenceIds: new Set(), groups: new Map() };
      dataItemsById.set(id, entry);
    } else {
      for (const label of hit.labels) {
        entry.labels.add(label);
      }
    }
    // Sets keep first-seen order, as the arrays with an `includes` check did, without the
    // quadratic scan.
    entry.occurrenceIds.add(occurrenceId);
    // A location-named singleton (`email~file:line`) is a occurrence no evidence grouped; it
    // stays on the occurrence for external labels but is not listed as a data item group.
    if (hit.group && !hit.group.startsWith(`${hit.id}~`)) {
      const groupOccurrences = entry.groups.get(hit.group) ?? new Set<string>();
      groupOccurrences.add(occurrenceId);
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
              .map(([groupId, occurrenceIds]) => ({ id: groupId, occurrenceIds: [...occurrenceIds] }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          }
        : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { occurrences, dataItems };
}
