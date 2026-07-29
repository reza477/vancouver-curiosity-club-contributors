import Link from "next/link";
import type {
  PublicClubDto,
  PublicLaneDto,
} from "@/lib/server/public/catalog";
import type { PublicEventCategoryOption } from "@/lib/server/public/events";

export type EventFilterValues = Readonly<{
  category: string;
  club: string;
  format: string;
  from: string;
  lane: string;
  page: string;
  q: string;
  state: "past" | "upcoming";
  to: string;
}>;

export function EventFilters({
  categories,
  clubs,
  lanes,
  resultCount,
  values,
}: Readonly<{
  categories: readonly PublicEventCategoryOption[];
  clubs: readonly PublicClubDto[];
  lanes: readonly PublicLaneDto[];
  resultCount: number;
  values: EventFilterValues;
}>) {
  return (
    <section className="event-filters" aria-labelledby="event-filter-heading">
      <nav className="event-view-tabs" aria-label="Event timeframe">
        <Link
          aria-current={values.state === "upcoming" ? "page" : undefined}
          href={stateHref(values, "upcoming")}
        >
          Upcoming
        </Link>
        <Link
          aria-current={values.state === "past" ? "page" : undefined}
          href={stateHref(values, "past")}
        >
          Past
        </Link>
      </nav>

      <form action="/events" key={filterFormKey(values)} method="get">
        <input type="hidden" name="state" value={values.state} />
        <div className="filter-heading">
          <div>
            <p className="section-kicker">Refine the calendar</p>
            <h2 id="event-filter-heading">Find your next field note</h2>
          </div>
          <p aria-live="polite">
            {resultCount} {resultCount === 1 ? "result" : "results"}
          </p>
        </div>

        <div className="filter-grid">
          <label className="filter-search">
            <span>Keyword</span>
            <input
              defaultValue={values.q}
              maxLength={100}
              name="q"
              placeholder="A title, subject, or club"
              type="search"
            />
          </label>
          <label>
            <span>From</span>
            <input defaultValue={values.from} name="from" type="date" />
          </label>
          <label>
            <span>To</span>
            <input defaultValue={values.to} name="to" type="date" />
          </label>
          <label>
            <span>Club</span>
            <select defaultValue={values.club} name="club">
              <option value="">All clubs</option>
              {clubs.map((club) => (
                <option key={club.slug} value={club.slug}>
                  {club.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Lane</span>
            <select defaultValue={values.lane} name="lane">
              <option value="">All lanes</option>
              {lanes.map((lane) => (
                <option key={lane.slug} value={lane.slug}>
                  {lane.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select defaultValue={values.category} name="category">
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Format</span>
            <select defaultValue={values.format} name="format">
              <option value="">All formats</option>
              <option value="in-person">In person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
              <option value="location-undecided">Location undecided</option>
            </select>
          </label>
        </div>

        <div className="filter-actions">
          <button type="submit">Apply filters</button>
          <Link href={`/events?state=${values.state}`}>Clear Filters</Link>
        </div>
      </form>
    </section>
  );
}

function stateHref(
  values: EventFilterValues,
  state: EventFilterValues["state"],
): string {
  const params = new URLSearchParams();
  params.set("state", state);
  for (const [key, value] of [
    ["q", values.q],
    ["from", values.from],
    ["to", values.to],
    ["club", values.club],
    ["lane", values.lane],
    ["category", values.category],
    ["format", values.format],
  ] as const) {
    if (value) params.set(key, value);
  }
  return `/events?${params.toString()}`;
}

function filterFormKey(values: EventFilterValues): string {
  return JSON.stringify([
    values.state,
    values.q,
    values.from,
    values.to,
    values.club,
    values.lane,
    values.category,
    values.format,
  ]);
}
