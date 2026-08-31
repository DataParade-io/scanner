import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import { parseRubySourceFile } from "./parser";
import { detectRubyPatternsFromModel } from "./patterns";

export function detectRubyPatterns(file: FileInfo): RawFinding[] {
  const model = parseRubySourceFile(file);

  if (model.file.language !== "ruby") {
    return [];
  }

  const findings = detectRubyPatternsFromModel(model);

  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, file.content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }

  return findings;
}
