import path from "path";
import type { FileLanguage } from "../../core/types/file";
import type { LanguagePack } from "../engine/types";
import { javascriptPack } from "./javascript/pack";
import { pythonPack } from "./python/pack";
import { rubyPack } from "./ruby/pack";
import { tsxPack, typescriptPack } from "./typescript/pack";

/** Every pack the engine knows. Adding a language is a new pack plus one entry here. */
export const LANGUAGE_PACKS: readonly LanguagePack[] = [javascriptPack, typescriptPack, tsxPack, pythonPack, rubyPack];

/** The pack for a file, chosen by scanner language and extension. */
export function packForFile(language: FileLanguage, filePath: string): LanguagePack | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (language === "typescript") return ext === ".tsx" ? tsxPack : typescriptPack;
  if (language === "javascript") return javascriptPack;
  if (language === "python") return pythonPack;
  if (language === "ruby") return rubyPack;
  return undefined;
}
