const EVENT_SKELETONS = ["first", "second", "third"] as const;

export default function EventsLoading() {
  return (
    <main
      aria-busy="true"
      aria-labelledby="events-loading-status"
      className="route-loading"
    >
      <p
        aria-live="polite"
        className="route-loading__status"
        id="events-loading-status"
        role="status"
      >
        Loading events...
      </p>

      <div aria-hidden="true" className="route-loading__skeleton">
        <div className="route-loading__masthead">
          <span className="route-loading__shape route-loading__eyebrow" />
          <span className="route-loading__shape route-loading__title" />
          <span className="route-loading__shape route-loading__copy" />
          <span className="route-loading__shape route-loading__copy route-loading__copy--short" />
        </div>

        <div className="route-loading__cards">
          {EVENT_SKELETONS.map((card) => (
            <div className="route-loading__card" key={card}>
              <span className="route-loading__shape route-loading__poster" />
              <span className="route-loading__shape route-loading__card-title" />
              <span className="route-loading__shape route-loading__card-copy" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
