import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseRustSourceFile } from "./parser";
import { detectRustPatternsFromModel } from "./patterns";

export function detectRustPatterns(file: FileInfo): RawFinding[] {
  const model = parseRustSourceFile(file);

  if (model.file.language !== "rust") {
    return [];
  }

  const findings = detectRustPatternsFromModel(model);

  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
