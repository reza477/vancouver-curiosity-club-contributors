import Link from "next/link";

export function PublicFormPrivacyNotice() {
  return (
    <section
      className="editorial-section public-form-privacy"
      aria-labelledby="public-form-privacy-title"
    >
      <p className="section-kicker">Public form data</p>
      <h2 id="public-form-privacy-title">
        How this release handles messages
      </h2>
      <p>
        Contact collects a name, reply email, topic, and message. Volunteer
        collects a name, reply email, one to five interest areas, how the
        visitor would like to help, and optional availability or relevant
        context.
      </p>
      <p>
        Host an Event collects a name, reply email, proposed event title or
        topic, short event idea, format, and optional preferred club or
        program and timing. Venue or Community Partnership collects a
        contact name, reply email, organization or venue name, partnership
        type, message, and an optional HTTPS website.
      </p>
      <p>
        The information is used so authorized Vancouver Curiosity Club
        organizers can review and respond outside the application. It is
        stored in the private organizer inbox. Owners and Administrators may
        review all submissions; an Organizer may review only a submission
        explicitly assigned to them.
      </p>
      <p>
        Each submission receives a retention-review date 12 months after it
        is received. This release does not delete submissions automatically:
        an Owner decides whether to redact personal content after review.
        Form content is not used for automatic marketing enrollment, and the
        site sends no form-confirmation email.
      </p>
      <p>
        The site is hosted through OpenAI/ChatGPT Sites. Organizer Sign in
        with ChatGPT may provide the organizer portal with a name and email
        identity. Public visitors do not need to sign in to send a form.
      </p>
      <p>
        The form service sets one random anonymous browser cookie for one year
        so retries and abuse limits can be applied without a public account.
        It also transforms bounded IP-address, browser user-agent, and
        accepted-language facts into private keyed rate-limit hashes. The raw
        network and browser facts are not stored in those rate-limit records.
      </p>
      <p>
        To raise a privacy question, use the{" "}
        <Link href="/contact">Contact form</Link> and choose the Privacy topic.
        This policy is marked internally for owner/legal review. Publishing a
        page is not a claim of legal compliance.
      </p>
    </section>
  );
}
