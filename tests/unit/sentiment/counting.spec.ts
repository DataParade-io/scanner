import { countMessage, hasPathLikeSuffix } from "../../../src/sentiment/counting";
import { DEFAULT_EXCLUSION_THRESHOLDS, isPastedRegion, stripExcludedRegions } from "../../../src/sentiment/exclusions";
import { loadSentimentWordList } from "../../../src/sentiment/word-lists";

const wordList = loadSentimentWordList();

function gratitude(result: ReturnType<typeof countMessage>) {
  return result.families.gratitude.tokenCount;
}

function fbomb(result: ReturnType<typeof countMessage>) {
  return result.families.fbomb.tokenCount;
}

describe("matching engine", () => {
  it("matches gratitude tokens on word boundaries, case-insensitively", () => {
    expect(gratitude(countMessage("Thanks!", wordList))).toBe(1);
    expect(gratitude(countMessage("THANKS", wordList))).toBe(1);
    expect(gratitude(countMessage("many thanks to you", wordList))).toBe(1);
  });

  it("does not match inside larger words", () => {
    expect(gratitude(countMessage("thanksgiving dinner", wordList))).toBe(0);
  });

  it("normalizes curly quotes and dashes before matching", () => {
    expect(gratitude(countMessage("thanks’ — perfect", wordList))).toBe(2);
  });

  it("matches the F-bomb family including explicit inflections", () => {
    expect(fbomb(countMessage("what the fuck", wordList))).toBe(1);
    expect(fbomb(countMessage("Fucking hell", wordList))).toBe(1);
    expect(fbomb(countMessage("WTF happened", wordList))).toBe(1);
    // No stemming guesses: only enumerated forms match.
    expect(fbomb(countMessage("unfuckable", wordList))).toBe(0);
  });

  it("does not match a token that is part of a path or filename", () => {
    expect(gratitude(countMessage("see thanks.md for details", wordList))).toBe(0);
    expect(gratitude(countMessage("the thanks/backup folder", wordList))).toBe(0);
    expect(hasPathLikeSuffix("thanks.md", 6)).toBe(true);
    expect(hasPathLikeSuffix("thanks, buddy", 6)).toBe(false);
  });
});

describe("exclusion strippers", () => {
  it("ignores matches inside fenced code blocks", () => {
    const message = "this is great:\n```bash\nnpm run fuck\n```";
    expect(fbomb(countMessage(message, wordList))).toBe(0);
    expect(gratitude(countMessage("thanks\n```\nfuck you\n```", wordList))).toBe(1);
  });

  it("ignores matches inside tilde-fenced code blocks", () => {
    const message = "thanks\n~~~\nfuck\n~~~";
    expect(fbomb(countMessage(message, wordList))).toBe(0);
  });

  it("ignores matches inside indented code blocks", () => {
    const message = "thanks, and consider:\n\n    fuck = require('fuck')\n\ndone";
    expect(fbomb(countMessage(message, wordList))).toBe(0);
  });

  it("ignores matches inside blockquotes", () => {
    expect(fbomb(countMessage("they said:\n> fuck this\nbut I say thanks", wordList))).toBe(0);
    expect(gratitude(countMessage("they said:\n> fuck this\nbut I say thanks", wordList))).toBe(1);
  });

  it("strips excluded regions before matching", () => {
    expect(stripExcludedRegions("```\nfuck\n```")).toBe("");
  });

  it("treats a long message dense with citation markers as a pasted region and excludes it", () => {
    const paste = [
      "Here were our original ideas for animations:",
      "",
      "Yes—this is a strong fit. See the references.[1]",
      ...Array.from({ length: 40 }, (_, i) => `- **Reference ${i}** explains the approach in substantial detail and is worth reading end to end before we decide how to proceed here.[${i + 1}][${i + 2}]`),
    ].join("\n");
    expect(isPastedRegion(paste)).toBe(true);
    expect(countMessage(paste.replace(/strong fit/g, "fuck"), wordList).excluded).toBe(true);
  });

  it("keeps the operator's own long orchestration briefs (no citation density)", () => {
    const brief = [
      "AUTHORIZED. Plan accepted with amendments. Implement Phase A0 only.",
      "",
      "## Worktree first (mandatory)",
      "",
      "```bash",
      "git fetch origin",
      "git worktree add -b spike/x /tmp/spike origin/develop",
      "```",
      "",
      ...Array.from({ length: 40 }, (_, i) => `${i + 1}. Do not run kbs from this worktree; keep numbers in results/. Amendment ${i}.`),
    ].join("\n");
    expect(isPastedRegion(brief)).toBe(false);
    expect(countMessage(brief, wordList).excluded).toBe(false);
  });

  it("keeps short messages even if they look dense", () => {
    expect(isPastedRegion("fuck this", DEFAULT_EXCLUSION_THRESHOLDS)).toBe(false);
  });

  it("honors configured thresholds", () => {
    const paste = Array.from({ length: 4 }, (_, i) => `see reference ${i}[${i + 1}] for the details of the cited method`).join("\n");
    expect(isPastedRegion(paste, DEFAULT_EXCLUSION_THRESHOLDS)).toBe(false);
    expect(
      isPastedRegion(paste, { ...DEFAULT_EXCLUSION_THRESHOLDS, pasteMinLength: 100, pasteMinCitationMarkers: 2 }),
    ).toBe(true);
  });
});

describe("counting semantics", () => {
  it("counts each occurrence at token level and at most once per family per message", () => {
    const result = countMessage("thanks, thanks, and thank you — fuck", wordList);
    // "thanks" x2 plus "thank" x1
    expect(gratitude(result)).toBe(3);
    expect(result.families.gratitude.tokens).toEqual({ thanks: 2, thank: 1 });
    expect(result.families.gratitude.messageCount).toBe(1);
    expect(fbomb(result)).toBe(1);
    expect(result.families.fbomb.messageCount).toBe(1);
    expect(result.classified).toBe(true);
  });

  it("reports both families for a both-classified message", () => {
    const result = countMessage("thanks for fucking nothing", wordList);
    expect(result.families.gratitude.messageCount).toBe(1);
    expect(result.families.fbomb.messageCount).toBe(1);
  });

  it("is a pure deterministic function of (text, word list)", () => {
    const a = countMessage("thanks, fuck", wordList);
    const b = countMessage("thanks, fuck", wordList);
    expect(a).toEqual(b);
  });

  it("returns unclassified for ordinary messages", () => {
    const result = countMessage("the build is green", wordList);
    expect(result.classified).toBe(false);
    expect(result.excluded).toBe(false);
  });
});
