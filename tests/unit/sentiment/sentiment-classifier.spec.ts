import {
  CODING_DOMAIN_OVERRIDES,
  codingFilterFor,
  createSentimentBackend,
  createVaderBackend,
  labelForCompound,
  neutralizeCodingTerms,
} from "../../../src/sentiment/sentiment-classifier";

const vader = createVaderBackend();

describe("sentiment classifier: VADER backend", () => {
  it("scores plain positive and negative messages", () => {
    const good = vader.scoreMessage("this is amazing, thank you so much");
    expect(good).not.toBeNull();
    expect(good!.label).toBe("pos");
    expect(good!.compound).toBeGreaterThan(0.3);

    const bad = vader.scoreMessage("everything about this sucks, I hate it");
    expect(bad!.label).toBe("neg");
    expect(bad!.compound).toBeLessThan(-0.3);
  });

  it("labels near-zero compound as neutral", () => {
    expect(labelForCompound(0.049)).toBe("neu");
    expect(labelForCompound(0.05)).toBe("pos");
    expect(labelForCompound(-0.05)).toBe("neg");
    expect(labelForCompound(-0.049)).toBe("neu");
  });

  it("returns null for fully excluded messages (code fence only)", () => {
    const fenced = "```\nkill -9 1\nrm -rf /\n```";
    expect(vader.scoreMessage(fenced)).toBeNull();
  });

  it("scores empty text as neutral zero", () => {
    const empty = vader.scoreMessage("");
    expect(empty!.compound).toBe(0);
    expect(empty!.label).toBe("neu");
  });

  it("strips quoted regions and code before scoring", () => {
    // The fenced code carries no sentiment; the prose line does.
    const mixed = "```\nconst x = 1;\n```\nworks great now, thanks";
    const score = vader.scoreMessage(mixed);
    expect(score!.label).toBe("pos");
  });
});

describe("sentiment classifier: coding-domain overrides", () => {
  it("lists the documented technical terms", () => {
    for (const term of ["kill", "error", "fail", "bug", "crash", "abort", "exception"]) {
      expect(CODING_DOMAIN_OVERRIDES).toContain(term);
    }
  });

  it("neutralizes technical usage so kill/error/crash messages are not negative", () => {
    const cases = [
      "kill the stale worker and retry",
      "the parser throws an exception on empty input",
      "fixed the bug that made tests fail",
      "the server crash is handled by the supervisor",
      "we abort the build when lint errors appear",
    ];
    for (const text of cases) {
      const score = vader.scoreMessage(text);
      expect({ text, label: score!.label }).toEqual({ text, label: "neu" });
    }
  });

  it("keeps emotionally loaded complaints negative even next to jargon", () => {
    const cases = [
      "this crashing error is driving me insane",
      "the bug sucks so much",
      "I hate how the build fails every time",
      "what a terrible failure",
    ];
    for (const text of cases) {
      const score = vader.scoreMessage(text);
      expect({ text, label: score!.label }).toEqual({ text, label: "neg" });
    }
  });

  it("applies overrides on word boundaries only", () => {
    // "skill" and "terrific" contain override substrings but are different words.
    expect(neutralizeCodingTerms("skill issue")).toBe("skill issue");
    expect(neutralizeCodingTerms("KILL the process")).toBe("zz the process");
  });

  it("keeps negated coding statements neutral rather than positive", () => {
    const score = vader.scoreMessage("never throw an exception here");
    expect(score!.label).toBe("neu");
  });
});

describe("sentiment classifier: backend registry", () => {
  it("defaults to vader", () => {
    expect(createSentimentBackend(undefined).name).toBe("vader");
  });

  it("rejects unknown backends", () => {
    expect(() => createSentimentBackend("nope")).toThrow(/unknown sentiment backend/);
  });
});

describe("sentiment classifier: per-backend coding filter (KDATAP-d278a8)", () => {
  it("vader default applies the filter; codingFilter false scores raw text", () => {
    const text = "kill the stale worker and retry";
    expect(vader.scoreMessage(text)!.label).toBe("neu");
    const raw = createVaderBackend({ codingFilter: false });
    expect(raw.scoreMessage(text)!.label).toBe("neg");
  });

  it("codingFilterFor resolves on/off over the backend default, auto passes it through", () => {
    expect(codingFilterFor(undefined, true)).toBe(true);
    expect(codingFilterFor(undefined, false)).toBe(false);
    expect(codingFilterFor("auto", true)).toBe(true);
    expect(codingFilterFor("auto", false)).toBe(false);
    expect(codingFilterFor("on", false)).toBe(true);
    expect(codingFilterFor("off", true)).toBe(false);
  });
});