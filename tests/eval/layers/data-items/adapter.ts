import path from "path";

import { dataItemIdentity } from "../../../../src/eval-layers/identities";
import { ingestFileSystem } from "../../../../src/ingest/file-system";
import {
  matchPiiSignalsInFiles,
  type PiiSignalHit,
} from "../../../../src/pii-signals/match-pii-signals";
import type { FixtureScanResult, LayerFinding } from "../../types";

const FIXTURES_ROOT = path.join(__dirname, "../../../fixtures");

function hitsToDataItemFindings(hits: PiiSignalHit[]): LayerFinding[] {
  const byKey = new Map<string, LayerFinding>();

  for (const hit of hits) {
    const key = dataItemIdentity(hit.id);
    const existing = byKey.get(key);
    const line = {
      file_path: hit.evidence.filePath,
      start_line: hit.evidence.startLine,
      end_line: hit.evidence.endLine,
    };

    if (!existing) {
      byKey.set(key, {
        key,
        labels: [...hit.labels],
        sourceFilePaths: [hit.evidence.filePath],
        sourceLines: [line],
      });
      continue;
    }

    const labels = new Set([...existing.labels, ...hit.labels]);
    existing.labels = [...labels];
    if (!existing.sourceFilePaths.includes(hit.evidence.filePath)) {
      existing.sourceFilePaths.push(hit.evidence.filePath);
    }
    existing.sourceLines.push(line);
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function scanFixtureDataItems(fixture: string): Promise<FixtureScanResult> {
  const root = path.join(FIXTURES_ROOT, fixture);
  const files = await ingestFileSystem(root);

  const hits = matchPiiSignalsInFiles(
    files.map((file) => ({ filePath: file.path, content: file.content })),
  );

  return {
    fixture,
    findings: hitsToDataItemFindings(hits),
    scannedFiles: files.map((file) => file.path),
  };
}
