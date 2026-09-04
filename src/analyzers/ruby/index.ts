import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectRubyPatterns } from "./detector";

export function createRubyAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectRubyPatterns(file);
    },
  };
}
