import assert from "node:assert/strict";
import test from "node:test";
import {
  CMS_FOOTER_NAVIGATION_MAX,
  CMS_HEADER_NAVIGATION_MAX,
  CMS_NAVIGATION_MAX,
  assertPagePublicationStructure,
  assertLegalStatusSnapshotCoherent,
  canonicalJson,
  contrastRatio,
  contentHash,
  parseClubProfileSnapshot,
  parseCommunityLinkSnapshot,
  parseLegalStatusSnapshot,
  parseNavigationSnapshot,
  parsePageSnapshot,
  parseSiteIdentitySnapshot,
} from "../../lib/server/organizer/cms-validation.ts";

test("mandatory public pages require substantive route-appropriate copy and metadata", () => {
  for (const [slug, title, type] of [
    ["home", "Home", "hero"],
    ["events", "Events", "intro"],
    ["clubs", "Clubs", "intro"],
    ["community", "Community", "intro"],
    ["about", "About", "intro"],
    ["get-involved", "Get Involved", "intro"],
    ["host-an-event", "Host an Event", "intro"],
    ["contact", "Contact", "intro"],
    ["conduct", "Code of Conduct", "intro"],
    ["accessibility", "Accessibility", "intro"],
    ["privacy", "Privacy", "intro"],
  ]) {
    const nearEmpty = parsePageSnapshot({
      blocks: [{
        id: "required",
        type,
        config: { eyebrow: "Note", heading: "A", text: "x" },
      }],
      metaDescription: "x",
      openGraphAssetId: null,
      seoTitle: "A",
      slug,
      title: "A",
    });
    assert.throws(
      () => assertPagePublicationStructure(nearEmpty),
      (error) =>
        error?.issues?.some(
          ({ code }) => code === "required_page_structure",
        ),
      slug,
    );

    const substantive = parsePageSnapshot({
      blocks: [{
        id: "required",
        type,
        config: {
          heading: title,
          text: "Substantive truthful public information for this route.",
        },
      }],
      metaDescription:
        "Substantive truthful metadata for this public information page.",
      openGraphAssetId: null,
      seoTitle: title,
      slug,
      title,
    });
    assert.doesNotThrow(
      () => assertPagePublicationStructure(substantive),
      slug,
    );
  }
});

test("page revisions accept the allowlisted block model and canonicalize deterministically", async () => {
  const snapshot = parsePageSnapshot({
    title: "About",
    slug: "about",
    seoTitle: "About Vancouver Curiosity Club",
    metaDescription: "A concise, factual introduction to the community.",
    blocks: [
      {
        id: "intro",
        type: "intro",
        config: {
          heading: "Curiosity is better in company.",
          text: "Thoughtful gatherings in Vancouver.",
          paragraphs: ["No expertise is required."],
        },
      },
      {
        id: "links",
        type: "ordered_link_list",
        config: {
          heading: "Continue exploring",
          items: [
            {
              label: "Events",
              description: "Browse published events.",
              url: "/events?state=upcoming",
            },
            {
              label: "Official destination",
              description: null,
              url: "https://www.meetup.com/example-group/#ignored",
            },
          ],
        },
      },
    ],
  });
  assert.equal(snapshot.blocks.length, 2);
  assert.equal(
    snapshot.blocks[1].config.items[1].url,
    "https://www.meetup.com/example-group/",
  );
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 } }),
    '{"nested":{"a":1,"b":2},"z":1}',
  );
  assert.equal(
    await contentHash({ z: 1, nested: { b: 2, a: 1 } }),
    await contentHash({ nested: { a: 1, b: 2 }, z: 1 }),
  );
});

test("page revisions reject unsafe markup, protected routes, legal bypasses, duplicate blocks, and size bounds", () => {
  const base = {
    title: "About",
    slug: "about",
    seoTitle: "About",
    metaDescription: "About the community.",
    blocks: [],
  };
  for (const block of [
    {
      id: "unsafe-script",
      type: "prose",
      config: { text: "<script>alert(1)</script>" },
    },
    {
      id: "unsafe-markdown",
      type: "prose",
      config: { text: "[private](javascript:alert(1))" },
    },
    {
      id: "private-route",
      type: "ordered_link_list",
      config: {
        items: [{ label: "Private", description: null, url: "/organizer" }],
      },
    },
    {
      id: "legal-bypass",
      type: "prose",
      config: { text: "We are a registered charity." },
    },
  ]) {
    assert.throws(() => parsePageSnapshot({ ...base, blocks: [block] }));
  }
  const duplicate = {
    id: "same",
    type: "prose",
    config: { text: "A safe paragraph." },
  };
  assert.throws(() =>
    parsePageSnapshot({ ...base, blocks: [duplicate, duplicate] }),
  );
  assert.throws(() =>
    parsePageSnapshot({
      ...base,
      blocks: Array.from({ length: 25 }, (_, index) => ({
        id: `block-${index}`,
        type: "prose",
        config: { text: "Safe." },
      })),
    }),
  );
  assert.throws(() =>
    parsePageSnapshot({
      ...base,
      blocks: [
        {
          id: "oversize",
          type: "prose",
          config: { text: "x".repeat(4_001) },
        },
      ],
    }),
  );
  assert.throws(() => parsePageSnapshot({ ...base, slug: "api" }));
  assert.throws(() =>
    parsePageSnapshot({ ...base, openGraphAssetId: "../private-key" }),
  );
  for (const claim of [
    "We are a non-profit organization.",
    "We are a registered society.",
    "We are an incorporated society.",
    "Our legal status is confirmed.",
    "We are a Registered, charity.",
    "We are a Registered (charity).",
    "We are a Registered/charity.",
    "We are a Registered.charity.",
    "We are a Registered_charity.",
    "We are a Registered\u00b7charity.",
    "We are a registered\u200bcharity.",
    "We are a registered char\u200city.",
    "We are a registered char\u200dity.",
    "We are a registered\u2060charity.",
    "We are a registered char\ufeffity.",
    "We are a registered\u2066charity\u2069.",
    "We are a charity.",
    "We are a charitable organization.",
    "We are a not-for-profit organization.",
    "We are tax exempt.",
    "We are government-funded.",
    "We are registered as a charity.",
    "We are incorporated under the Societies Act.",
    "We are registered with the CRA.",
    "We can issue donation receipts.",
    "We are not a registered charity.",
    "Donations are not tax deductible.",
    "We cannot issue tax receipts.",
    "We do not issue donation receipts.",
    "We operate as a charity.",
    "Our charitable work is recognized by the CRA.",
    "Your donations qualify for a tax deduction.",
    "We issue official donation receipts.",
    "We are a BC society.",
    "We are incorporated in BC.",
    "Gifts qualify for deductions.",
    "We issue official receipts for gifts.",
    "Funded by the City of Vancouver.",
    "Supported by a municipal grant.",
  ]) {
    assert.throws(() =>
      parsePageSnapshot({
        ...base,
        blocks: [
          { id: "legal-bypass", type: "prose", config: { text: claim } },
        ],
      }),
    );
  }
  assert.equal(
    parsePageSnapshot({
      ...base,
      blocks: [
        {
          id: "neutral",
          type: "prose",
          config: { text: "We are a community organization." },
        },
      ],
    }).blocks.length,
    1,
  );
});

test("navigation requires exact primary destinations, organizer login, and footer policies", () => {
  const items = [
    ["events", "Events", "header", 10, "/events"],
    ["clubs", "Clubs", "header", 20, "/clubs"],
    ["community", "Community", "header", 30, "/community"],
    ["about", "About", "header", 40, "/about"],
    ["get-involved", "Get Involved", "header", 50, "/get-involved"],
    ["organizer", "Organizer Login", "header", 60, "/organizer"],
    ["footer-events", "Events", "footer", 10, "/events"],
    ["footer-clubs", "Clubs", "footer", 20, "/clubs"],
    ["footer-community", "Community", "footer", 30, "/community"],
    ["footer-about", "About", "footer", 40, "/about"],
    ["footer-involved", "Get Involved", "footer", 50, "/get-involved"],
    ["contact", "Contact", "footer", 60, "/contact"],
    ["conduct", "Code of Conduct", "footer", 70, "/conduct"],
    ["accessibility", "Accessibility", "footer", 80, "/accessibility"],
    ["privacy", "Privacy", "footer", 90, "/privacy"],
  ].map(([id, label, placement, sortOrder, target]) => ({
    id,
    label,
    placement,
    sortOrder,
    target,
  }));
  assert.equal(parseNavigationSnapshot({ items }).items.length, 15);
  assert.equal(
    parseNavigationSnapshot({
      items: items.map((item) =>
        item.target === "/events"
          ? { ...item, label: "What’s On" }
          : item,
      ),
    }).items.find(({ target }) => target === "/events").label,
    "What’s On",
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: items.filter(({ target }) => target !== "/privacy"),
    }),
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: items.map((item) =>
        item.target === "/organizer"
          ? { ...item, label: "Portal" }
          : item,
      ),
    }),
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: [
        ...items,
        {
          ...items[0],
          id: "duplicate-events",
        },
      ],
    }),
  );
  const maximumItems = [
    ...items,
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `header-optional-${index}`,
      label: `Header optional ${index + 1}`,
      placement: "header",
      sortOrder: 100 + index,
      target: `https://header.example.com/confirmed-${index + 1}`,
    })),
    ...Array.from({ length: 15 }, (_, index) => ({
      id: `footer-optional-${index}`,
      label: `Footer optional ${index + 1}`,
      placement: "footer",
      sortOrder: 100 + index,
      target: `https://footer.example.com/confirmed-${index + 1}`,
    })),
  ];
  const parsedMaximum = parseNavigationSnapshot({ items: maximumItems });
  assert.equal(parsedMaximum.items.length, CMS_NAVIGATION_MAX);
  assert.equal(
    parsedMaximum.items.filter(({ placement }) => placement === "header")
      .length,
    CMS_HEADER_NAVIGATION_MAX,
  );
  assert.equal(
    parsedMaximum.items.filter(({ placement }) => placement === "footer")
      .length,
    CMS_FOOTER_NAVIGATION_MAX,
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: [
        ...maximumItems,
        {
          id: "footer-overflow",
          label: "Footer overflow",
          placement: "footer",
          sortOrder: 300,
          target: "https://footer.example.com/confirmed-overflow",
        },
      ],
    }),
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: [
        ...maximumItems,
        {
          id: "header-overflow",
          label: "Header overflow",
          placement: "header",
          sortOrder: 300,
          target: "https://header.example.com/confirmed-overflow",
        },
      ],
    }),
  );
  assert.throws(() =>
    parseNavigationSnapshot({
      items: items.map((item) =>
        item.target === "/events"
          ? { ...item, target: "https://elsewhere.example/events" }
          : item,
      ),
    }),
  );
});

test("community links require explicit confirmation data and canonical HTTPS URLs", () => {
  const parsed = parseCommunityLinkSnapshot({
    label: "Vancouver Curiosity Club on Meetup",
    description: "The confirmed public group destination.",
    destinationType: "meetup_group",
    confirmed: true,
    sortOrder: 10,
    url: "https://www.meetup.com/vancouver-meetup-group/?utm_source=test#x",
  });
  assert.equal(
    parsed.url,
    "https://www.meetup.com/vancouver-meetup-group/",
  );
  assert.throws(() =>
    parseCommunityLinkSnapshot({
      ...parsed,
      url: "javascript:alert(1)",
    }),
  );
  assert.throws(() =>
    parseCommunityLinkSnapshot({
      ...parsed,
      url: "https://user:secret@example.com/path",
    }),
  );
  assert.throws(() =>
    parseCommunityLinkSnapshot({
      ...parsed,
      url: "https://example.com/not-a-meetup-group/",
    }),
  );
  assert.equal(
    parseCommunityLinkSnapshot({
      ...parsed,
      destinationType: "meetup_discussion",
      url: "https://www.meetup.com/vancouver-meetup-group/discussions/?utm_source=test",
    }).url,
    "https://www.meetup.com/vancouver-meetup-group/discussions/",
  );
});

test("legal validation keeps provincial and charity facts separate", () => {
  const neutral = parseLegalStatusSnapshot({
    legalName: null,
    jurisdiction: null,
    legalFormWording: null,
    registrationNumber: null,
    effectiveDate: null,
    footerWording: null,
    charityStatus: "unconfirmed",
    charityNumber: null,
  });
  assert.equal(neutral.charityStatus, "unconfirmed");
  const registered = parseLegalStatusSnapshot({
    ...neutral,
    legalName: "Synthetic Test Organization",
    jurisdiction: "British Columbia",
    legalFormWording: "Synthetic test status",
    registrationNumber: "SYNTHETIC-ONLY",
    effectiveDate: "2026-07-27",
    footerWording: "Synthetic local test wording",
    charityStatus: "registered",
    charityNumber: "SYNTHETIC-CHARITY",
  });
  assert.equal(registered.charityNumber, "SYNTHETIC-CHARITY");
  assert.throws(() =>
    parseLegalStatusSnapshot({
      ...neutral,
      charityNumber: "UNBOUND",
    }),
  );
  assert.throws(() =>
    parseLegalStatusSnapshot({
      ...neutral,
      charityStatus: "registered",
    }),
  );
  for (const footerWording of [
    "We are a charity.",
    "We are a charitable organization.",
    "We are registered as a charity.",
    "We are registered with the CRA.",
    "We can issue donation receipts.",
    "Contributions are tax deductible.",
    "The organization is tax exempt.",
    "We operate as a charity.",
    "Our charitable work is recognized by the CRA.",
    "Your donations qualify for a tax deduction.",
    "We issue official donation receipts.",
    "Gifts qualify for deductions.",
    "We issue official receipts for gifts.",
  ]) {
    assert.throws(
      () =>
        assertLegalStatusSnapshotCoherent(
          parseLegalStatusSnapshot({
            ...neutral,
            footerWording,
          }),
        ),
      (error) =>
        error?.issues?.some(
          ({ code }) =>
            code === "charity_claim_requires_registration",
        ),
      footerWording,
    );
  }
  assert.throws(
    () =>
      assertLegalStatusSnapshotCoherent(
        parseLegalStatusSnapshot({
          ...neutral,
          charityStatus: "registered",
          charityNumber: "SYNTHETIC-CHARITY",
          footerWording: "We are not a registered charity.",
        }),
      ),
    (error) =>
      error?.issues?.some(
        ({ code }) =>
          code === "negative_charity_claim_requires_confirmation",
      ),
  );
  for (const footerWording of [
    "Funded by the City of Vancouver.",
    "Supported by a municipal grant.",
  ]) {
    assert.throws(
      () =>
        assertLegalStatusSnapshotCoherent(
          parseLegalStatusSnapshot({
            ...neutral,
            footerWording,
          }),
        ),
      (error) =>
        error?.issues?.some(({ code }) => code === "ambiguous_legal_claim"),
      footerWording,
    );
  }
  assert.doesNotThrow(() =>
    assertLegalStatusSnapshotCoherent(
      parseLegalStatusSnapshot({
        ...neutral,
        charityStatus: "confirmed_not_registered",
        footerWording: "We are not a registered charity.",
      }),
    ),
  );
  for (const footerWording of [
    "We are not recognized as a charity.",
    "We are not recognised as a charity.",
  ]) {
    assert.throws(
      () =>
        assertLegalStatusSnapshotCoherent(
          parseLegalStatusSnapshot({
            ...neutral,
            footerWording,
          }),
        ),
      (error) =>
        error?.issues?.some(
          ({ code }) =>
            code === "negative_charity_claim_requires_confirmation",
        ),
      footerWording,
    );
    assert.doesNotThrow(() =>
      assertLegalStatusSnapshotCoherent(
        parseLegalStatusSnapshot({
          ...neutral,
          charityStatus: "confirmed_not_registered",
          footerWording,
        }),
      ),
    );
  }
  for (const footerWording of [
    "Donations are not tax deductible.",
    "We cannot issue tax receipts.",
    "We do not issue donation receipts.",
    "We cannot provide official receipts for donations.",
    "We cannot provide official receipts for gifts.",
  ]) {
    assert.throws(
      () =>
        assertLegalStatusSnapshotCoherent(
          parseLegalStatusSnapshot({
            ...neutral,
            footerWording,
          }),
        ),
      (error) =>
        error?.issues?.some(
          ({ code }) =>
            code === "negative_tax_claim_requires_confirmed_status",
        ),
      footerWording,
    );
    assert.doesNotThrow(() =>
      assertLegalStatusSnapshotCoherent(
        parseLegalStatusSnapshot({
          ...neutral,
          charityStatus: "confirmed_not_registered",
          footerWording,
        }),
      ),
    );
    assert.doesNotThrow(() =>
      assertLegalStatusSnapshotCoherent(
        parseLegalStatusSnapshot({
          ...neutral,
          charityNumber: "SYNTHETIC-CHARITY",
          charityStatus: "registered",
          footerWording,
        }),
      ),
    );
  }
  for (const footerWording of [
    "Incorporated under the Societies Act.",
    "We are a BC society.",
    "We are incorporated in BC.",
    "We are registered under British Columbia law.",
  ]) {
    assert.throws(
      () =>
        assertLegalStatusSnapshotCoherent(
          parseLegalStatusSnapshot({
            ...neutral,
            footerWording,
            legalName: "Synthetic Test Organization",
          }),
        ),
      (error) =>
        error?.issues?.some(
          ({ code }) =>
            code === "provincial_claim_requires_complete_facts",
        ),
      footerWording,
    );
  }
  assert.throws(
    () =>
      assertLegalStatusSnapshotCoherent(
        parseLegalStatusSnapshot({
          ...neutral,
          footerWording: "This work is government funded.",
        }),
      ),
    (error) =>
      error?.issues?.some(({ code }) => code === "ambiguous_legal_claim"),
  );
  assert.doesNotThrow(() =>
    assertLegalStatusSnapshotCoherent(registered),
  );
  assert.throws(() =>
    parseLegalStatusSnapshot({
      ...neutral,
      effectiveDate: "2026-02-30",
    }),
  );
});

test("club snapshots preserve established identity fields and require exact approved formats", () => {
  const parsed = parseClubProfileSnapshot({
    coverAssetId: null,
    description: "A full factual description.",
    featured: true,
    imageAltText: null,
    laneId: "lane-think",
    meetupGroupUrl:
      "https://www.meetup.com/vancouver-meetup-group/",
    metaDescription: "Thoughtful Vancouver events.",
    name: "Vancouver Curiosity Club",
    openGraphAssetId: null,
    preparation: null,
    programType: "club",
    relatedResourceIds: [],
    seoTitle: "Vancouver Curiosity Club",
    slug: "vancouver-curiosity-club",
    socialUrls: [],
    summary: "Thoughtful Vancouver events.",
    themeColor: "#164E4A",
    thumbnailAssetId: null,
    typicalFormat: null,
    whatToExpect: null,
  });
  assert.equal(parsed.themeColor, "#164E4A");
  assert.equal(parsed.displayOrder, 1000);
  assert.equal(
    parseClubProfileSnapshot({ ...parsed, displayOrder: 0 }).displayOrder,
    0,
  );
  assert.equal(
    parseClubProfileSnapshot({
      ...parsed,
      displayOrder: 100000,
    }).displayOrder,
    100000,
  );
  for (const displayOrder of [-1, 100001, 1.5]) {
    assert.throws(() =>
      parseClubProfileSnapshot({ ...parsed, displayOrder }),
    );
  }
  for (const programType of ["club", "program", "circle", "series", "other"]) {
    assert.equal(
      parseClubProfileSnapshot({ ...parsed, programType }).programType,
      programType,
    );
  }
  for (const programType of ["Club", "workshop", ""]) {
    assert.throws(() =>
      parseClubProfileSnapshot({ ...parsed, programType }),
    );
  }
  assert.throws(() =>
    parseClubProfileSnapshot({
      ...parsed,
      meetupGroupUrl:
        "https://www.meetup.com/vancouver-meetup-group/events/123/",
    }),
  );
  assert.throws(() =>
    parseClubProfileSnapshot({
      ...parsed,
      themeColor: "forest",
    }),
  );
  assert.throws(
    () =>
      parseClubProfileSnapshot({
        ...parsed,
        themeColor: "#F3EFE4",
      }),
    (error) =>
      error?.issues?.some(
        (issue) => issue.code === "insufficient_contrast",
      ),
  );
  assert.throws(() =>
    parseClubProfileSnapshot({
      ...parsed,
      description: "An incorporated society.",
    }),
  );
});

test("site identity stays neutral unless legal wording uses the Owner-only legal workflow", () => {
  const base = {
    brandName: "Vancouver Curiosity Club",
    footerMission: "Thoughtful events in good company.",
    locationLabel: "Vancouver, British Columbia",
    logoAssetId: null,
    metaDescription: "Thoughtful events in good company.",
    mission: "A community organization for curious people.",
    openGraphAssetId: null,
    palette: {
      accent: "#2156D8",
      background: "#F5F0E6",
      foreground: "#142C30",
      secondary: "#0C665E",
    },
    seoTitle: "Vancouver Curiosity Club",
    tagline: "A social calendar with a brain.",
    typography: "editorial",
  };
  assert.ok(contrastRatio("#071B31", "#F3EFE4") >= 3);
  assert.ok(
    contrastRatio(base.palette.foreground, base.palette.background) >= 4.5,
  );
  assert.ok(
    contrastRatio(base.palette.foreground, "#E8E0CF") >= 4.5,
  );
  assert.equal(parseSiteIdentitySnapshot(base).brandName, base.brandName);
  const warmSurfacePalette = parseSiteIdentitySnapshot({
    ...base,
    palette: {
      ...base.palette,
      foreground: "#355060",
    },
  }).palette;
  assert.equal(
    warmSurfacePalette.foreground,
    "#355060",
    "paper-safe foregrounds may rely on the derived warm-surface ink",
  );
  assert.ok(contrastRatio("#071B31", "#E85B48") >= 4.5);
  assert.ok(contrastRatio("#071B31", "#D79123") >= 4.5);
  assert.ok(contrastRatio("#FFFFFF", "#071B31") >= 4.5);
  const softInkPalette = parseSiteIdentitySnapshot({
    ...base,
    palette: {
      ...base.palette,
      foreground: "#606060",
    },
  }).palette;
  assert.equal(softInkPalette.foreground, "#606060");
  assert.ok(
    contrastRatio(softInkPalette.foreground, softInkPalette.background) >=
      4.5,
  );
  assert.ok(contrastRatio(softInkPalette.foreground, "#E8E0CF") >= 4.5);
  const unsafeMutedTextPalette = {
    accent: "#071B31",
    background: "#858585",
    foreground: "#071B31",
    secondary: "#071B31",
  };
  assert.ok(
    contrastRatio(
      unsafeMutedTextPalette.foreground,
      unsafeMutedTextPalette.background,
    ) >= 4.5,
  );
  assert.ok(
    contrastRatio("#3D4A66", unsafeMutedTextPalette.background) < 4.5,
  );
  assert.throws(
    () =>
      parseSiteIdentitySnapshot({
        ...base,
        palette: unsafeMutedTextPalette,
      }),
    (error) =>
      error?.issues?.some(
        (issue) =>
          issue.code === "insufficient_contrast" &&
          /ink-soft/u.test(issue.message),
      ),
  );
  for (const surface of [
    base.palette.background,
    "#E8E0CF",
    "#E85B48",
    "#D79123",
    unsafeMutedTextPalette.background,
  ]) {
    assert.ok(
      Math.max(
        contrastRatio("#000000", surface),
        contrastRatio("#FFFFFF", surface),
      ) >= 3,
      `the two-tone focus indicator must remain visible on ${surface}`,
    );
  }
  for (const palette of [
    { ...base.palette, foreground: "#F5F0E6" },
    { ...base.palette, accent: "#F5F0E6" },
    { ...base.palette, secondary: "#F5F0E6" },
    { ...base.palette, accent: "#E8E0CF" },
    { ...base.palette, secondary: "#E8E0CF" },
  ]) {
    assert.throws(
      () => parseSiteIdentitySnapshot({ ...base, palette }),
      (error) =>
        error?.issues?.some(
          (issue) => issue.code === "insufficient_contrast",
        ),
    );
  }
  assert.throws(() =>
    parseSiteIdentitySnapshot({
      ...base,
      footerMission: "A registered non-profit society.",
    }),
  );
});
