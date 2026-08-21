import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import test from "node:test";
import { createElement } from "react";
import {
  renderToReadableStream,
  renderToStaticMarkup,
} from "react-dom/server";
import { PublicSubmissionForm } from "../../app/_components/PublicSubmissionForm.tsx";
import { PUBLIC_CATALOG_PAGES } from "../../lib/server/public/catalog-definitions.ts";

const projectRoot = new URL("../../", import.meta.url);
const directImportsSupported = typeof nodeModule.registerHooks === "function";
if (directImportsSupported) {
  const cloudflareWorkersShim = dataModule("export const env = {};");
  const serverOnlyShim = dataModule("export {};");
  nodeModule.registerHooks({
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
const routeBodies = directImportsSupported
  ? await import(
      "../../app/_components/EditorialRouteBodies.tsx?form-usability-test"
    )
  : null;
const directImportOptions = directImportsSupported
  ? {}
  : { skip: "Route rendering requires node:module registerHooks." };

const formCases = Object.freeze([
  Object.freeze({
    formKey: "contact",
    primaryField: "message",
    submitLabel: "Send message",
  }),
  Object.freeze({
    formKey: "volunteer",
    primaryField: "howToHelp",
    submitLabel: "Send volunteer interest",
  }),
  Object.freeze({
    formKey: "host_event",
    primaryField: "eventIdea",
    submitLabel: "Send event idea",
  }),
  Object.freeze({
    formKey: "partnership",
    primaryField: "organizationOrVenueName",
    submitLabel: "Send partnership or support inquiry",
  }),
]);

test("each form page uses one quiet privacy sentence and one truthful process sentence", directImportOptions, async () => {
  for (const [pageLabel, markup] of await formPageMarkups()) {
    assert.equal(
      classCount(markup, "public-submission__privacy"),
      1,
      `${pageLabel} must present privacy guidance once per page`,
    );
    const privacyMarkup = elementWithClass(
      markup,
      "public-submission__privacy",
    );
    assert.ok(privacyMarkup, `${pageLabel} privacy sentence`);
    assert.match(privacyMarkup, /href="\/privacy"/u);
    const privacyText = visibleText(privacyMarkup);
    assert.equal(
      sentenceCount(privacyText),
      1,
      `${pageLabel} privacy copy must stay to one sentence`,
    );
    assert.match(privacyText, /privacy|privately/iu);
    assert.doesNotMatch(
      privacyText,
      /private organizer inbox|marketing|email confirmation/iu,
      `${pageLabel} must not repeat the long defensive disclaimer`,
    );

    assert.equal(
      classCount(markup, "public-submission__process"),
      1,
      `${pageLabel} must present the process once per page`,
    );
    const processMarkup = elementWithClass(
      markup,
      "public-submission__process",
    );
    assert.ok(processMarkup, `${pageLabel} response process sentence`);
    const processText = visibleText(processMarkup);
    assert.equal(
      sentenceCount(processText),
      1,
      `${pageLabel} response process must stay concise`,
    );
    assert.match(processText, /organizers?/iu);
    assert.match(processText, /review/iu);
    assert.match(processText, /reply email/iu);
    assert.match(processText, /follow up|reply/iu);
    assert.match(
      processText,
      /timing (?:can |may )?varies|no fixed response time/iu,
      `${pageLabel} must state the honest no-SLA boundary`,
    );
    assertNoGuaranteedResponse(processText, pageLabel);
  }
});

test("public form-page introductions leave detailed privacy terms to the privacy notice", () => {
  for (const slug of ["contact", "get-involved", "host-an-event"]) {
    const page = PUBLIC_CATALOG_PAGES.find((candidate) =>
      candidate.slug === slug
    );
    assert.ok(page, `${slug} catalog page`);
    const copy = page.sections
      .map((section) => JSON.stringify(section.content))
      .join("\n");
    assert.doesNotMatch(
      copy,
      /private organizer inbox|marketing|email confirmation/iu,
      `${slug} must not repeat the detailed form privacy disclaimer`,
    );
    assertNoGuaranteedResponse(copy, slug);
  }
});

test("all fields are editable immediately while only secure submission prepares", () => {
  for (const { formKey, primaryField, submitLabel } of formCases) {
    const markup = renderToStaticMarkup(
      createElement(PublicSubmissionForm, { formKey }),
    );
    const form = /<form\b[\s\S]*?<\/form>/iu.exec(markup)?.[0];
    assert.ok(form, `${formKey} form must exist in initial HTML`);
    assert.match(
      form,
      new RegExp(
        `^<form(?=[^>]*\\baction="/api/forms/${formKey}")(?=[^>]*\\bmethod="post")[^>]*>`,
        "u",
      ),
    );
    assert.match(form, /<input(?=[^>]*\bname="instanceToken")(?=[^>]*\btype="hidden")[^>]*>/u);
    assert.match(
      form,
      /<input(?=[^>]*\bautocomplete="name")(?=[^>]*\bname="name")[^>]*>/iu,
      `${formKey} must expose the standard name autofill purpose`,
    );
    assert.match(form, /\bname="replyEmail"/u);
    assert.match(
      form,
      new RegExp(`\\bname="${primaryField}"`, "u"),
    );

    for (const control of openingTags(form, ["input", "select", "textarea"])) {
      assert.doesNotMatch(
        control,
        /\bdisabled(?:="")?/u,
        `${formKey} fields must remain editable while protection loads`,
      );
    }
    const submit = openingTags(form, ["button"]).find((tag) =>
      /\btype="submit"/u.test(tag)
    );
    assert.ok(submit, `${formKey} submit button`);
    assert.doesNotMatch(
      submit,
      /\bdisabled(?:="")?/u,
      `${formKey} submit must be immediately usable while its token loads`,
    );
    assert.ok(
      visibleText(form).includes(submitLabel),
      `${formKey} primary action label`,
    );
    assert.doesNotMatch(
      form,
      /role="status"[\s\S]*?prepar(?:e|ing)[\s\S]*?(?:secure|send)|prepar(?:e|ing)[\s\S]*?(?:secure|send)[\s\S]*?role="status"/iu,
      `${formKey} must not sit in a Preparing send state`,
    );
    assert.doesNotMatch(form, /public-submission__skeleton/iu);
    const honeypot = /<div(?=[^>]*\bclass="public-submission__honeypot")(?=[^>]*\baria-hidden="true")[^>]*>[\s\S]*?<\/div>/u.exec(
      form,
    )?.[0];
    assert.ok(honeypot, `${formKey} honeypot must be absent from the accessibility tree`);
    assert.match(
      honeypot,
      /<input(?=[^>]*\bautocomplete="off")(?=[^>]*\bname="companyFax")(?=[^>]*\btabindex="-1")[^>]*>/iu,
      `${formKey} honeypot must also stay out of keyboard order`,
    );
    assert.match(
      markup,
      /<noscript>[\s\S]*Your information has not been sent\.[\s\S]*Please enable[\s\S]*JavaScript and reload this page\.[\s\S]*<\/noscript>/u,
      `${formKey} must retain the explicit no-script safety notice`,
    );
  }
});

test("secure-send preparation reports slowness within one second without weakening transport", async () => {
  const [formSource, instanceRoute, postRoute, protection, submissionService] =
    await Promise.all([
      source("app/_components/PublicSubmissionForm.tsx"),
      source("app/api/forms/instance/route.ts"),
      source("app/api/forms/[formKey]/route.ts"),
      source("lib/server/phase7/public-form-protection.ts"),
      source("lib/server/phase7/public-forms.ts"),
    ]);
  const slowLiteral = /FORM_INSTANCE_SLOW_MS\s*=\s*([\d_]+)/u.exec(
    formSource,
  )?.[1];
  assert.ok(slowLiteral, "the client must have a slow-status threshold");
  const slowMs = Number(slowLiteral.replaceAll("_", ""));
  assert.ok(slowMs > 0 && slowMs <= 1_000, `${slowMs}ms slow status`);
  const abortLiteral = /FORM_INSTANCE_TIMEOUT_MS\s*=\s*([\d_]+)/u.exec(
    formSource,
  )?.[1];
  assert.ok(abortLiteral, "the network request must remain bounded");
  const abortMs = Number(abortLiteral.replaceAll("_", ""));
  assert.ok(
    abortMs > slowMs && abortMs <= 10_000,
    `${abortMs}ms abort must allow a cold response after the slow status`,
  );

  assert.match(formSource, /new AbortController\(\)/u);
  assert.match(formSource, /controller\.abort\(\)/u);
  assert.match(formSource, /cache:\s*"no-store"/u);
  assert.match(formSource, /credentials:\s*"same-origin"/u);
  assert.match(formSource, /instanceState === "error"/u);
  assert.match(formSource, /onClick=\{retryInstance\}/u);
  assert.match(formSource, /<button[\s\S]*?type="button"[\s\S]*?Try[^<]*again/iu);
  assert.doesNotMatch(
    formSource,
    /(?:within|in) (?:one|1) second/iu,
    "one second is a failure threshold, not a network-completion promise",
  );

  assert.match(
    formSource,
    /PUBLIC_FORM_MINIMUM_COMPLETION_MS/u,
    "the client send gate must use the shared anti-abuse interval",
  );
  assert.match(formSource, /await waitForMinimumFormCompletion/u);
  assert.match(
    formSource,
    /PUBLIC_FORM_MINIMUM_COMPLETION_MS\s*-\s*\(Date\.now\(\)\s*-\s*instanceReceivedAtUtcMs\)/u,
    "an immediate click must wait only for the remaining server anti-abuse interval",
  );
  assert.doesNotMatch(formSource, /Preparing send/u);
  assert.match(protection, /PUBLIC_FORM_MINIMUM_COMPLETION_MS\s*=\s*3_000/u);
  assert.match(
    submissionService,
    /input\.nowUtcMs - input\.formInstance\.issuedAt\s*<\s*PUBLIC_FORM_MINIMUM_COMPLETION_MS/u,
    "the server must retain its authoritative minimum token-age check",
  );

  assert.match(instanceRoute, /Cache-Control", "private, no-store"/u);
  assert.match(instanceRoute, /Set-Cookie/u);
  assert.match(protection, /Secure; HttpOnly; SameSite=Lax/u);
  assert.match(postRoute, /requirePublicFormSameOrigin\(request\)/u);
  assert.match(postRoute, /PUBLIC_FORM_CLIENT_COOKIE/u);
  assert.match(postRoute, /verifyPublicFormInstanceToken/u);
  assert.match(postRoute, /application\/x-www-form-urlencoded/u);
  assert.match(postRoute, /readBoundedNativeForm\(request, formKey, 16_384\)/u);
  assert.match(
    formSource,
    /if \(busy \|\| instanceState === "error"\) return;/u,
  );
  assert.match(formSource, /await instanceGateRef\.current\?\.promise/u);
  assert.match(formSource, /role="alert"/u);
  assert.match(formSource, /errorSummaryRef\.current\?\.focus\(\)/u);
  assert.match(formSource, /successRef\.current\?\.focus\(\)/u);
});

function assertNoGuaranteedResponse(copy, label) {
  assert.doesNotMatch(
    copy,
    /(?:guarantee|promise)(?:d)?\s+(?:a\s+)?(?:reply|response)|(?:reply|respond|response)[^.!?]{0,30}\b(?:within|in)\s+(?:\d+|one|two|three)\s+(?:business\s+)?(?:hours?|days?)|\b(?:will|always)\s+(?:reply|respond)\b/iu,
    `${label} must not invent a guaranteed response time`,
  );
}

function elementWithClass(markup, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `<([a-z][a-z0-9]*)\\b(?=[^>]*\\bclass="[^"]*\\b${escaped}\\b[^"]*")[^>]*>[\\s\\S]*?<\\/\\1>`,
    "iu",
  ).exec(markup)?.[0];
}

function classCount(markup, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...markup.matchAll(
    new RegExp(`\\bclass="[^"]*\\b${escaped}\\b[^"]*"`, "gu"),
  )].length;
}

async function formPageMarkups() {
  assert.ok(routeBodies);
  const {
    ContactRouteBody,
    GetInvolvedRouteBody,
    HostAnEventRouteBody,
  } = routeBodies;
  const page = (slug, title) => Object.freeze({
    metaDescription: null,
    openGraphAssetId: null,
    sections: Object.freeze([]),
    seoTitle: null,
    slug,
    title,
  });
  return Object.freeze(await Promise.all([
    Object.freeze([
      "Contact",
      render(
        createElement(
          ContactRouteBody,
          { page: page("contact", "Contact"), privatePreview: true },
          createElement(PublicSubmissionForm, { formKey: "contact" }),
        ),
      ),
    ]),
    Object.freeze([
      "Host an Event",
      render(
        createElement(
          HostAnEventRouteBody,
          {
            page: page("host-an-event", "Host an Event"),
            privatePreview: true,
          },
          createElement(PublicSubmissionForm, { formKey: "host_event" }),
        ),
      ),
    ]),
    Object.freeze([
      "Get Involved",
      render(
        createElement(
          GetInvolvedRouteBody,
          {
            page: page("get-involved", "Get Involved"),
            privatePreview: true,
          },
          createElement(PublicSubmissionForm, {
            formKey: "volunteer",
            id: "volunteer",
          }),
          createElement(PublicSubmissionForm, {
            formKey: "partnership",
            id: "partner",
          }),
        ),
      ),
    ]),
  ].map(async ([label, markup]) => Object.freeze([label, await markup]))));
}

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}

function openingTags(markup, names) {
  const alternatives = names.join("|");
  return [...markup.matchAll(new RegExp(`<(?:${alternatives})\\b[^>]*>`, "giu"))]
    .map((match) => match[0]);
}

function sentenceCount(copy) {
  return copy.match(/[.!?](?=\s|$)/gu)?.length ?? 0;
}

function visibleText(markup) {
  return markup
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&nbsp;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}

async function render(element) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
