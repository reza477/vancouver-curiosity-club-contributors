const CARD_SKELETONS = ["first", "second", "third"] as const;

export default function PublicRouteLoading() {
  return (
    <main
      className="route-loading"
      aria-busy="true"
      aria-labelledby="route-loading-status"
    >
      <p
        className="route-loading__status"
        id="route-loading-status"
        role="status"
        aria-live="polite"
      >
        Loading the next page...
      </p>

      <div className="route-loading__skeleton" aria-hidden="true">
        <div className="route-loading__masthead">
          <span className="route-loading__shape route-loading__eyebrow" />
          <span className="route-loading__shape route-loading__title" />
          <span className="route-loading__shape route-loading__copy" />
          <span className="route-loading__shape route-loading__copy route-loading__copy--short" />
        </div>

        <div className="route-loading__cards">
          {CARD_SKELETONS.map((card) => (
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
