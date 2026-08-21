import Link from "next/link";

export function PublicFormPrivacyNotice() {
  return (
    <section
      className="editorial-section public-form-privacy"
      aria-labelledby="public-form-privacy-title"
    >
      <p className="section-kicker">Privacy</p>
      <h2 id="public-form-privacy-title">
        How we handle information you send
      </h2>
      <p>
        Each public form asks only for the details needed to understand your
        message and reply. Depending on the form, that may include your name,
        email, organization, topic, interests, availability, or event idea.
      </p>
      <p>
        Our team uses this information to review your inquiry and follow up.
        Access is limited to the people responsible for handling website
        submissions. Form content is not used for automatic marketing
        enrollment.
      </p>
      <p>
        We review submissions 12 months after they are received. You can ask
        us to review, correct, or delete information you submitted. A limited
        administrative record may be retained where needed for accountability
        and security.
      </p>
      <p>
        We protect submissions and use visitor information only for the
        purposes described here. It is not used for advertising or attendee
        profiles.
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
        <Link href="/contact">Contact form</Link> and choose the Privacy topic.
        Include your submission reference if you have it. We will review the
        request and follow up using the reply email you provide.
      </p>
    </section>
  );
}
