import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import {
  renderToReadableStream,
  renderToStaticMarkup,
} from "react-dom/server";
import {
  bootstrapInitialOwner,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import {
  ensureDatabaseInvariants,
} from "../../lib/server/database/invariants.ts";
import {
  runRequestMaintenance,
} from "../../lib/server/database/request-maintenance.ts";
import {
  PHASE7_INVARIANT_TRIGGER_STATEMENTS,
} from "../../lib/server/database/phase7-invariant-sql.ts";
import {
  ensureCmsAdoption,
} from "../../lib/server/organizer/cms-adoption.ts";
import {
  createPublicFormInstanceToken,
  PUBLIC_FORM_CLIENT_COOKIE,
} from "../../lib/server/phase7/public-form-protection.ts";
import {
  listPublicFormClubProgramChoices,
} from "../../lib/server/phase7/public-forms.ts";
import {
  PUBLIC_CATALOG_PAGES,
} from "../../lib/server/public/catalog-definitions.ts";
import {
  ensurePublicCatalogAndAuthorize,
} from "../../lib/server/public/catalog.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";
import {
  ensureDatabaseInvariantsReady,
} from "../database/invariant-ready.mjs";

const PROJECT_ROOT = process.cwd();
const TEST_ORIGIN = "https://forms.example";
const OWNER_EMAIL = "phase7-route-owner@vcc-tests.invalid";
const FORM_OWNER_IDENTITY = trustedIdentityFromSites({
  displayName: "Phase 7 Route Owner",
  email: OWNER_EMAIL,
});
const RUNTIME_ENVIRONMENT = {};
const RUNTIME_ENVIRONMENT_GLOBAL =
  "__VCC_PHASE7_PUBLIC_FORM_ROUTE_TEST_ENV__";

globalThis[RUNTIME_ENVIRONMENT_GLOBAL] = RUNTIME_ENVIRONMENT;

const registerHooks = nodeModule.registerHooks;
const directRouteImportsSupported = typeof registerHooks === "function";
if (directRouteImportsSupported) {
  const cloudflareWorkersShim = dataModule(
    `export const env = globalThis.${RUNTIME_ENVIRONMENT_GLOBAL};`,
  );
  const serverOnlyShim = dataModule("export {};");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "cloudflare:workers") {
        return { shortCircuit: true, url: cloudflareWorkersShim };
      }
      if (specifier === "server-only") {
        return { shortCircuit: true, url: serverOnlyShim };
      }
      return nextResolve(specifier, context);
    },
  });
}

const routeModules = directRouteImportsSupported
  ? await Promise.all([
      import("../../app/api/forms/instance/route.ts?phase7-route-test"),
      import("../../app/api/forms/[formKey]/route.ts?phase7-route-test"),
      import("../../app/_components/PublicSubmissionForm.tsx?phase7-ui-test"),
      import("../../app/_components/PublicFormPrivacyNotice.tsx?phase7-ui-test"),
      import("../../app/_components/EditorialPage.tsx?phase7-ui-test"),
      import("../../app/_components/EditorialRouteBodies.tsx?phase7-ui-test"),
      import("../../lib/server/phase7/public-form-contract.ts?phase7-ui-test"),
    ])
  : null;

const routeTestOptions = directRouteImportsSupported
  ? {}
  : {
      skip:
        "Direct App Router imports require node:module registerHooks (Node 22.15+).",
    };

test("fresh public catalog copy truthfully describes the four stored forms", () => {
  const pageCopy = Object.fromEntries(
    PUBLIC_CATALOG_PAGES
      .filter((page) =>
        ["contact", "get-involved", "host-an-event", "privacy"].includes(
          page.slug,
        ),
      )
      .map((page) => [
        page.slug,
        JSON.stringify(page.sections.map((section) => section.content)),
      ]),
  );

  assert.match(pageCopy.contact, /private organizer inbox/u);
  assert.match(pageCopy.contact, /send an email confirmation/u);
  assert.match(pageCopy["get-involved"], /Volunteer/u);
  assert.match(
    pageCopy["get-involved"],
    /Venue or Community Partnership/u,
  );
  assert.match(pageCopy["host-an-event"], /Host an Event form/u);
  assert.match(pageCopy["host-an-event"], /does not create or publish/u);
  assert.match(pageCopy.privacy, /four public forms/u);
  assert.match(pageCopy.privacy, /Public visitors do not need to sign in/u);
  assert.doesNotMatch(
    Object.values(pageCopy).join("\n"),
    /No public intake form|tools are not open yet|No public contact form|no enabled public submission form/iu,
  );
});

test(
  "every public form has an explicit POST fallback, native validation, and a no-script safety notice",
  routeTestOptions,
  () => {
    const formSource = source("app/_components/PublicSubmissionForm.tsx");
    const formOpeningTag = /<form\b[\s\S]*?>/u.exec(formSource)?.[0];
    assert.ok(formOpeningTag, "the shared public form must render a form");
    assert.match(formOpeningTag, /\bmethod="post"/u);
    assert.match(
      formOpeningTag,
      /\baction=\{`\/api\/forms\/\$\{encodeURIComponent\(formKey\)\}`\}/u,
      "the fallback action must POST to the allowlisted form endpoint",
    );
    assert.doesNotMatch(formOpeningTag, /\bmethod="get"/iu);
    assert.doesNotMatch(formOpeningTag, /\bnoValidate\b/u);
    assert.doesNotMatch(
      formOpeningTag,
      /\?(?:[^}>'"])*(?:name|replyEmail|message|eventIdea|howToHelp)=/iu,
      "personal fields must never be encoded into the form action URL",
    );

    assert.match(
      formSource,
      /<noscript>[\s\S]*Your information has not been sent[\s\S]*<\/noscript>/u,
      "visitors without JavaScript need an explicit safe state",
    );
    const globalCss = source("app/globals.css");
    assert.match(
      globalCss,
      /\.public-submission__noscript\s*\{\s*min-height:\s*0;/u,
      "the no-script notice must stay compact",
    );
    assert.match(
      globalCss,
      /@media\s*\(scripting:\s*none\)[\s\S]*\.public-submission__loading\s*\{[\s\S]*display:\s*none;/u,
      "a no-script visitor must not hear or see a permanently busy skeleton",
    );
    assert.match(formSource, /name="name"[\s\S]*?required/u);
    assert.match(
      formSource,
      /name="replyEmail"[\s\S]*?required[\s\S]*?type="email"/u,
    );
    for (const constraint of [
      /autoComplete="name"[\s\S]*maxLength=\{100\}[\s\S]*minLength=\{2\}/u,
      /label="Reply email"[\s\S]*maxLength=\{254\}[\s\S]*minLength=\{3\}/u,
      /label="Proposed event title or topic"[\s\S]*maxLength=\{160\}[\s\S]*minLength=\{3\}/u,
      /label="Website \(HTTPS\)"[\s\S]*maxLength=\{500\}[\s\S]*pattern="\[Hh\]\[Tt\]\[Tt\]\[Pp\]\[Ss\]:\/\/\.\*"/u,
    ]) {
      assert.match(formSource, constraint);
    }
    assert.match(
      formSource,
      /aria-required="true"[\s\S]*required=\{values\.length === 0 && index === 0\}/u,
      "the volunteer group must natively require at least one choice",
    );
    assert.match(
      formSource,
      /ref=\{errorSummaryRef\}[\s\S]*role="alert"[\s\S]*tabIndex=\{-1\}/u,
      "server validation errors must remain keyboard and screen-reader accessible",
    );

    const publicFormSurfaces = [
      ["app/contact/page.tsx", ["contact"]],
      ["app/host-an-event/page.tsx", ["host_event"]],
      ["app/get-involved/page.tsx", ["volunteer", "partnership"]],
    ];
    const surfacedFormKeys = [];
    for (const [path, expectedFormKeys] of publicFormSurfaces) {
      const pageSource = source(path);
      for (const formKey of expectedFormKeys) {
        assert.match(
          pageSource,
          new RegExp(
            `<PublicSubmissionForm\\b[^>]*\\bformKey="${escapeRegex(formKey)}"`,
            "u",
          ),
          `${path} must use the safe shared transport for ${formKey}`,
        );
        surfacedFormKeys.push(formKey);
      }
    }
    assert.deepEqual(surfacedFormKeys.sort(), [
      "contact",
      "host_event",
      "partnership",
      "volunteer",
    ]);

    const { parsePublicFormPayload, PublicFormValidationError } =
      routeModules[6];
    for (const formKey of surfacedFormKeys) {
      assert.throws(
        () => parsePublicFormPayload(formKey, {}),
        (error) =>
          error instanceof PublicFormValidationError &&
          error.fieldErrors.name === "This field is required." &&
          error.fieldErrors.replyEmail === "A reply email is required.",
        `${formKey} must retain server-side validation`,
      );
    }
    assert.match(
      source("lib/server/phase7/public-forms.ts"),
      /parsePublicFormPayload\(input\.formKey, input\.payload\)/u,
      "the POST storage path must validate on the server before writing",
    );
  },
);

test(
  "broken-JavaScript form POSTs fail safely without putting personal information in a URL",
  routeTestOptions,
  async () => {
    const [, { POST }] = routeModules;
    for (const formKey of [
      "contact",
      "host_event",
      "partnership",
      "volunteer",
    ]) {
      const sensitiveMarkers = {
        email: `${formKey}-fallback-person@example.invalid`,
        message: `${formKey} private fallback message 9137`,
        name: `${formKey} Fallback Person 7241`,
      };
      const body = new URLSearchParams({
        message: sensitiveMarkers.message,
        name: sensitiveMarkers.name,
        replyEmail: sensitiveMarkers.email,
      });
      const response = await POST(
        new Request(`${TEST_ORIGIN}/api/forms/${formKey}`, {
          body,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: TEST_ORIGIN,
          },
          method: "POST",
        }),
        routeContext(formKey),
      );

      assert.notEqual(response.status, 405, `${formKey} must accept POST`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
      const location = response.headers.get("location");
      if (location !== null) {
        const resolvedLocation = new URL(location, TEST_ORIGIN);
        for (const marker of Object.values(sensitiveMarkers)) {
          assert.doesNotMatch(
            resolvedLocation.href,
            new RegExp(escapeRegex(marker), "iu"),
            `${formKey} must not copy personal information into a redirect URL`,
          );
          assert.doesNotMatch(
            resolvedLocation.href,
            new RegExp(escapeRegex(encodeURIComponent(marker)), "iu"),
            `${formKey} must not URL-encode personal information into a redirect`,
          );
        }
      }

      const contentType = response.headers.get("content-type") ?? "";
      const isSafeHtmlFailure =
        response.status >= 400 && /^text\/html(?:;|$)/iu.test(contentType);
      const isCleanRedirect =
        response.status >= 300 && response.status < 400 && location !== null;
      assert.ok(
        isSafeHtmlFailure || isCleanRedirect,
        `${formKey} must return a human-readable safe failure or a clean redirect when JavaScript is unavailable`,
      );
    }
  },
);

test(
  "valid native Contact and Volunteer POSTs store once and return PII-free HTML",
  routeTestOptions,
  async (t) => {
    const [, { POST }] = routeModules;
    const cases = [
      {
        expectedPayload: {
          message: "Please share the accessible entrance instructions.",
          name: "Native Contact Person 5821",
          replyEmail: "native-contact-5821@visitor.invalid",
          topic: "Accessibility",
        },
        fields: [
          ["name", "Native Contact Person 5821"],
          ["replyEmail", "native-contact-5821@visitor.invalid"],
          ["topic", "Accessibility"],
          ["message", "Please share the accessible entrance instructions."],
        ],
        formKey: "contact",
      },
      {
        expectedPayload: {
          availabilityContext: "Weekday evenings after six.",
          howToHelp: "I would like to welcome newcomers at gatherings.",
          interestAreas: ["Welcoming", "Event support"],
          name: "Native Volunteer Person 6914",
          replyEmail: "native-volunteer-6914@visitor.invalid",
        },
        fields: [
          ["name", "Native Volunteer Person 6914"],
          ["replyEmail", "native-volunteer-6914@visitor.invalid"],
          ["interestAreas", "Welcoming"],
          ["interestAreas", "Event support"],
          [
            "howToHelp",
            "I would like to welcome newcomers at gatherings.",
          ],
          ["availabilityContext", "Weekday evenings after six."],
        ],
        formKey: "volunteer",
      },
    ];

    for (const testCase of cases) {
      const data = await fixture();
      t.after(() => data.database.close());
      const credentials = await pastNativeFormCredentials(
        data.database,
        testCase.formKey,
      );
      const fields = new URLSearchParams([
        ["instanceToken", credentials.instanceToken],
        ["companyFax", ""],
        ...testCase.fields,
      ]);
      const response = await POST(
        nativeFormRequest(`/api/forms/${testCase.formKey}`, {
          cookie: credentials.cookie,
          fields,
        }),
        routeContext(testCase.formKey),
      );

      assert.equal(response.status, 201, testCase.formKey);
      const html = await assertPrivateNativeHtml(response, {
        title: "Submission received",
      });
      for (const privateValue of Object.values(testCase.expectedPayload)
        .flat()) {
        assert.doesNotMatch(
          html,
          new RegExp(escapeRegex(privateValue), "iu"),
          `${testCase.formKey} success HTML must not echo submitted PII`,
        );
      }
      const stored = await data.database
        .prepare(
          `SELECT payload_json
           FROM form_submissions
           WHERE json_extract(payload_json, '$.replyEmail') = ?
           LIMIT 1`,
        )
        .bind(testCase.expectedPayload.replyEmail)
        .first();
      assert.ok(stored, `${testCase.formKey} must be stored`);
      assert.deepEqual(
        JSON.parse(stored.payload_json),
        testCase.expectedPayload,
      );
      assert.equal(
        await tableCount(data.database, "form_submissions"),
        1,
      );
    }
  },
);

test(
  "native POST rejects duplicate scalar and token fields without echoing them",
  routeTestOptions,
  async (t) => {
    const [, { POST }] = routeModules;
    for (const duplicateField of ["name", "instanceToken"]) {
      const data = await fixture();
      t.after(() => data.database.close());
      const credentials = await pastNativeFormCredentials(
        data.database,
        "contact",
      );
      const privateName = `Duplicate ${duplicateField} Person 8173`;
      const privateEmail =
        `duplicate-${duplicateField}-8173@visitor.invalid`;
      const fields = new URLSearchParams([
        ["instanceToken", credentials.instanceToken],
        ["companyFax", ""],
        ["name", privateName],
        ["replyEmail", privateEmail],
        ["topic", "Privacy"],
        ["message", "Please handle this private duplicate test safely."],
      ]);
      fields.append(
        duplicateField,
        duplicateField === "instanceToken"
          ? credentials.instanceToken
          : "Second private scalar value 2046",
      );

      const response = await POST(
        nativeFormRequest("/api/forms/contact", {
          cookie: credentials.cookie,
          fields,
        }),
        routeContext("contact"),
      );
      assert.equal(response.status, 422, duplicateField);
      const html = await assertPrivateNativeHtml(response, {
        title: "The submission was not sent",
      });
      for (const privateValue of [
        privateName,
        privateEmail,
        "Second private scalar value 2046",
      ]) {
        assert.doesNotMatch(
          html,
          new RegExp(escapeRegex(privateValue), "iu"),
        );
      }
      assert.equal(
        await tableCount(data.database, "form_submissions"),
        0,
      );
    }
  },
);

test(
  "native POST over 16 KiB fails as private HTML without storing or echoing PII",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    const [, { POST }] = routeModules;
    const credentials = await pastNativeFormCredentials(
      data.database,
      "contact",
    );
    const privateSentinel = "oversized-private-sentinel-7348";
    const fields = new URLSearchParams({
      companyFax: "",
      instanceToken: credentials.instanceToken,
      message: `${privateSentinel}${"x".repeat(17_000)}`,
      name: "Oversized Native Person 7348",
      replyEmail: "oversized-native-7348@visitor.invalid",
      topic: "Privacy",
    });
    assert.ok(new TextEncoder().encode(fields.toString()).byteLength > 16_384);

    const response = await POST(
      nativeFormRequest("/api/forms/contact", {
        cookie: credentials.cookie,
        fields,
      }),
      routeContext("contact"),
    );
    assert.equal(response.status, 422);
    const html = await assertPrivateNativeHtml(response, {
      title: "The submission was not sent",
    });
    assert.doesNotMatch(html, new RegExp(privateSentinel, "u"));
    assert.doesNotMatch(html, /oversized-native-7348@visitor\.invalid/u);
    assert.equal(await tableCount(data.database, "form_submissions"), 0);
  },
);

test(
  "the existing JSON POST success and validation contracts remain unchanged",
  routeTestOptions,
  async (t) => {
    const [, { POST }] = routeModules;
    const successData = await fixture();
    t.after(() => successData.database.close());
    const successCredentials = await pastNativeFormCredentials(
      successData.database,
      "contact",
    );
    const successResponse = await POST(
      jsonRequest("/api/forms/contact", {
        cookie: successCredentials.cookie,
        instanceToken: successCredentials.instanceToken,
        payload: {
          message: "Please share the quiet arrival instructions.",
          name: "JSON Contract Person",
          replyEmail: "json-contract@visitor.invalid",
          topic: "Event question",
        },
      }),
      routeContext("contact"),
    );
    assert.equal(successResponse.status, 201);
    assert.match(
      successResponse.headers.get("content-type") ?? "",
      /^application\/json(?:;|$)/iu,
    );
    const successBody = await successResponse.json();
    assert.match(successBody.publicReference, /^VCC-[A-Z0-9-]+$/u);
    assert.deepEqual(successBody, {
      message:
        `Thanks \u2014 your submission was stored in the private organizer inbox. Reference: ${successBody.publicReference}. No email confirmation was sent.`,
      publicReference: successBody.publicReference,
      stored: true,
    });

    const invalidData = await fixture();
    t.after(() => invalidData.database.close());
    const invalidCredentials = await pastNativeFormCredentials(
      invalidData.database,
      "contact",
    );
    const invalidResponse = await POST(
      jsonRequest("/api/forms/contact", {
        cookie: invalidCredentials.cookie,
        instanceToken: invalidCredentials.instanceToken,
        payload: {
          message: "short",
          name: "JSON Validation Person",
          replyEmail: "not-an-email",
          topic: "Privacy",
        },
      }),
      routeContext("contact"),
    );
    assert.equal(invalidResponse.status, 422);
    assert.match(
      invalidResponse.headers.get("content-type") ?? "",
      /^application\/json(?:;|$)/iu,
    );
    assert.deepEqual(await invalidResponse.json(), {
      error: {
        code: "validation_failed",
        fieldErrors: {
          message: "Use at least 10 characters.",
          replyEmail: "Enter a valid reply email.",
        },
        message: "The form could not be validated.",
      },
      values: {
        message: "short",
        name: "JSON Validation Person",
        replyEmail: "not-an-email",
        topic: "Privacy",
      },
    });
  },
);

test("Host an Event choices suppress only same-name same-slug Program aliases", async (t) => {
  const data = await fixture();
  t.after(() => data.database.close());
  const actor = await ensurePublicCatalogAndAuthorize(
    data.database,
    FORM_OWNER_IDENTITY,
    data.now + 1,
  );
  await ensureCmsAdoption(data.database, actor, data.now + 2);

  assert.equal(
    await data.database
      .prepare(
        `SELECT count(*)
         FROM programs AS program
         JOIN clubs AS club
           ON club.id = program.club_id
          AND club.organization_id = program.organization_id
         JOIN program_public_profile_details AS detail
           ON detail.program_id = program.id
          AND detail.organization_id = program.organization_id
          AND detail.club_id = program.club_id
         WHERE program.deleted_at IS NULL
           AND club.deleted_at IS NULL
           AND detail.deleted_at IS NULL
           AND detail.publication_status = 'published'
           AND program.slug = club.slug
           AND lower(trim(program.name)) = lower(trim(club.name))`,
      )
      .first("count(*)"),
    3,
    "the fixture must contain the compatibility aliases this projection hides",
  );

  assert.deepEqual(await listPublicFormClubProgramChoices(data.database), [
    {
      label: "Vancouver Curiosity Club",
      value: "club:vancouver-curiosity-club",
    },
    {
      label: "Vancouver Fantasy & Sci-Fi Group",
      value: "club:vancouver-fantasy-scifi-group",
    },
    {
      label: "Vancouver Literature and Film",
      value: "club:vancouver-literature-and-film",
    },
  ]);
});

test(
  "public form instance and all legitimate POST routes stay below the full D1 request cap",
  routeTestOptions,
  async (t) => {
    const [{ GET }, { POST }] = routeModules;
    const getData = await fixture();
    t.after(() => getData.database.close());
    await ensureDatabaseInvariantsReady(getData.database);
    const countedGet = statementCountingDatabase(getData.database);
    RUNTIME_ENVIRONMENT.DB = countedGet.database;
    assert.equal(
      await ensureDatabaseInvariants(countedGet.database),
      "ready",
    );
    assert.deepEqual(
      await runRequestMaintenance(countedGet.database, {
        method: "GET",
        pathname: "/api/forms/instance",
      }),
      { kind: "continue" },
    );
    const instanceResponse = await GET(
      new Request(`${TEST_ORIGIN}/api/forms/instance?form=contact`),
    );
    assert.equal(instanceResponse.status, 200);
    assert.ok(countedGet.count > 0);
    assert.ok(
      countedGet.count < 50,
      `public form instance used ${countedGet.count} D1 statements`,
    );

    const measuredPosts = {};
    for (const [index, [formKey, payload]] of Object.entries({
      contact: {
        message: "Please share the accessible entrance information.",
        name: "Contact Visitor",
        replyEmail: "contact-route-budget@visitor.invalid",
        topic: "Accessibility",
      },
      host_event: {
        eventIdea:
          "A careful discussion about accessible neighbourhood walks.",
        format: "In person",
        name: "Host Visitor",
        preferredClubOrProgram:
          "club:vancouver-curiosity-club",
        preferredTiming: "A weekend afternoon.",
        proposedTitle: "Accessible curiosity walk",
        replyEmail: "host-route-budget@visitor.invalid",
      },
      partnership: {
        message:
          "We would like to discuss an accessible community gathering.",
        name: "Partner Visitor",
        organizationOrVenueName: "Example Venue",
        partnershipType: "Venue",
        replyEmail: "partner-route-budget@visitor.invalid",
        website: "https://example.invalid/venue",
      },
      volunteer: {
        availabilityContext: "Some weekday evenings.",
        howToHelp: "I would like to welcome people at public events.",
        interestAreas: ["Welcoming", "Event support"],
        name: "Volunteer Visitor",
        replyEmail: "volunteer-route-budget@visitor.invalid",
      },
    }).entries()) {
      const data = await fixture();
      t.after(() => data.database.close());
      if (formKey === "host_event") {
        const actor = await ensurePublicCatalogAndAuthorize(
          data.database,
          FORM_OWNER_IDENTITY,
          data.now + 1,
        );
        await ensureCmsAdoption(
          data.database,
          actor,
          data.now + 2,
        );
      }
      const token = await pastInstanceToken(data.database, formKey);
      await ensureDatabaseInvariantsReady(data.database);
      const countedPost = statementCountingDatabase(data.database);
      RUNTIME_ENVIRONMENT.DB = countedPost.database;
      assert.equal(
        await ensureDatabaseInvariants(countedPost.database),
        "ready",
      );
      assert.deepEqual(
        await runRequestMaintenance(countedPost.database, {
          method: "POST",
          pathname: `/api/forms/${formKey}`,
        }),
        { kind: "continue" },
      );
      const response = await POST(
        jsonRequest(`/api/forms/${formKey}`, {
          cookie: clientCookie(String(index + 1)),
          instanceToken: token,
          payload,
        }),
        routeContext(formKey),
      );
      assert.equal(
        response.status,
        201,
        `${formKey}: ${await response.clone().text()}`,
      );
      measuredPosts[formKey] = countedPost.count;
      assert.ok(countedPost.count > 0, formKey);
      assert.ok(
        countedPost.count < 50,
        `${formKey} used ${countedPost.count} D1 statements`,
      );
    }

    const invalidData = await fixture();
    t.after(() => invalidData.database.close());
    const invalidToken = await pastInstanceToken(
      invalidData.database,
      "contact",
    );
    await ensureDatabaseInvariantsReady(invalidData.database);
    const countedInvalid = statementCountingDatabase(invalidData.database);
    RUNTIME_ENVIRONMENT.DB = countedInvalid.database;
    assert.equal(
      await ensureDatabaseInvariants(countedInvalid.database),
      "ready",
    );
    assert.deepEqual(
      await runRequestMaintenance(countedInvalid.database, {
        method: "POST",
        pathname: "/api/forms/contact",
      }),
      { kind: "continue" },
    );
    const invalidResponse = await POST(
      jsonRequest("/api/forms/contact", {
        cookie: clientCookie("I"),
        instanceToken: invalidToken,
        payload: {
          message: "short",
          name: "x",
          replyEmail: "not-an-email",
          topic: "Privacy",
        },
      }),
      routeContext("contact"),
    );
    assert.equal(invalidResponse.status, 422);
    assert.equal(
      await tableCount(invalidData.database, "form_submissions"),
      0,
    );
    measuredPosts.invalid_contact = countedInvalid.count;
    assert.ok(
      countedInvalid.count < 50,
      `invalid contact used ${countedInvalid.count} D1 statements`,
    );

    assert.deepEqual(
      {
        instanceGet: countedGet.count,
        ...measuredPosts,
      },
      {
        instanceGet: 5,
        contact: 15,
        host_event: 16,
        invalid_contact: 9,
        partnership: 15,
        volunteer: 15,
      },
    );
    RUNTIME_ENVIRONMENT.DB = getData.database;
  },
);

test(
  "public form routes enforce browser provenance, cookie, and the streamed 16 KiB cap",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    RUNTIME_ENVIRONMENT.DB = data.database;

    const [{ GET }, { POST }] = routeModules;
    const instance = await GET(
      new Request(`${TEST_ORIGIN}/api/forms/instance?form=contact`),
    );
    assert.equal(instance.status, 200);
    assert.equal(instance.headers.get("cache-control"), "private, no-store");
    assert.equal(instance.headers.get("referrer-policy"), "same-origin");
    assert.equal(
      instance.headers.get("x-robots-tag"),
      "noindex, nofollow, noarchive",
    );
    assert.equal(instance.headers.get("vary"), "Cookie");

    const setCookie = instance.headers.get("set-cookie");
    assert.ok(setCookie);
    const cookieParts = setCookie.split(";").map((part) => part.trim());
    assert.match(
      cookieParts[0],
      new RegExp(
        `^${escapeRegex(PUBLIC_FORM_CLIENT_COOKIE)}=[A-Za-z0-9_-]{43}$`,
        "u",
      ),
    );
    assert.deepEqual(cookieParts.slice(1), [
      "Path=/",
      "Max-Age=31536000",
      "Secure",
      "HttpOnly",
      "SameSite=Lax",
    ]);
    assert.doesNotMatch(setCookie, /\bDomain=/iu);
    const anonymousCookie = cookieParts[0];

    for (const [label, headers] of [
      [
        "cross-origin Origin",
        {
          origin: "https://attacker.example",
          referer: `${TEST_ORIGIN}/contact`,
          "sec-fetch-site": "same-origin",
        },
      ],
      [
        "cross-origin Referer",
        {
          referer: "https://attacker.example/contact",
          "sec-fetch-site": "same-origin",
        },
      ],
      [
        "cross-site Sec-Fetch-Site",
        {
          "sec-fetch-site": "cross-site",
        },
      ],
      [
        "missing browser provenance",
        {},
      ],
    ]) {
      await t.test(`rejects ${label}`, async () => {
        const response = await POST(
          new Request(`${TEST_ORIGIN}/api/forms/contact`, {
            body: "{}",
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            method: "POST",
          }),
          routeContext("contact"),
        );
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), {
          error: {
            code: "authorization_denied",
            message: "This request is not permitted.",
          },
        });
      });
    }

    const token = await pastInstanceToken(data.database, "contact");
    const boundaryBody = jsonAtExactByteLength(
      {
        companyFax: "",
        instanceToken: token,
        payload: {},
      },
      16_384,
    );
    const boundaryResponse = await POST(
      streamedJsonRequest(
        "/api/forms/contact",
        [boundaryBody.slice(0, 8_192), boundaryBody.slice(8_192)],
        {
          cookie: anonymousCookie,
          origin: TEST_ORIGIN,
        },
      ).request,
      routeContext("contact"),
    );
    assert.equal(boundaryResponse.status, 422);
    const boundaryError = await boundaryResponse.json();
    assert.equal(boundaryError.error.code, "validation_failed");
    assert.equal(
      boundaryError.error.fieldErrors.name,
      "This field is required.",
    );

    const oversized = streamedJsonRequest(
      "/api/forms/contact",
      [boundaryBody.slice(0, 8_192), `${boundaryBody.slice(8_192)} `],
      {
        cookie: anonymousCookie,
        origin: TEST_ORIGIN,
      },
    );
    const oversizedResponse = await POST(
      oversized.request,
      routeContext("contact"),
    );
    assert.equal(oversizedResponse.status, 422);
    assert.deepEqual(await oversizedResponse.json(), {
      error: {
        code: "validation_failed",
        message: "The request could not be validated.",
      },
    });
    assert.match(
      source("app/api/organizer/meetup/_mutation.ts"),
      /totalBytes > maxBytes[\s\S]*await reader\.cancel\(\)/u,
    );
    assert.equal(
      await tableCount(data.database, "form_submissions"),
      0,
    );
  },
);

test(
  "public form route returns accessible field errors and normalized preserved values",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    RUNTIME_ENVIRONMENT.DB = data.database;
    const [, { POST }] = routeModules;
    const token = await pastInstanceToken(data.database, "contact");
    const response = await POST(
      jsonRequest("/api/forms/contact", {
        cookie: clientCookie("V"),
        instanceToken: token,
        payload: {
          message: " short ",
          name: "  Ada   Visitor  ",
          replyEmail: "  not-an-email  ",
          topic: "Privacy",
        },
      }),
      routeContext("contact"),
    );

    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error: {
        code: "validation_failed",
        fieldErrors: {
          message: "Use at least 10 characters.",
          replyEmail: "Enter a valid reply email.",
        },
        message: "The form could not be validated.",
      },
      values: {
        message: "short",
        name: "Ada Visitor",
        replyEmail: "not-an-email",
        topic: "Privacy",
      },
    });
    assert.equal(
      await tableCount(data.database, "form_submissions"),
      0,
    );
  },
);

test(
  "public form route emits success only after the real D1 batch commits",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    const [, { POST }] = routeModules;
    const token = await pastInstanceToken(data.database, "contact");
    const entered = deferred();
    const release = deferred();
    const delayedDatabase = databaseWrapper(data.database, {
      async batch(statements) {
        entered.resolve();
        await release.promise;
        return data.database.batch(statements);
      },
    });
    RUNTIME_ENVIRONMENT.DB = delayedDatabase;

    let settled = false;
    const pendingResponse = POST(
      jsonRequest("/api/forms/contact", {
        cookie: clientCookie("C"),
        instanceToken: token,
        payload: {
          message: "Please share the accessible entrance details.",
          name: "Committed Visitor",
          replyEmail: "committed@visitor.invalid",
          topic: "Accessibility",
        },
      }),
      routeContext("contact"),
    ).finally(() => {
      settled = true;
    });

    await entered.promise;
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(
      await tableCount(data.database, "form_submissions"),
      0,
    );

    release.resolve();
    const response = await pendingResponse;
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.publicReference, /^VCC-[A-Z0-9-]+$/u);
    assert.deepEqual(body, {
      message:
        `Thanks — your submission was stored in the private organizer inbox. Reference: ${body.publicReference}. No email confirmation was sent.`,
      publicReference: body.publicReference,
      stored: true,
    });
    const committed = await data.database
      .prepare(
        `SELECT submission.payload_json,
                workflow.public_reference,
                intent.completed_at,
                intent.completion_audit_log_id
         FROM form_submissions AS submission
         JOIN form_submission_workflows AS workflow
           ON workflow.submission_id = submission.id
          AND workflow.organization_id = submission.organization_id
         JOIN form_submission_write_intents AS intent
           ON intent.id = workflow.write_intent_id
          AND intent.submission_id = submission.id
          AND intent.organization_id = submission.organization_id
         WHERE json_extract(submission.payload_json, '$.replyEmail') = ?`,
      )
      .bind("committed@visitor.invalid")
      .first();
    assert.deepEqual(
      {
        completedAtType: typeof committed.completed_at,
        completionAuditIdType:
          typeof committed.completion_audit_log_id,
        payload: JSON.parse(committed.payload_json),
        publicReference: committed.public_reference,
      },
      {
        completedAtType: "number",
        completionAuditIdType: "string",
        payload: {
          message: "Please share the accessible entrance details.",
          name: "Committed Visitor",
          replyEmail: "committed@visitor.invalid",
          topic: "Accessibility",
        },
        publicReference: body.publicReference,
      },
    );
    RUNTIME_ENVIRONMENT.DB = data.database;
  },
);

test(
  "forced D1 batch failure rolls back every form fact and returns no success",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    const [, { POST }] = routeModules;
    const token = await pastInstanceToken(data.database, "contact");
    const before = await formFactCounts(data.database);
    RUNTIME_ENVIRONMENT.DB = databaseWrapper(data.database, {
      batch(statements) {
        return data.database.batch([
          ...statements,
          data.database.prepare(
            "INSERT INTO phase7_forced_route_failure VALUES (1)",
          ),
        ]);
      },
    });

    const response = await POST(
      jsonRequest("/api/forms/contact", {
        cookie: clientCookie("F"),
        instanceToken: token,
        payload: {
          message: "This must roll back when the final D1 statement fails.",
          name: "Failed Visitor",
          replyEmail: "failed@visitor.invalid",
          topic: "General",
        },
      }),
      routeContext("contact"),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.deepEqual(body, {
      error: {
        code: "service_unavailable",
        message: "The submission could not be stored. Please try again.",
      },
    });
    assert.equal(Object.hasOwn(body, "message"), false);
    assert.equal(Object.hasOwn(body, "publicReference"), false);
    assert.equal(Object.hasOwn(body, "stored"), false);
    assert.deepEqual(await formFactCounts(data.database), before);
    RUNTIME_ENVIRONMENT.DB = data.database;
  },
);

test(
  "public form UI render and source contracts stay unique, focused, exact, and single-main",
  routeTestOptions,
  async (t) => {
    const data = await fixture();
    t.after(() => data.database.close());
    RUNTIME_ENVIRONMENT.DB = data.database;
    const [
      ,
      ,
      { PublicSubmissionForm },
      { PublicFormPrivacyNotice },
      { EditorialPage },
      {
        ContactRouteBody,
        GetInvolvedRouteBody,
        HostAnEventRouteBody,
      },
      {
        PUBLIC_FORM_PURPOSE_COPY,
        PUBLIC_FORM_SUCCESS_COPY,
      },
    ] = routeModules;

    const sharedFormsHtml = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(PublicSubmissionForm, {
          formKey: "volunteer",
          id: "volunteer",
        }),
        React.createElement(PublicSubmissionForm, {
          formKey: "partnership",
          id: "partner",
        }),
      ),
    );
    const ids = [
      ...sharedFormsHtml.matchAll(/\bid="([^"]+)"/gu),
    ].map((match) => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    assert.ok(ids.some((id) => id.startsWith("volunteer-")));
    assert.ok(ids.some((id) => id.startsWith("partnership-")));
    for (const reference of attributeTokens(
      sharedFormsHtml,
      /(?:aria-describedby|aria-labelledby|for)="([^"]+)"/gu,
    )) {
      assert.ok(ids.includes(reference), `unresolved form id ${reference}`);
    }
    assert.equal(
      countMatches(sharedFormsHtml, /Send this to the organizers/gu),
      2,
    );
    assert.match(sharedFormsHtml, /data-form-key="volunteer"/u);
    assert.match(sharedFormsHtml, /data-form-key="partnership"/u);
    assert.equal(
      countMatches(
        sharedFormsHtml,
        new RegExp(escapeRegex(PUBLIC_FORM_PURPOSE_COPY), "gu"),
      ),
      2,
    );

    assert.equal(
      PUBLIC_FORM_PURPOSE_COPY,
      "We collect your name, reply email, and the details you choose to send so authorized Vancouver Curiosity Club organizers can review and respond to this request. Submitting stores the message in the private organizer inbox. It does not enroll you in marketing or send an email confirmation.",
    );
    assert.equal(
      PUBLIC_FORM_SUCCESS_COPY,
      "Thanks — your submission was stored in the private organizer inbox.",
    );
    assert.doesNotMatch(
      sharedFormsHtml,
      /email (?:was|has been) sent|we (?:sent|emailed)|check your email/iu,
    );

    const privacyHtml = renderToStaticMarkup(
      React.createElement(PublicFormPrivacyNotice),
    );
    const privacyText = visibleText(privacyHtml);
    for (const exactEnumeration of [
      "Contact collects a name, reply email, topic, and message.",
      "Volunteer collects a name, reply email, one to five interest areas, how the visitor would like to help, and optional availability or relevant context.",
      "Host an Event collects a name, reply email, proposed event title or topic, short event idea, format, and optional preferred club or program and timing.",
      "Venue or Community Partnership collects a contact name, reply email, organization or venue name, partnership type, message, and an optional HTTPS website.",
    ]) {
      assert.ok(
        privacyText.includes(exactEnumeration),
        `missing exact privacy enumeration: ${exactEnumeration}`,
      );
    }
    assert.match(
      privacyText,
      /stored in the private organizer inbox\./u,
    );
    assert.match(
      privacyText,
      /the site sends no form-confirmation email\./u,
    );
    assert.match(
      privacyText,
      /one random anonymous browser cookie for one year/u,
    );
    assert.match(
      privacyText,
      /IP-address, browser user-agent, and accepted-language facts into private keyed rate-limit hashes/u,
    );
    assert.match(
      privacyText,
      /raw network and browser facts are not stored/u,
    );

    const page = (slug, title) => ({
      metaDescription: null,
      openGraphAssetId: null,
      sections: [],
      seoTitle: null,
      slug,
      title,
    });
    const routeRenders = [
      [
        "Contact",
        React.createElement(
          ContactRouteBody,
          {
            destinations: null,
            page: page("contact", "Contact"),
            privatePreview: true,
          },
          React.createElement(PublicSubmissionForm, { formKey: "contact" }),
        ),
      ],
      [
        "Get Involved",
        React.createElement(
          GetInvolvedRouteBody,
          {
            destinations: null,
            page: page("get-involved", "Get Involved"),
            privatePreview: true,
          },
          React.createElement(PublicSubmissionForm, {
            formKey: "volunteer",
          }),
          React.createElement(PublicSubmissionForm, {
            formKey: "partnership",
          }),
        ),
      ],
      [
        "Host an Event",
        React.createElement(
          HostAnEventRouteBody,
          {
            destinations: null,
            page: page("host-an-event", "Host an Event"),
            privatePreview: true,
          },
          React.createElement(PublicSubmissionForm, {
            choices: [],
            formKey: "host_event",
          }),
        ),
      ],
      [
        "Privacy",
        React.createElement(
          EditorialPage,
          {
            page: page("privacy", "Privacy"),
            privatePreview: true,
            tone: "think",
          },
          React.createElement(PublicFormPrivacyNotice),
        ),
      ],
    ];
    let getInvolvedHtml = "";
    for (const [label, element] of routeRenders) {
      const html = await render(element);
      if (label === "Get Involved") getInvolvedHtml = html;
      assert.equal(
        countMatches(html, /<main\b/gu),
        1,
        `${label} must render exactly one main`,
      );
      assert.match(
        html,
        /<main\b[^>]*class="editorial-page"/u,
        `${label} must use the canonical editorial main`,
      );
    }
    assert.match(getInvolvedHtml, /href="#volunteer"/u);
    assert.match(getInvolvedHtml, />Volunteer</u);
    assert.match(getInvolvedHtml, /href="\/host-an-event"/u);
    assert.match(getInvolvedHtml, />Host an event</u);
    assert.match(getInvolvedHtml, /href="#partner"/u);
    assert.match(getInvolvedHtml, />Offer a venue or partnership</u);
    assert.doesNotMatch(
      getInvolvedHtml,
      /community-destinations|confirmed group|Choose a community destination/iu,
    );

    const formSource = source("app/_components/PublicSubmissionForm.tsx");
    assert.match(
      formSource,
      /const reactInstanceId = useId\(\)\.replaceAll\(":", ""\);[\s\S]*const idPrefix = `\$\{formKey\}-\$\{reactInstanceId\}`;/u,
    );
    assert.match(
      formSource,
      /useEffect\(\(\) => \{\s*if \(!success\) return;\s*successRef\.current\?\.focus\(\);\s*\}, \[success\]\);/u,
    );
    assert.match(
      formSource,
      /ref=\{successRef\}[\s\S]*role="status"[\s\S]*tabIndex=\{-1\}/u,
    );
    assert.ok(
      countMatches(
        formSource,
        /(?:"aria-describedby":\s*error|aria-describedby=\{error)/gu,
      ) >= 3,
    );
    assert.ok(
      countMatches(
        formSource,
        /(?:"aria-invalid":\s*error|aria-invalid=\{error)/gu,
      ) >= 3,
    );
    assert.match(
      formSource,
      /ref=\{errorSummaryRef\}[\s\S]*role="alert"[\s\S]*tabIndex=\{-1\}/u,
    );
    assert.match(
      formSource,
      /requestAnimationFrame\(\(\) => errorSummaryRef\.current\?\.focus\(\)\)/u,
    );
    assert.match(formSource, /href=\{`#\$\{errorTargetId/u);
    assert.match(formSource, /<Link href="\/privacy">Privacy notice<\/Link>/u);
    assert.match(formSource, /data-form-key=\{formKey\}/u);
    assert.match(formSource, /Send this to the organizers/u);
    for (const label of [
      "Send message",
      "Send volunteer interest",
      "Send event idea",
      "Send partnership idea",
    ]) {
      assert.match(formSource, new RegExp(escapeRegex(label), "u"));
    }
    assert.doesNotMatch(formSource, /Store in private inbox/u);
    assert.doesNotMatch(formSource, /"Preparing form\.\.\."/u);
    assert.doesNotMatch(formSource, /Preparing secure form/u);
    assert.match(
      formSource,
      /instanceState === "loading"[\s\S]*aria-busy="true"[\s\S]*className="public-submission__loading"[\s\S]*className="sr-only"[\s\S]*role="status"/u,
    );
    assert.match(
      formSource,
      /aria-hidden="true"[\s\S]*className="public-submission__skeleton"/u,
    );
    assert.match(formSource, /Try loading the form again/u);
    assert.match(formSource, /FORM_INSTANCE_TIMEOUT_MS = 10_000/u);
    assert.equal(
      countMatches(
        sharedFormsHtml,
        /class="public-submission__loading"/gu,
      ),
      2,
    );
    assert.equal(countMatches(sharedFormsHtml, /aria-busy="true"/gu), 2);
    assert.doesNotMatch(sharedFormsHtml, /<form\b|\bdisabled=""/u);
    assert.doesNotMatch(
      formSource,
      /role=\{notice[\s\S]*aria-live="polite"/u,
    );
    assert.doesNotMatch(formSource, /role="alert"[\s\S]*aria-live="polite"/u);
    assert.match(formSource, /payload:\s*values/u);
    assert.equal(countMatches(formSource, /\bsetValues\(/gu), 1);

    const relevantSource = [
      formSource,
      source("app/api/forms/[formKey]/route.ts"),
      source("app/_components/PublicFormPrivacyNotice.tsx"),
      source("app/contact/page.tsx"),
      source("app/get-involved/page.tsx"),
      source("app/host-an-event/page.tsx"),
      source("app/privacy/page.tsx"),
    ].join("\n");
    assert.doesNotMatch(
      `${relevantSource}\n${sharedFormsHtml}\n${privacyHtml}`,
      /Stored securely/iu,
    );
    assert.doesNotMatch(
      `${relevantSource}\n${sharedFormsHtml}\n${privacyHtml}`,
      /email (?:was|has been) sent|we (?:sent|emailed)|check your email/iu,
    );

    for (const [path, wrapper] of [
      ["app/contact/page.tsx", "ContactRouteBody"],
      ["app/get-involved/page.tsx", "GetInvolvedRouteBody"],
      ["app/host-an-event/page.tsx", "HostAnEventRouteBody"],
      ["app/privacy/page.tsx", "EditorialPage"],
    ]) {
      const pageSource = source(path);
      assert.match(pageSource, new RegExp(`<${wrapper}\\b`, "u"));
      assert.doesNotMatch(pageSource, /<main\b/u);
      if (path !== "app/privacy/page.tsx") {
        assert.doesNotMatch(
          pageSource,
          /CommunityDestinations|loadCommunityDestinations|hasCommunityLinksBlock/u,
        );
      }
    }

    const routeBodiesSource = source(
      "app/_components/EditorialRouteBodies.tsx",
    );
    assert.doesNotMatch(
      routeBodiesSource,
      /<CommunityDestinations|<CommunityDestinationsUnavailable|<Destinations/u,
    );
  },
);

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}

function migrations() {
  const directory = join(PROJECT_ROOT, "drizzle");
  return readdirSync(directory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
}

async function fixture() {
  const database = new SqliteD1TestDatabase(migrations());
  const now = Date.now();
  assert.equal(
    await bootstrapInitialOwner(
      database,
      FORM_OWNER_IDENTITY,
      OWNER_EMAIL,
      now,
    ),
    true,
  );
  database.exec(PHASE7_INVARIANT_TRIGGER_STATEMENTS.join("\n"));
  return { database, now };
}

async function pastInstanceToken(database, formKey) {
  RUNTIME_ENVIRONMENT.DB = database;
  const [{ GET }] = routeModules;
  const response = await GET(
    new Request(
      `${TEST_ORIGIN}/api/forms/instance?form=${encodeURIComponent(formKey)}`,
    ),
  );
  assert.equal(response.status, 200);
  const organizationId = await database
    .prepare(
      `SELECT id
       FROM organizations
       WHERE slug = 'vancouver-curiosity-and-education-society'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .first("id");
  const keyHex = await database
    .prepare(
      `SELECT key_hex
       FROM public_form_protection_keys
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first("key_hex");
  const created = await createPublicFormInstanceToken(
    keyHex,
    formKey,
    Date.now() - 4_000,
  );
  return created.token;
}

async function pastNativeFormCredentials(database, formKey) {
  RUNTIME_ENVIRONMENT.DB = database;
  const [{ GET }] = routeModules;
  const response = await GET(
    new Request(
      `${TEST_ORIGIN}/api/forms/instance?form=${encodeURIComponent(formKey)}`,
    ),
  );
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, `${formKey} must receive a real anonymous cookie`);
  const cookie = setCookie.split(";", 1)[0];
  assert.match(
    cookie,
    new RegExp(
      `^${escapeRegex(PUBLIC_FORM_CLIENT_COOKIE)}=[A-Za-z0-9_-]{43}$`,
      "u",
    ),
  );
  const organizationId = await database
    .prepare(
      `SELECT id
       FROM organizations
       WHERE slug = 'vancouver-curiosity-and-education-society'
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .first("id");
  const keyHex = await database
    .prepare(
      `SELECT key_hex
       FROM public_form_protection_keys
       WHERE organization_id = ?
       LIMIT 1`,
    )
    .bind(organizationId)
    .first("key_hex");
  const created = await createPublicFormInstanceToken(
    keyHex,
    formKey,
    Date.now() - 4_000,
  );
  assert.ok(
    Date.now() - created.instance.issuedAt >= 3_000,
    `${formKey} token must clear the three-second anti-spam window`,
  );
  return Object.freeze({ cookie, instanceToken: created.token });
}

function routeContext(formKey) {
  return { params: Promise.resolve({ formKey }) };
}

function jsonRequest(path, { cookie, instanceToken, payload }) {
  return new Request(`${TEST_ORIGIN}${path}`, {
    body: JSON.stringify({
      companyFax: "",
      instanceToken,
      payload,
    }),
    headers: {
      "content-type": "application/json",
      cookie,
      origin: TEST_ORIGIN,
    },
    method: "POST",
  });
}

function nativeFormRequest(path, { cookie, fields }) {
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    body: fields.toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
      origin: TEST_ORIGIN,
    },
    method: "POST",
  });
  assert.equal(new URL(request.url).search, "");
  return request;
}

function streamedJsonRequest(path, chunks, headers) {
  let index = 0;
  let wasCancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    cancel() {
      wasCancelled = true;
    },
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  return {
    cancelled: () => wasCancelled,
    request: new Request(`${TEST_ORIGIN}${path}`, {
      body: stream,
      duplex: "half",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      method: "POST",
    }),
  };
}

function jsonAtExactByteLength(value, targetBytes) {
  const json = JSON.stringify(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  assert.ok(byteLength <= targetBytes);
  return `${json}${" ".repeat(targetBytes - byteLength)}`;
}

function clientCookie(character) {
  return `${PUBLIC_FORM_CLIENT_COOKIE}=${character.repeat(43)}`;
}

function databaseWrapper(database, overrides) {
  return {
    batch: overrides.batch ?? ((statements) => database.batch(statements)),
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql),
  };
}

function statementCountingDatabase(database) {
  let count = 0;
  const statementInner = new WeakMap();
  const wrapStatement = (statement) => {
    const wrapped = {
      bind(...values) {
        return wrapStatement(statement.bind(...values));
      },
      all(...args) {
        count += 1;
        return statement.all(...args);
      },
      first(...args) {
        count += 1;
        return statement.first(...args);
      },
      run(...args) {
        count += 1;
        return statement.run(...args);
      },
    };
    statementInner.set(wrapped, statement);
    return wrapped;
  };
  return {
    database: {
      async batch(statements) {
        count += statements.length;
        return database.batch(
          statements.map((statement) => statementInner.get(statement)),
        );
      },
      exec(sql) {
        throw new Error(
          `The counted public-form route must not execute raw SQL: ${sql}`,
        );
      },
      prepare(sql) {
        return wrapStatement(database.prepare(sql));
      },
    },
    get count() {
      return count;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function tableCount(database, table) {
  return database.prepare(`SELECT count(*) FROM ${table}`).first("count(*)");
}

async function formFactCounts(database) {
  const tables = [
    "form_submissions",
    "form_submission_workflows",
    "form_submission_write_intents",
    "public_form_rate_windows",
    "notifications",
    "audit_logs",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [table, await tableCount(database, table)]),
    ),
  );
}

async function render(element) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function attributeTokens(html, pattern) {
  return [...html.matchAll(pattern)].flatMap((match) =>
    match[1].split(/\s+/u).filter(Boolean),
  );
}

function visibleText(html) {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/gu, " ")
    .trim();
}

async function assertPrivateNativeHtml(response, { title }) {
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html(?:;|$)/iu,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("location"), null);
  const html = await response.text();
  assert.match(html, /^<!doctype html>/iu);
  assert.match(
    html,
    new RegExp(`<h1>${escapeRegex(title)}</h1>`, "u"),
  );
  return html;
}

function source(path) {
  return readFileSync(join(PROJECT_ROOT, path), "utf8");
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
