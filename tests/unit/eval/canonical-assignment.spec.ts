import {
  assignDataFlowsOneToOne,
  assignDataItemsOneToOne,
  assignMentionsOneToOne,
  assignOneToOne,
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

describe("assignOneToOne scoped collision handling", () => {
  it("drops all pairs for a rolled-up data-item finding that matches multiple same-key gold rows", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/a.yml", 1, 1)],
        }),
        "gold-username-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/b.yml", 2, 2)],
        }),
        "gold-username-b",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:password",
          conceptLeaf: "password",
          evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
        }),
        "gold-password",
      ),
    ];

    const usernameFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:username",
        conceptLeaf: "username",
        evidenceLocations: [
          sampleEvidence("src/a.yml", 1, 1),
          sampleEvidence("src/b.yml", 2, 2),
        ],
      }),
      "finding-username",
    );
    const passwordFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:password",
        conceptLeaf: "password",
        evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
      }),
      "finding-password",
    );

    const result = assignOneToOne(expectations, [usernameFinding, passwordFinding]);

    expect(result.ambiguous).toBe(true);
    expect(
      result.pairs.filter((pair) => pair.findingId === "finding-username"),
    ).toEqual([]);
    expect(result.pairs).toEqual([
      { expectationId: "gold-password", findingId: "finding-password" },
    ]);
    expect(result.unmatchedExpectationIds).toEqual(
      expect.arrayContaining(["gold-username-a", "gold-username-b"]),
    );
    expect(result.unmatchedFindingIds).toContain("finding-username");
  });
});

describe("assignDataItemsOneToOne evidence-scoped slices", () => {
  it("credits each same-key gold row for a rolled-up multi-location finding", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/a.yml", 1, 1)],
        }),
        "gold-username-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/b.yml", 2, 2)],
        }),
        "gold-username-b",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:password",
          conceptLeaf: "password",
          evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
        }),
        "gold-password",
      ),
    ];

    const usernameFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:username",
        conceptLeaf: "username",
        evidenceLocations: [
          sampleEvidence("src/a.yml", 1, 1),
          sampleEvidence("src/b.yml", 2, 2),
        ],
      }),
      "finding-username",
    );
    const passwordFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:password",
        conceptLeaf: "password",
        evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
      }),
      "finding-password",
    );

    const result = assignDataItemsOneToOne(expectations, [
      usernameFinding,
      passwordFinding,
    ]);

    expect(result.pairs).toEqual(
      expect.arrayContaining([
        { expectationId: "gold-username-a", findingId: "finding-username" },
        { expectationId: "gold-username-b", findingId: "finding-username" },
        { expectationId: "gold-password", findingId: "finding-password" },
      ]),
    );
    expect(result.pairs).toHaveLength(3);
    expect(result.unmatchedExpectationIds).toEqual([]);
  });

  it("credits gold rows whose evidence spans multiple slices on one rolled finding", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 537, 539)],
        }),
        "gold-mail-field",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 581, 583)],
        }),
        "gold-init-field",
      ),
    ];

    const emailFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:email",
        conceptLeaf: "email_address",
        evidenceLocations: [
          sampleEvidence("src/Entity/User.php", 537, 537),
          sampleEvidence("src/Entity/User.php", 538, 538),
          sampleEvidence("src/Entity/User.php", 539, 539),
          sampleEvidence("src/Entity/User.php", 581, 581),
          sampleEvidence("src/Entity/User.php", 582, 582),
          sampleEvidence("src/Entity/User.php", 583, 583),
        ],
      }),
      "finding-email",
    );

    const result = assignDataItemsOneToOne(expectations, [emailFinding]);

    expect(result.pairs).toEqual(
      expect.arrayContaining([
        { expectationId: "gold-mail-field", findingId: "finding-email" },
        { expectationId: "gold-init-field", findingId: "finding-email" },
      ]),
    );
    expect(result.unmatchedExpectationIds).toEqual([]);
  });

  it("credits duplicate same-identity gold rows that share one evidence slice", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:password",
          conceptLeaf: "password",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 273, 273)],
        }),
        "gold-password-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:password",
          conceptLeaf: "password",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 273, 273)],
        }),
        "gold-password-b",
      ),
    ];

    const passwordFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:password",
        conceptLeaf: "password",
        evidenceLocations: [sampleEvidence("src/Entity/User.php", 273, 273)],
      }),
      "finding-password",
    );

    const result = assignDataItemsOneToOne(expectations, [passwordFinding]);

    expect(result.pairs).toEqual(
      expect.arrayContaining([
        { expectationId: "gold-password-a", findingId: "finding-password" },
        { expectationId: "gold-password-b", findingId: "finding-password" },
      ]),
    );
    expect(result.unmatchedExpectationIds).toEqual([]);
  });
});

describe("assignMentionsOneToOne evidence-scoped slices", () => {
  it("credits gold when adjacent-line findings span the evidence range", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/User.php", 537, 539)],
        }),
        "gold-mail",
      ),
    ];

    const adjacentFindings = [537, 538, 539].map((line, index) =>
      withId(
        buildScannerFinding({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/User.php", line, line)],
        }),
        `finding-${index}`,
      ),
    );

    const result = assignMentionsOneToOne(expectations, adjacentFindings);

    expect(result.pairs).toEqual([
      { expectationId: "gold-mail", findingId: "finding-0" },
    ]);
    expect(result.unmatchedExpectationIds).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });

  it("leaves assignment ambiguous when duplicate findings match one gold row", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/app.yml", 1, 1)],
        }),
        "gold-email",
      ),
    ];

    const duplicateFindings = [
      withId(
        buildScannerFinding({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/app.yml", 1, 1)],
        }),
        "finding-a",
      ),
      withId(
        buildScannerFinding({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/app.yml", 1, 1)],
        }),
        "finding-b",
      ),
    ];

    const result = assignMentionsOneToOne(expectations, duplicateFindings);

    expect(result.pairs).toEqual([]);
    expect(result.unmatchedExpectationIds).toEqual(["gold-email"]);
    expect(result.ambiguous).toBe(true);
  });

  it("credits multiple mention gold rows on distinct slices of one rolled finding", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 537, 539)],
        }),
        "gold-mail",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/Entity/User.php", 581, 583)],
        }),
        "gold-init",
      ),
    ];

    const emailFinding = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: [
          sampleEvidence("src/Entity/User.php", 537, 537),
          sampleEvidence("src/Entity/User.php", 581, 581),
        ],
      }),
      "finding-email",
    );

    const result = assignMentionsOneToOne(expectations, [emailFinding]);

    expect(result.pairs).toEqual(
      expect.arrayContaining([
        { expectationId: "gold-mail", findingId: "finding-email" },
        { expectationId: "gold-init", findingId: "finding-email" },
      ]),
    );
    expect(result.unmatchedExpectationIds).toEqual([]);
  });
});

describe("assignDataFlowsOneToOne duplicate-gold tie-break", () => {
  const flowEndpoints = {
    source: {
      componentType: "asset",
      endpointKey: "auth_service",
      componentSubtype: "auth_service",
    },
    target: {
      componentType: "asset",
      endpointKey: "auth_service",
      componentSubtype: "auth_service",
    },
  };

  it("credits one duplicate gold row when several match the same finding", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-flows",
          identityKey: "flow:asset:auth_service->asset:auth_service",
          conceptLeaf: "data_transfer",
          evidenceLocations: [sampleEvidence("config/session.rb", 5, 7)],
          flowEndpoints,
        }),
        "gold-session-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-flows",
          identityKey: "flow:asset:auth_service->asset:auth_service",
          conceptLeaf: "data_transfer",
          evidenceLocations: [sampleEvidence("config/session.rb", 5, 7)],
          flowEndpoints,
        }),
        "gold-session-b",
      ),
    ];
    const finding = withId(
      buildScannerFinding({
        layer: "data-flows",
        identityKey: "flow:asset:auth_service->asset:auth_service",
        conceptLeaf: "data_transfer",
        evidenceLocations: [sampleEvidence("config/session.rb", 5, 5)],
        flowEndpoints,
      }),
      "finding-session",
    );

    const result = assignDataFlowsOneToOne(expectations, [finding]);

    expect(result.pairs).toEqual([
      { expectationId: "gold-session-a", findingId: "finding-session" },
    ]);
    expect(result.unmatchedExpectationIds).toEqual(["gold-session-b"]);
    expect(result.ambiguous).toBe(true);
  });
});
