# Technical SEO and unsolicited form-message audit

Reviewed October 3, 2026 (America/Vancouver). Live public-page evidence was
captured at 23:42 UTC against the deployed site at
<https://vancouvercuriosityclub.com>. These are dated observations, not a
guarantee of future availability or search inclusion.

## Assessment of the messages

The reported messages provide no affected URL, reproducible error, crawl
record, indexing report, or other diagnostic evidence. Repeated offers to
"register" the domain with search engines are sales solicitations, not proof
that the website has an indexing defect. Their senders' identities and intent
have not been authenticated. No sender domain or supplied third-party link
was visited, and no sender was contacted or given information.

Google states that organic search inclusion is free and specifically warns
about unsolicited SEO sales messages. Its technical requirements distinguish
eligibility from actual indexing: a crawlable working page with indexable
content may be eligible, but indexing is not guaranteed.
See [Google's SEO hiring guidance](https://developers.google.com/search/docs/fundamentals/do-i-need-seo)
and [Google Search technical requirements](https://developers.google.com/search/docs/essentials/technical).

## Independently verified public behavior

A bounded audit made 44 read-only GET requests to the canonical site and its
configured aliases. It did not submit forms, send email, trigger Meetup
maintenance, or read private submissions. The ignored local evidence is in
`work/seo-spam-2026-10-03/public-seo-audit.json`; only public response metadata,
links, and structured data were retained, not form tokens or cookies.

| Check | Observed result |
| --- | --- |
| Sitemap | HTTP 200 XML, 30 distinct public HTTPS `.com` URLs; every listed URL returned 200. |
| Public content | All 30 listed pages contained readable server-rendered text, a title, a description, and one matching canonical URL. None had a `noindex` directive or stale-response marker. |
| Public navigation | The inspected internal HTML links to ordinary public pages resolved to the audited sitemap destinations; no additional broken public destination was found. |
| Robots | HTTP 200 text; allows public paths and advertises the `.com` sitemap. Existing organizer, authentication, API, preview, and query-string crawl exclusions remain in place. |
| Query views | The calendar query view remained `noindex, follow` and canonicalized to `/events`, as intended. |
| Organizer boundary | An unauthenticated GET to `/organizer` returned a 307 sign-in redirect with `X-Robots-Tag: noindex, nofollow, noarchive`; no private content was returned. |
| Missing URLs | `/fekal0911` and three controlled nonexistent paths, including event and club paths, returned actual HTTP 404 responses with `noindex`. They were not successful pages or redirects to the home page. |
| HTTPS aliases | The configured `www`, `.ca`, and Sites aliases returned 308 redirects to the exact corresponding `.com` path. `/events/` also returned a 308 to `/events`. |
| HTTP | The hosting edge returned 302 from HTTP `/events` to its HTTPS equivalent. The application itself specifies permanent canonical redirects; this edge response is not a demonstrated crawl blocker. |
| Structured data | Home included Organization data. All 17 listed event pages included parseable Event and BreadcrumbList JSON-LD, with matching public titles, dates, canonical URLs, and locations. One cancellation retained its dates and used `EventCancelled`. |

Recurring events legitimately share names and descriptions. The audit did not
rename, merge, reschedule, remove, or otherwise change event records to make
metadata look unique. Structured data uses approved public fields only;
address completeness varies with available venue information. Parsing these
documents is not a Google Rich Results Test and does not prove enhanced-result
eligibility or appearance.

Google recommends real 404/410 responses for missing content and accurate
event properties, including preserving identifying details on cancellations.
See [Google's crawling-error guidance](https://developers.google.com/search/docs/crawling-indexing/troubleshoot-crawling-errors)
and [Google's Event structured-data documentation](https://developers.google.com/search/docs/appearance/structured-data/event).

## Reproducible defect and scoped correction

The sitemap's optional modification dates were not reliable page-content
dates. `/events` advertised August 12 and Home/club routes July 27 even though
their displayed event content changed in October. Catalog sitemap queries
read only the page/profile row's `updated_at`, which does not cover the full
rendered page. Meetup event entries used the maximum of snapshot update and
generation publication times, so a refresh could advertise a new modification
date without a public content change.

`app/sitemap.ts` now omits optional `lastmod` values until a reliable complete
public-content revision exists. All URL selection, receipt checks, canonical
origins, privacy restrictions, and the rolling 35-day Meetup window remain
unchanged. No current timestamp is substituted. This is a freshness-signal
correction, not evidence that the entire website was unindexable.

Google and Bing both ask for accurate modification dates. Bing explicitly
advises omitting sitemap attributes when an appropriate value cannot be
provided. See [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[Bing's current webmaster guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a?region=france),
and [Bing's sitemap attribute guidance](https://blogs.bing.com/webmaster/2016/5/Sitemaps-%E2%80%93-4-Basics-to-Get-You-Started/).

## Indexing evidence and limits

The accessible Google Search Console session showed its welcome/add-property
screen rather than a verified property or indexing report. Bing Webmaster
Tools was signed out. No verified search-engine crawl, index-coverage,
manual-action, or ranking report was therefore available in this audit. No
account or property was created or changed merely to complete the audit.

The live checks establish technical eligibility observations only. They do
not establish whether Google or Bing has indexed every page, when either
engine last crawled it, or its rankings. A sitemap helps discovery but does
not guarantee indexing. Bing distinguishes its live crawl check from the
stored index details in its
[URL Inspection documentation](https://blogs.bing.com/webmaster/2020/9/Introducing-the-Bing-Webmaster-Tools-URL-Inspection-Tool/).

## Validation and delivery record

- Existing public route contracts: 5/5 passed after the sitemap edit.
- A regression assertion in the rendered-Worker sitemap test requires the
  actual XML to omit unsupported `lastmod` fields while retaining the existing
  public-route and privacy checks. It must run in the normal release gate.
- Public catalog, migration replay, and packaged migration-list checks passed
  with the additive moderation and deduplication migrations.
- Intake protections: 59 focused tests passed; moderation: 11 backend/API
  tests and four interface tests passed. Independent review found no blocking
  authorization, concurrency, privacy, or email-delivery defect.
- The complete built-Worker suite passed 40/40. Type-check, lint, production
  build, and dependency audit passed (zero reported vulnerabilities).
- Synthetic browser checks at 1440px and 375px covered Contact, Host,
  Volunteer, and the current partnership journey (Contact's Partnerships
  mode). The legacy partnership endpoint remains covered by integration tests.
  A legitimate Privacy inquiry succeeded; a repeat returned the same receipt.
  Bulk quarantine and individual Trash/restore preserved content and notes;
  restored records kept the email hold. No browser errors were observed.
- Phone verification exposed clipped long submission references and crowded
  badges/header text. Bounded grid tracks and wrapping now keep the detail
  content within the viewport; status badges and navigation stay readable.
  [Desktop inbox](audit-evidence/2026-10-03/inbox-desktop.png),
  [phone before correction](audit-evidence/2026-10-03/mobile-before.png),
  [phone after correction](audit-evidence/2026-10-03/mobile-after.png), and
  [desktop partnership form](audit-evidence/2026-10-03/partnership-desktop.png)
  show only synthetic local data. The isolated preview had no email provider
  and denied outbound networking. No production test inquiry was submitted.
- The audit and code edit alone do not constitute a live deployment. The final
  task delivery record must identify the exact validated revision, release,
  changed-form and organizer checks, and post-release sitemap verification.

## Form-spam findings and safeguards

Local tests reproduced two intake weaknesses without sending email or creating
production submissions. Six identical valid inquiries using fresh browser
identifiers created six records and six email outbox entries. An otherwise
valid inquiry completed in one second was replaced by an unrecoverable
anti-abuse marker. Neither result establishes that every unsolicited message
was automated or that its claimed sender identity is authentic.

The shared intake used by Contact, Host, Volunteer, and Partnership now:

- gives fast legitimate visitors a retryable validation response that preserves
  their answers;
- retains valid honeypot submissions in recoverable Spam instead of erasing
  their content;
- quarantines a narrow known-domain search-registration campaign pattern,
  while allowing ordinary SEO questions and reports about those campaigns;
- applies independent HMAC-based browser and reply-address limits, with no
  shared-browser bucket for unrelated visitors who disable cookies;
- deduplicates matching normalized submissions within fixed 15-minute
  buckets and preserves retry receipts across fresh form instances. Identical
  inquiries on opposite sides of a bucket boundary can create separate records.

Signed form instances, origin checks, bounded input, accessible hidden
honeypots, and the organization-wide cap remain in place. No language,
ordinary email provider, or topic label determines legitimacy. These controls
reduce repeat abuse; they do not authenticate senders or promise zero spam.

Owners and Administrators can move up to ten selected records between Inbox,
Spam, and Trash. This uses an additive moderation record, optimistic versions,
transactional authorization and audit checks. Submitted fields, notes, normal
workflow status, and existing delivery receipts remain intact. Assigned
Organizers cannot access non-Inbox folders. Restoration keeps automatic email
delivery held; follow-up remains a deliberate manual action. A batch with a
stale record or an email currently being delivered is rejected atomically.

Permanent personal-content redaction remains a separate Owner-only action,
requiring its existing reference confirmation. This development does not
permanently remove or redact existing records. Historical anti-abuse markers
cannot reconstruct content discarded by earlier releases.

### Release and recovery constraint

Migrations 0024 and 0025 add private moderation, duplicate fingerprints, and
opaque retry receipts. Preserve them and their database guards. Once a
moderation hold exists, use a forward repair or a validated rollback candidate
that retains these email-hold and moderation boundaries. An older Worker that
does not understand moderation holds could resume delivery of held outbox
items; simply redeploying the pre-moderation version is not a safe rollback.
No production submission content belongs in local fixtures, source, or PRs.

### Final visual verification

A live phone-size check exposed an undefined color token that made the selected
submission-folder label blend into its background. The follow-up uses the
existing workspace paper and ink-soft tokens for folder text and submission
details. Synthetic [desktop](audit-evidence/2026-10-03/folder-contrast-desktop.png)
and [phone](audit-evidence/2026-10-03/folder-contrast-mobile.png) screenshots
verify the selected label at 1440px and 375px without horizontal overflow.
The selected text/background contrast is approximately 15.1:1. This is a
stylesheet correction with no data or authentication changes.
