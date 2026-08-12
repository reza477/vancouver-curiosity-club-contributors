export function OrganizerNote({
  headingId,
}: Readonly<{
  headingId: string;
}>) {
  return (
    <>
      <div>
        <p className="section-kicker">A note from Reza</p>
        <h2 id={headingId}>Curiosity is enough to begin.</h2>
      </div>
      <blockquote className="organizer-note__quote">
        <p>
          “I want this to be a place where you can follow a real interest
          without needing to impress anyone. Choose an event that pulls you in,
          come as you are, and we’ll take it from there.”
        </p>
        <cite>Reza</cite>
      </blockquote>
    </>
  );
}
