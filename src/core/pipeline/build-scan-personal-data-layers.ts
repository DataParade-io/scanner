import {
  dataItemIdentity,
  mentionIdentity,
} from "../../eval-layers/identities";
import type { PersonalDataInventory } from "../../eval-layers/personal-data-inventory";
import type { ScanDataItem, ScanMention } from "./orchestrator-result";

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
): { mentions: ScanMention[]; dataItems: ScanDataItem[] } {
  const contentByPath = new Map(inventory.files.map((file) => [file.path, file.content]));

  const mentions: ScanMention[] = inventory.hits.map((hit) => {
    const content = contentByPath.get(hit.evidence.filePath);
    const code =
      content !== undefined
        ? lineSnippet(content, hit.evidence.startLine, hit.evidence.endLine)
        : undefined;

    return {
      id: mentionIdentity(hit.id, hit.evidence.filePath, hit.evidence.startLine),
      filePath: hit.evidence.filePath,
      startLine: hit.evidence.startLine,
      endLine: hit.evidence.endLine,
      labels: [...hit.labels],
      ...(code !== undefined ? { code } : {}),
    };
  });

  const dataItemsById = new Map<
    string,
    { labels: Set<string>; mentionIds: string[] }
  >();

  for (const hit of inventory.hits) {
    const id = dataItemIdentity(hit.id);
    const mentionId = mentionIdentity(
      hit.id,
      hit.evidence.filePath,
      hit.evidence.startLine,
    );
    let entry = dataItemsById.get(id);
    if (!entry) {
      entry = { labels: new Set(hit.labels), mentionIds: [] };
      dataItemsById.set(id, entry);
    } else {
      for (const label of hit.labels) {
        entry.labels.add(label);
      }
    }
    if (!entry.mentionIds.includes(mentionId)) {
      entry.mentionIds.push(mentionId);
    }
  }

  const dataItems: ScanDataItem[] = [...dataItemsById.entries()]
    .map(([id, entry]) => ({
      id,
      mentionIds: [...entry.mentionIds],
      labels: [...entry.labels].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { mentions, dataItems };
}
