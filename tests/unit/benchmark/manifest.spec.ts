import fs from "fs";
import { loadAnnotations } from "../../benchmark/manifest";
import { normalizeSubjectKey } from "../../benchmark/manifest";
import path from "path";

describe("benchmark/manifest normalizeSubjectKey", () => {
  it("leaves occurrence keys unchanged", () => {
    expect(normalizeSubjectKey("occurrences", "occurrence:email")).toBe("occurrence:email");
  });

  it("leaves data_item keys unchanged", () => {
    expect(normalizeSubjectKey("data_items", "data_item:email")).toBe(
      "data_item:email",
    );
  });

  it("trims whitespace from keys", () => {
    expect(normalizeSubjectKey("occurrences", "  occurrence:email  ")).toBe("occurrence:email");
  });
});

describe("benchmark/manifest corpus occurrence keys", () => {
  it("rejects stale pii: keys when loading occurrences annotations", () => {
    const repoDir = path.join(__dirname, "../../benchmark/repos/auth0-express");
    const annotations = loadAnnotations(repoDir, "occurrences");
    expect(annotations.length).toBeGreaterThan(0);
    for (const annotation of annotations) {
      expect(annotation.subject.key).toMatch(/^occurrence:/);
      expect(annotation.subject.key).not.toMatch(/^pii:/);
    }
  });

  it("loads occurrences.yaml only (no pii_signals.yaml fallback)", () => {
    const repoDir = path.join(__dirname, "../../benchmark/repos/wordpress");
    const occurrencesPath = path.join(repoDir, "annotations", "occurrences.yaml");
    const legacyPath = path.join(repoDir, "annotations", "pii_signals.yaml");
    expect(loadAnnotations(repoDir, "occurrences").length).toBeGreaterThan(0);
    expect(fs.existsSync(occurrencesPath)).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("loads data_item candidate blocks on data_items layer", () => {
    const repoDir = path.join(__dirname, "../../benchmark/repos/keycloak");
    const annotations = loadAnnotations(repoDir, "data_items");
    const username = annotations.find((row) => row.id === "keycloak-username");
    expect(username?.candidate?.kind).toBe("data_item");
    if (username?.candidate?.kind === "data_item") {
      expect(username.candidate.proposed_identity_key).toBe("data_item:username");
    }
  });
});
