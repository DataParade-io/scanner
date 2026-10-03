import fs from "fs";
import os from "os";
import path from "path";

import { loadConceptScopes } from "../../benchmark/manifest";
import { annotationToEvalCase } from "../../benchmark/to-eval-cases";
import type { AnnotationRecord } from "../../benchmark/schema";

describe("concept scopes", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "concept-scopes-"));
    fs.writeFileSync(
      path.join(dir, "layer-scopes.yaml"),
      [
        "layer_scopes: {}",
        "concept_scopes:",
        "  mentions:",
        "    - subject_keys: [mention:email]",
        "      exhaustive_scope_files: [b.js, a.js]",
        "      provenance: {proposed_by: t, proposed_at: '2026-09-29', review_state: proposed}",
      ].join("\n"),
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const annotation: AnnotationRecord = {
    id: "x",
    layer: "mentions",
    subject: { key: "mention:email" },
    evidence: { file_path: "a.js", start_line: 1, end_line: 1 },
    rationale: "r",
    expected: { status: "positive", labels: ["email_address"] },
    provenance: { proposed_by: "t", proposed_at: "2026-09-29", review_state: "proposed" },
  };

  it("loads concept scopes with sorted files", () => {
    const scopes = loadConceptScopes(dir).get("mentions");
    expect(scopes?.[0].subject_keys).toEqual(["mention:email"]);
    expect(scopes?.[0].exhaustive_scope_files).toEqual(["a.js", "b.js"]);
  });

  it("attaches concept scopes only when their review state is included", () => {
    const conceptScopes = loadConceptScopes(dir);
    expect(annotationToEvalCase(annotation, "fx", { conceptScopes, includeProposed: true })?.conceptScopes).toEqual([
      { subjectKeys: ["mention:email"], files: ["a.js", "b.js"] },
    ]);
    expect(
      annotationToEvalCase({ ...annotation, provenance: { ...annotation.provenance, review_state: "accepted" } }, "fx", {
        conceptScopes,
      })?.conceptScopes,
    ).toBeUndefined();
  });
});
