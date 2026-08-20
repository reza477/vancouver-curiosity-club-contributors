import Link from "next/link";

export function PublicFormPrivacyNotice() {
  return (
    <section
      className="editorial-section public-form-privacy"
      aria-labelledby="public-form-privacy-title"
    >
      <p className="section-kicker">Public form data</p>
      <h2 id="public-form-privacy-title">
        How we handle information you send
      </h2>
      <p>
        The Feedback form collects a name, reply email, topic, and message.
        Volunteer collects a name, reply email, one to five interest areas,
        how the visitor would like to help, and optional availability or
        relevant context.
      </p>
      <p>
        Host an Event collects a name, reply email, proposed event title or
        topic, short event idea, format, and optional preferred club or
        program and timing. Partnership or Funding Support collects a contact
        name, reply email, organization, venue, or supporter name, partnership
        type, message, and an optional HTTPS website.
      </p>
      <p>
        The information is used so authorized Vancouver Curiosity Club
        organizers can review and respond outside the application. It is
        stored in a private organizer inbox. Access to submissions is
        restricted to authorized organizers. Form content is not used for
        automatic marketing enrollment, and the site sends no
        form-confirmation email.
      </p>
      <p>
        Each submission receives a retention-review date 12 months after it
        is received. That review does not automatically delete it. An
        authorized Owner can permanently redact its personal content. A
        minimal administrative record may remain with the submission
        reference, form type, dates, final status, and security or audit
        facts.
      </p>
      <p>
        The site uses technical safeguards and limits private submission
        access to authorized organizers, but no online service can guarantee
        absolute security.
      </p>
      <p>
        The form uses a random anonymous browser cookie for one year to apply
        retry and abuse limits. It turns limited IP-address, browser user-agent, and
        accepted-language information into private keyed hashes. The raw
        network and browser information is not stored in the form submission
        or those rate-limit records. Our hosting and security provider may
        set its own short-lived security cookies.
      </p>
      <p>
        Event RSVP and ticket buttons may open Meetup or another external
        service. Information entered there is processed by that external
        service under its own privacy practices. Vancouver Curiosity Club
        does not process your RSVP through this website.
      </p>
      <p>
        To ask a privacy question or request review, correction, or deletion
        of information you submitted, use the{" "}
        <Link href="/contact">Feedback form</Link> and choose the Privacy topic.
        Include your submission reference if you have it. We will review the
        request and follow up using the reply email you provide. Deletion is
        not automatic; an authorized Owner can irreversibly redact personal
        content while retaining the minimal administrative record described
        above.
      </p>
    </section>
  );
}
