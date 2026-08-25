import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicSubmissionForm } from "../../app/_components/PublicSubmissionForm.tsx";
import { SiteFooter } from "../../app/_components/SiteFooter.tsx";
import { normalizedPrimaryNavigation } from "../../app/_components/SiteHeader.tsx";
import { publicFormLabel } from "../../lib/server/phase7/public-form-contract.ts";

const projectRoot = new URL("../../", import.meta.url);

test("the primary header is exactly the five approved public destinations", () => {
  assert.deepEqual(
    normalizedPrimaryNavigation(
      Object.freeze([
        Object.freeze({ href: "/calendar", label: "Calendar" }),
        Object.freeze({ href: "/contact", label: "Feedback" }),
        Object.freeze({ href: "https://example.com", label: "External" }),
      ]),
    ),
    [
      { href: "/events", label: "Events" },
      { href: "/clubs", label: "Clubs" },
      { href: "/about", label: "About" },
      { href: "/for-organizations", label: "For Organizations" },
      { href: "/contact", label: "Contact" },
    ],
  );
});

test("For Organizations is emphasized without becoming an application button", async () => {
  const [header, styles] = await Promise.all([
    source("app/_components/SiteHeader.tsx"),
    source("app/styles/layout.css"),
  ]);

  assert.match(
    header,
    /item\.href === "\/for-organizations"[\s\S]*?primary-nav__link--organizations/u,
  );
  assert.match(styles, /\.primary-nav__link--organizations/u);
  assert.doesNotMatch(
    styles,
    /\.primary-nav__link--organizations\s*\{[^}]*(?:border-radius|box-shadow|background:)/su,
  );
});

test("Contact safely switches between general and partnership inquiry contracts", async () => {
  const [contactSource, routeBodies] = await Promise.all([
    source("app/contact/page.tsx"),
    source("app/_components/EditorialRouteBodies.tsx"),
  ]);
  const contactMarkup = renderToStaticMarkup(
    createElement(PublicSubmissionForm, {
      formKey: "contact",
      id: "contact-form",
    }),
  );
  const partnershipMarkup = renderToStaticMarkup(
    createElement(PublicSubmissionForm, {
      formKey: "contact",
      id: "contact-form",
      initialContactTopic: "Partnerships",
      initialInstanceToken: "signed-page-token",
    }),
  );

  assert.equal(publicFormLabel("contact"), "Contact");
  assert.match(contactMarkup, /data-form-key="contact"/u);
  assert.match(contactMarkup, /<h2[^>]*>Contact<\/h2>/u);
  assert.match(contactMarkup, />Send message<\/button>/u);
  assert.match(partnershipMarkup, /data-form-key="contact"/u);
  assert.match(partnershipMarkup, /data-partnership-selected="true"/u);
  assert.match(partnershipMarkup, /<h2[^>]*>Partnership inquiry<\/h2>/u);
  assert.match(
    partnershipMarkup,
    /<option value="Partnerships" selected="">Partnerships<\/option>/u,
  );
  assert.match(
    partnershipMarkup,
    />Organization \(optional\)<[\s\S]*\bname="organization"[\s\S]*>Role \(optional\)<[\s\S]*\bname="role"[\s\S]*\bname="collaborationInterest"/u,
  );
  assert.match(
    partnershipMarkup,
    /<input(?=[^>]*\bname="organization")(?![^>]*\brequired)[^>]*>/u,
  );
  assert.match(
    partnershipMarkup,
    /<input(?=[^>]*\bname="role")(?![^>]*\brequired)[^>]*>/u,
  );
  assert.match(
    partnershipMarkup,
    /<select(?=[^>]*\bname="collaborationInterest")(?=[^>]*\brequired)[^>]*>/u,
  );
  for (const option of [
    "Program funding or sponsorship",
    "Venue or space",
    "Co-presented program",
    "Educational or cultural collaboration",
    "Community outreach",
    "In-kind support",
    "General partnership question",
  ]) {
    assert.match(partnershipMarkup, new RegExp(`>${option}<`, "u"));
  }
  assert.match(
    partnershipMarkup,
    /data-native-ready="true"[\s\S]*<input(?=[^>]*\bname="instanceToken")(?=[^>]*\btype="hidden")(?=[^>]*\bvalue="signed-page-token")[^>]*>/u,
  );
  assert.match(partnershipMarkup, />Send inquiry<\/button>/u);
  assert.match(contactSource, /const partnershipMode = params\.topic === "partnerships"/u);
  assert.match(
    contactSource,
    /formKey="contact"/u,
  );
  assert.match(contactSource, /preparePublicFormInstance\("contact"\)/u);
  assert.match(contactSource, /readPublicFormProtectionKey/u);
  assert.match(
    contactSource,
    /readPublicFormProtectionKey[\s\S]*?ensureDatabaseInvariants[\s\S]*?invariantStatus !== "ready"[\s\S]*?ensurePublicFormProtectionKey/u,
  );
  assert.match(
    contactSource,
    /initialContactTopic=\{partnershipMode \? "Partnerships" : undefined\}/u,
  );
  assert.match(contactSource, /id="contact-form"/u);
  assert.doesNotMatch(
    contactSource,
    /params\.(?:name|replyEmail|email|message|organization)/u,
    "URL parameters must never prefill personal form fields",
  );
  const contactBody = routeBodies.slice(
    routeBodies.indexOf("export function ContactRouteBody"),
    routeBodies.indexOf("export function HostAnEventRouteBody"),
  );
  const getInvolvedBody = routeBodies.slice(
    routeBodies.indexOf("export function GetInvolvedRouteBody"),
    routeBodies.indexOf("export function ContactRouteBody"),
  );
  assert.match(
    contactBody,
    /partnershipMode \? "Start a conversation with our team\." : "Contact"/u,
  );
  assert.match(
    contactBody,
    /displayEyebrow=\{partnershipMode \? "Partnership inquiry" : "Contact"\}/u,
  );
  assert.match(
    contactBody,
    /Tell us about your organization, what you are working on, and the kind of collaboration you have in mind\./u,
  );
  assert.match(
    getInvolvedBody,
    /href="\/contact\?topic=partnerships#contact-form"/u,
  );
  assert.doesNotMatch(getInvolvedBody, /displayTitle="Contact"/u);
});

test("the footer contains the approved institutional groups and keeps organizer access footer-only", async () => {
  const header = await source("app/_components/SiteHeader.tsx");
  const markup = renderToStaticMarkup(
    createElement(SiteFooter, {
      brandName: "Vancouver Curiosity Club",
      legalName: "Verified Legal Name",
      mission:
        "Thoughtful public programs across learning, culture, creativity, and shared experience.",
      navigation: Object.freeze([
        Object.freeze({ href: "/contact", label: "Feedback" }),
      ]),
    }),
  );

  for (const label of ["Explore", "Participate", "Community information"]) {
    assert.match(markup, new RegExp(`>${label}<`, "u"));
  }
  for (const [href, label] of [
    ["/events", "Events"],
    ["/clubs", "Clubs"],
    ["/about", "About"],
    ["/for-organizations", "For Organizations"],
    ["/get-involved", "Get Involved"],
    ["/host-an-event", "Host an Event"],
    ["/contact", "Contact"],
    ["/conduct", "Code of Conduct"],
    ["/privacy", "Privacy"],
    ["/organizer", "Organizer Login"],
  ]) {
    assert.match(markup, new RegExp(`href="${href}"[^>]*>${label}<`, "u"));
  }
  assert.doesNotMatch(markup, /href="\/accessibility"/u);
  assert.match(markup, /Legal name: Verified Legal Name/u);
  const requiredHeaderNavigation = header.match(
    /const requiredNavigation\s*=\s*\[([\s\S]*?)\]\s*as const;/u,
  )?.[1] ?? "";
  assert.doesNotMatch(requiredHeaderNavigation, /\/organizer|Organizer Login/u);
});

test("homepage partnerships enter the existing Contact form", async () => {
  const home = await source("app/_components/HomePageRenderer.tsx");
  assert.match(
    home,
    /href="\/contact\?topic=partnerships#contact-form"[\s\S]*?Discuss a partnership/u,
  );
  assert.doesNotMatch(home, /\/get-involved#partner/u);
});

async function source(pathname) {
  return readFile(new URL(pathname, projectRoot), "utf8");
}
