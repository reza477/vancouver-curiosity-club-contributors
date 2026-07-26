"use client";

import { useEffect, useState } from "react";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

type PolicyMode =
  | "block"
  | "require_admin_approval"
  | "warn_reason";

type ConflictPolicyDto = Readonly<{
  defaultHoldHours: number;
  mode: PolicyMode;
  nearingExpiryHours: number;
  version: number;
}>;

type VenueDto = Readonly<{
  accessibilityNotes: string;
  archived: boolean;
  id: string;
  name: string;
  privateAddress: string;
  privateDirections: string;
  timezone: string;
  version: number;
}>;

export function Phase4SettingsPanels({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  const [policy, setPolicy] = useState<ConflictPolicyDto | null>(null);
  const [venues, setVenues] = useState<readonly VenueDto[]>([]);
  const [loadNotice, setLoadNotice] = useState(
    "Loading private conflict policy and venues…",
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const [policyBody, venueBody] = await Promise.all([
          organizerRequest("/api/organizer/settings/conflict-policy", {
            signal: controller.signal,
          }),
          organizerRequest("/api/organizer/venues", {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        setPolicy(parsePolicy(policyBody));
        setVenues(parseVenues(venueBody));
        setLoadNotice("");
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadNotice(
          safeNotice(
            error,
            "Private conflict settings could not be loaded. No value is being guessed.",
          ),
        );
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <div className={styles.phase4Settings}>
      <p aria-atomic="true" aria-live="polite">
        {loadNotice}
      </p>
      <ConflictPolicyPanel
        canManage={canManage}
        onChange={setPolicy}
        policy={policy}
      />
      <VenueWorkspace
        canManage={canManage}
        onChange={setVenues}
        venues={venues}
      />
    </div>
  );
}

function ConflictPolicyPanel({
  canManage,
  onChange,
  policy,
}: Readonly<{
  canManage: boolean;
  onChange: (policy: ConflictPolicyDto) => void;
  policy: ConflictPolicyDto | null;
}>) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !policy || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    try {
      const body = await organizerRequest(
        "/api/organizer/settings/conflict-policy",
        {
          body: JSON.stringify({
            defaultHoldHours: Number(form.get("defaultHoldHours")),
            expectedPolicyVersion: policy.version,
            mode: form.get("mode"),
            nearingExpiryHours: Number(form.get("nearingExpiryHours")),
          }),
          method: "PATCH",
        },
      );
      const next = parsePolicy(body);
      if (!next) throw new TypeError("Unexpected conflict policy response");
      onChange(next);
      setNotice("Private conflict policy saved.");
    } catch (error) {
      setNotice(safeNotice(error, "The conflict policy was not saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.policyPanel} onSubmit={submit}>
      <header>
        <p className={styles.kicker}>Authoritative reserving policy</p>
        <h2>How overlaps are handled</h2>
        <p>
          The final D1 write always rechecks the complete schedule. This setting
          does not publish an event or change Meetup.
        </p>
      </header>
      {policy ? (
        <div>
          <fieldset disabled={!canManage || busy}>
            <legend>Conflict policy</legend>
            <label>
              <input
                defaultChecked={policy.mode === "warn_reason"}
                name="mode"
                type="radio"
                value="warn_reason"
              />
              <span>
                <strong>Warn and require a reason</strong>
                <small>
                  An authorized editor may reserve an intentional overlap only
                  with a bounded written coordination reason.
                </small>
              </span>
            </label>
            <label>
              <input
                defaultChecked={policy.mode === "require_admin_approval"}
                name="mode"
                type="radio"
                value="require_admin_approval"
              />
              <span>
                <strong>Require administrator approval</strong>
                <small>
                  The request stays a non-reserving private Draft until an
                  eligible Owner or Administrator approves the current version.
                </small>
              </span>
            </label>
            <label>
              <input
                defaultChecked={policy.mode === "block"}
                name="mode"
                type="radio"
                value="block"
              />
              <span>
                <strong>Block overlaps</strong>
                <small>
                  No reason or client choice can reserve the conflicting time.
                </small>
              </span>
            </label>
          </fieldset>
          <div className={styles.policyNumbers}>
            <label>
              <span>Default hold duration, hours</span>
              <input
                defaultValue={policy.defaultHoldHours}
                disabled={!canManage || busy}
                max={720}
                min={1}
                name="defaultHoldHours"
                required
                type="number"
              />
              <small>Initially 72 hours. Holds stop reserving at exact D1 expiry.</small>
            </label>
            <label>
              <span>Near-expiry notice, hours before</span>
              <input
                defaultValue={policy.nearingExpiryHours}
                disabled={!canManage || busy}
                max={168}
                min={1}
                name="nearingExpiryHours"
                required
                type="number"
              />
              <small>Initially 24 hours. Notices are reconciled without cron.</small>
            </label>
          </div>
          <p className={styles.policyVersion}>Policy version {policy.version}</p>
          {canManage ? (
            <button className={styles.primaryButton} disabled={busy} type="submit">
              {busy ? "Saving…" : "Save conflict policy"}
            </button>
          ) : (
            <p className={styles.roleNote}>
              Organizer access is read-only. Only an Owner or Administrator may
              change reserving policy.
            </p>
          )}
          <p aria-live="polite">{notice}</p>
        </div>
      ) : (
        <p className={styles.panelEmpty}>
          No policy value is shown until the private D1 record loads.
        </p>
      )}
    </form>
  );
}

function VenueWorkspace({
  canManage,
  onChange,
  venues,
}: Readonly<{
  canManage: boolean;
  onChange: (venues: readonly VenueDto[]) => void;
  venues: readonly VenueDto[];
}>) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busyId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusyId("create");
    setNotice("");
    try {
      const body = await organizerRequest("/api/organizer/venues", {
        body: JSON.stringify(venuePayload(data)),
        method: "POST",
      });
      const venue = parseVenueRecord(
        isRecord(body) ? body.venue : null,
      );
      if (!venue) throw new TypeError("Unexpected venue response");
      onChange(Object.freeze([...venues, venue]));
      form.reset();
      setNotice("Private venue created.");
    } catch (error) {
      setNotice(safeNotice(error, "The private venue was not created."));
    } finally {
      setBusyId(null);
    }
  }

  async function update(
    event: React.FormEvent<HTMLFormElement>,
    venue: VenueDto,
  ) {
    event.preventDefault();
    if (!canManage || busyId) return;
    const data = new FormData(event.currentTarget);
    setBusyId(venue.id);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/venues/${encodeURIComponent(venue.id)}`,
        {
          body: JSON.stringify({
            ...venuePayload(data),
            expectedVersion: venue.version,
          }),
          method: "PATCH",
        },
      );
      const next = parseVenueRecord(isRecord(body) ? body.venue : null);
      if (!next) throw new TypeError("Unexpected venue response");
      onChange(
        Object.freeze(
          venues.map((candidate) =>
            candidate.id === next.id ? next : candidate,
          ),
        ),
      );
      setNotice("Private venue updated.");
    } catch (error) {
      setNotice(safeNotice(error, "The private venue was not updated."));
    } finally {
      setBusyId(null);
    }
  }

  async function archive(venue: VenueDto) {
    if (
      !canManage ||
      busyId ||
      !window.confirm(
        "Archive this private venue? Active reservations using it must be resolved first.",
      )
    ) {
      return;
    }
    setBusyId(venue.id);
    setNotice("");
    try {
      const body = await organizerRequest(
        `/api/organizer/venues/${encodeURIComponent(venue.id)}/archive`,
        {
          body: JSON.stringify({ expectedVersion: venue.version }),
          method: "POST",
        },
      );
      const next = parseVenueRecord(isRecord(body) ? body.venue : null);
      if (!next) throw new TypeError("Unexpected venue response");
      onChange(
        Object.freeze(
          venues.map((candidate) =>
            candidate.id === next.id ? next : candidate,
          ),
        ),
      );
      setNotice("Private venue archived.");
    } catch (error) {
      setNotice(safeNotice(error, "The private venue was not archived."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.venueWorkspace} aria-labelledby="venues-title">
      <header>
        <p className={styles.kicker}>Private scheduling resources</p>
        <h2 id="venues-title">Venues</h2>
        <p>
          These private records support schedule coordination only. Public
          venue names, addresses, and publishing controls are not available.
        </p>
      </header>

      {canManage ? (
        <form className={styles.venueForm} onSubmit={create}>
          <h3>Add a private venue</h3>
          <VenueFields prefix="new" />
          <button className={styles.primaryButton} disabled={busyId !== null} type="submit">
            {busyId === "create" ? "Adding…" : "Add venue"}
          </button>
        </form>
      ) : null}

      <div className={styles.venueList}>
        {venues.length === 0 ? (
          <p className={styles.panelEmpty}>
            No private venue has been recorded.
          </p>
        ) : (
          venues.map((venue) => (
            <article key={venue.id}>
              <header>
                <div>
                  <h3>{venue.name}</h3>
                  <p>
                    {venue.timezone}
                    {venue.archived ? " · Archived" : " · Active"}
                  </p>
                </div>
              </header>
              <details>
                <summary>
                  {canManage ? "Edit private venue" : "View private venue"}
                </summary>
                <form onSubmit={(event) => void update(event, venue)}>
                  <VenueFields initial={venue} prefix={venue.id} readOnly={!canManage} />
                  {canManage ? (
                    <div className={styles.venueActions}>
                      <button
                        className={styles.primaryButton}
                        disabled={busyId !== null || venue.archived}
                        type="submit"
                      >
                        {busyId === venue.id ? "Saving…" : "Save venue"}
                      </button>
                      <button
                        className={styles.secondaryButton}
                        disabled={busyId !== null || venue.archived}
                        onClick={() => void archive(venue)}
                        type="button"
                      >
                        Archive venue
                      </button>
                    </div>
                  ) : null}
                </form>
              </details>
            </article>
          ))
        )}
      </div>
      <p aria-live="polite">{notice}</p>
    </section>
  );
}

function VenueFields({
  initial,
  prefix,
  readOnly = false,
}: Readonly<{
  initial?: VenueDto;
  prefix: string;
  readOnly?: boolean;
}>) {
  return (
    <div className={styles.venueFields}>
      <label>
        <span>Name</span>
        <input
          defaultValue={initial?.name ?? ""}
          disabled={readOnly}
          maxLength={180}
          name="name"
          required
        />
      </label>
      <label>
        <span>Timezone</span>
        <input
          defaultValue={initial?.timezone ?? "America/Vancouver"}
          disabled={readOnly}
          list={`venue-timezones-${prefix}`}
          maxLength={100}
          name="timezone"
          required
        />
        <datalist id={`venue-timezones-${prefix}`}>
          <option value="America/Vancouver" />
          <option value="America/Toronto" />
          <option value="America/New_York" />
          <option value="Europe/London" />
          <option value="UTC" />
        </datalist>
      </label>
      <label className={styles.fieldFull}>
        <span>Private address</span>
        <input
          defaultValue={initial?.privateAddress ?? ""}
          disabled={readOnly}
          maxLength={500}
          name="privateAddress"
        />
      </label>
      <label className={styles.fieldFull}>
        <span>Private arrival directions</span>
        <textarea
          defaultValue={initial?.privateDirections ?? ""}
          disabled={readOnly}
          maxLength={2_000}
          name="privateDirections"
          rows={3}
        />
      </label>
      <label className={styles.fieldFull}>
        <span>Private accessibility notes</span>
        <textarea
          defaultValue={initial?.accessibilityNotes ?? ""}
          disabled={readOnly}
          maxLength={2_000}
          name="accessibilityNotes"
          rows={3}
        />
        <small>
          Record known coordination facts only; do not promise venue accessibility.
        </small>
      </label>
    </div>
  );
}

function venuePayload(form: FormData) {
  return {
    accessibilityNotes: form.get("accessibilityNotes"),
    name: form.get("name"),
    privateAddress: form.get("privateAddress"),
    privateDirections: form.get("privateDirections"),
    timezone: form.get("timezone"),
  };
}

function parsePolicy(value: unknown): ConflictPolicyDto | null {
  const raw = isRecord(value) && isRecord(value.policy) ? value.policy : value;
  if (!isRecord(raw)) return null;
  const mode =
    raw.mode === "warn_reason" ||
    raw.mode === "require_admin_approval" ||
    raw.mode === "block"
      ? raw.mode
      : null;
  const defaultHoldHours = boundedInteger(raw.defaultHoldHours, 1, 720);
  const nearingExpiryHours = boundedInteger(raw.nearingExpiryHours, 1, 168);
  const version = boundedInteger(raw.version, 1, Number.MAX_SAFE_INTEGER);
  return mode && defaultHoldHours && nearingExpiryHours && version
    ? Object.freeze({
        defaultHoldHours,
        mode,
        nearingExpiryHours,
        version,
      })
    : null;
}

function parseVenues(value: unknown): readonly VenueDto[] {
  if (!isRecord(value) || !Array.isArray(value.venues)) return [];
  return Object.freeze(
    value.venues
      .slice(0, 250)
      .flatMap((venue) => {
        const parsed = parseVenueRecord(venue);
        return parsed ? [parsed] : [];
      }),
  );
}

function parseVenueRecord(value: unknown): VenueDto | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, 128);
  const name = boundedText(value.name, 180);
  const timezone = boundedText(value.timezone, 100);
  const version = boundedInteger(value.version, 1, Number.MAX_SAFE_INTEGER);
  if (!id || !name || !timezone || !version) return null;
  return Object.freeze({
    accessibilityNotes: optionalText(value.accessibilityNotes, 2_000),
    archived: value.archived === true,
    id,
    name,
    privateAddress: optionalText(value.privateAddress, 500),
    privateDirections: optionalText(value.privateDirections, 2_000),
    timezone,
    version,
  });
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function optionalText(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : "";
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}
