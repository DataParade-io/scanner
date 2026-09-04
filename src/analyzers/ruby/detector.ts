import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { getPropertiesFromFinding } from "../shared/property-inference";
import {
  isRailsDatabaseYmlPath,
  normalizeRubyPath,
  parseRubySourceFile,
} from "./parser";
import { detectRubyPatternsFromModel } from "./patterns";
import { detectRubyDatabaseYmlFromConfig } from "../../patterns/detectors/ruby";
import { loadUnifiedPatternConfig } from "../../patterns/config";

export function detectRubyPatterns(file: FileInfo): RawFinding[] {
  const normalizedPath = normalizeRubyPath(file.path);

  if (file.language === "yaml" && isRailsDatabaseYmlPath(normalizedPath)) {
    const findings = detectRubyDatabaseYmlFromConfig(
      {
        language: "ruby",
        file,
        normalizedPath,
        strippedContent: file.content,
      },
      loadUnifiedPatternConfig(),
    );
    return enrichFindings(findings, file.content);
  }

  if (file.language !== "ruby") {
    return [];
  }

  const model = parseRubySourceFile(file);
  const findings = detectRubyPatternsFromModel(model);
  return enrichFindings(findings, file.content);
}

function enrichFindings(
  findings: RawFinding[],
  content: string,
): RawFinding[] {
  for (const finding of findings) {
    const detected = getPropertiesFromFinding(finding, content);
    if (Object.keys(detected).length > 0) {
      finding.properties = { ...(finding.properties ?? {}), ...detected };
    }
  }
  return findings;
}
