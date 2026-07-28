"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { isRecord, organizerRequest, safeNotice } from "./client";
import styles from "./workspace.module.css";

type PublicationStatus = "private" | "published" | "scheduled" | "unpublished";

type PublicDetailsView = Readonly<{
  arrivalInstructions: string;
  attendanceMode: "hybrid" | "in_person" | "location_undecided" | "online";
  artworkAssetId: string | null;
  availabilityState: "full" | "open" | "waitlist";
  capacity: number | null;
  costText: string;
  externalMapUrl: string;
  metaDescription: string;
  meetupUrlConfirmed: boolean;
  preparationInformation: string;
  publicAccessNote: string;
  publicAddress: string;
  publicHostsEnabled: boolean;
  publicLocationName: string;
  publicOnlineUrl: string;
  rsvpMode: "coming_soon" | "meetup";
  seoTitle: string;
  verifiedAccessibilityNotes: string;
  weatherNote: string;
  whatToBring: string;
}>;

type HostOptionView = Readonly<{
  displayName: string;
  eligible: boolean;
  profileId: string;
  selected: boolean;
}>;

type ArtworkOptionView = Readonly<{
  assetId: string;
  label: string;
  selected: boolean;
}>;

type PublicationWorkspaceView = Readonly<{
  artworkOptions: readonly ArtworkOptionView[];
  details: PublicDetailsView;
  event: Readonly<{
    contentVersion: number;
    id: string;
    meetupEventUrl: string | null;
    planningStatus: string;
    publicationStatus: PublicationStatus;
    scheduleVersion: number;
    slug: string;
    title: string;
  }>;
  hostOptions: readonly HostOptionView[];
  pendingJob: Readonly<{
    originalTimezone: string;
    requestedPublicationAtUtc: number;
  }> | null;
  permissions: Readonly<{
    canCancelScheduledPublication: boolean;
    canEditPublicDetails: boolean;
    canPreview: boolean;
    canPublish: boolean;
    canSchedule: boolean;
    canUnpublish: boolean;
  }>;
  publicPath: string | null;
  readiness: Readonly<{
    missing: readonly Readonly<{
      code: string;
      field: string | null;
      label: string;
    }>[];
    ready: boolean;
  }>;
}>;

type EditableDetails = PublicDetailsView &
  Readonly<{ publicHostProfileIds: readonly string[] }>;

export function WebsitePublicationPanel({
  eventId,
  initialWorkspace,
}: Readonly<{ eventId: string; initialWorkspace: unknown }>) {
  const initial = parseWorkspace(initialWorkspace);
  const [workspace, setWorkspace] = useState(initial);
  const [details, setDetails] = useState<EditableDetails>(() =>
    editableDetails(initial),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  function update<K extends keyof EditableDetails>(
    key: K,
    value: EditableDetails[K],
  ) {
    setDetails((current) => Object.freeze({ ...current, [key]: value }));
  }

  function toggleHost(profileId: string, selected: boolean) {
    update(
      "publicHostProfileIds",
      selected
        ? Object.freeze([...details.publicHostProfileIds, profileId])
        : Object.freeze(
            details.publicHostProfileIds.filter((id) => id !== profileId),
          ),
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.permissions.canEditPublicDetails || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const priorStatus = workspace.event.publicationStatus;
      const response = await organizerRequest(
        `/api/organizer/events/${encodeURIComponent(eventId)}/publication`,
        {
          body: JSON.stringify({
            arrivalInstructions: optional(details.arrivalInstructions),
            attendanceMode: details.attendanceMode,
            artworkAssetId: details.artworkAssetId,
            availabilityState: details.availabilityState,
            capacity: details.capacity,
            confirmMeetupEventUrl:
              details.rsvpMode === "meetup" && details.meetupUrlConfirmed,
            costText: optional(details.costText),
            expectedContentVersion: workspace.event.contentVersion,
            expectedScheduleVersion: workspace.event.scheduleVersion,
            externalMapUrl: optional(details.externalMapUrl),
            metaDescription: optional(details.metaDescription),
            meetupEventUrl: workspace.event.meetupEventUrl,
            preparationInformation: optional(details.preparationInformation),
            publicAccessNote: optional(details.publicAccessNote),
            publicAddress: optional(details.publicAddress),
            selectedHostProfileIds: details.publicHostsEnabled
              ? details.publicHostProfileIds
              : [],
            publicHostsEnabled: details.publicHostsEnabled,
            publicLocationName: optional(details.publicLocationName),
            publicOnlineUrl: optional(details.publicOnlineUrl),
            rsvpMode: details.rsvpMode,
            seoTitle: optional(details.seoTitle),
            verifiedAccessibilityNotes: optional(
              details.verifiedAccessibilityNotes,
            ),
            weatherNote: optional(details.weatherNote),
            whatToBring: optional(details.whatToBring),
          }),
          method: "PATCH",
        },
      );
      const next = parseWorkspaceResponse(response);
      setWorkspace(next);
      setDetails(editableDetails(next));
      setNotice(
        websiteDetailsSaveNotice(
          priorStatus,
          next.event.publicationStatus,
        ),
      );
    } catch (error) {
      setNotice(
        safeNotice(error, "The website details were not saved. Your entries remain here."),
      );
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="website-publication-title"
      className={styles.publicationWorkspace}
    >
      <header className={styles.publicationHeader}>
        <div>
          <p className={styles.kicker}>Website publication</p>
          <h2 id="website-publication-title">Connect this event to the website</h2>
          <p>
            Preview and publish the same canonical event record. This does not
            publish to Meetup, and private notes or private meeting details are
            never used as public fallbacks.
          </p>
        </div>
        <PublicationState
          planningStatus={workspace.event.planningStatus}
          status={workspace.event.publicationStatus}
        />
      </header>

      <div
        className={styles.publicationNotice}
        ref={errorRef}
        tabIndex={-1}
      >
        <p aria-atomic="true" aria-live="polite">
          {notice}
        </p>
      </div>

      <div className={styles.publicationColumns}>
        <form className={styles.publicationForm} onSubmit={save}>
          <fieldset disabled={!workspace.permissions.canEditPublicDetails || busy}>
            <legend>Public event details</legend>
            <p>
              The public title, summary, description, club, taxonomy, and
              schedule are edited in the event form above.
            </p>
            <div className={styles.publicationFields}>
              <label>
                <span>Event artwork</span>
                <select
                  onChange={(event) =>
                    update(
                      "artworkAssetId",
                      event.target.value === "" ? null : event.target.value,
                    )
                  }
                  value={details.artworkAssetId ?? ""}
                >
                  <option value="">Use the Field Notes category artwork</option>
                  {workspace.artworkOptions.map((option) => (
                    <option key={option.assetId} value={option.assetId}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>
                  Only approved, consent-cleared artwork from this workspace is
                  available. Selecting artwork changes content only, never the
                  event schedule.
                </small>
              </label>
              <TextField
                label="SEO title"
                maxLength={60}
                onChange={(value) => update("seoTitle", value)}
                value={details.seoTitle}
              />
              <TextAreaField
                label="Meta description"
                maxLength={160}
                onChange={(value) => update("metaDescription", value)}
                rows={3}
                value={details.metaDescription}
              />
              <p>
                Event artwork is used for the social preview while it remains
                approved and published. Without approved artwork, the existing
                Field Notes social image remains the honest fallback.
              </p>
              <label>
                <span>Attendance mode</span>
                <select
                  onChange={(event) =>
                    update(
                      "attendanceMode",
                      event.target.value as PublicDetailsView["attendanceMode"],
                    )
                  }
                  value={details.attendanceMode}
                >
                  <option value="location_undecided">Location undecided</option>
                  <option value="in_person">In person</option>
                  <option value="online">Online</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </label>
              <label>
                <span>Availability</span>
                <select
                  onChange={(event) =>
                    update(
                      "availabilityState",
                      event.target.value as PublicDetailsView["availabilityState"],
                    )
                  }
                  value={details.availabilityState}
                >
                  <option value="open">Open</option>
                  <option value="waitlist">Waitlist</option>
                  <option value="full">Full</option>
                </select>
              </label>
              <TextField
                label="Approved public location name"
                onChange={(value) => update("publicLocationName", value)}
                value={details.publicLocationName}
              />
              <TextField
                label="Approved public address"
                onChange={(value) => update("publicAddress", value)}
                value={details.publicAddress}
              />
              <TextField
                label="Public online URL"
                onChange={(value) => update("publicOnlineUrl", value)}
                type="url"
                value={details.publicOnlineUrl}
              />
              <TextField
                label="External map URL"
                onChange={(value) => update("externalMapUrl", value)}
                type="url"
                value={details.externalMapUrl}
              />
              <TextAreaField
                label="Public access note"
                onChange={(value) => update("publicAccessNote", value)}
                value={details.publicAccessNote}
              />
              <label>
                <span>Capacity, when genuinely known</span>
                <input
                  max={1_000_000}
                  min={1}
                  onChange={(event) =>
                    update(
                      "capacity",
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                  type="number"
                  value={details.capacity ?? ""}
                />
              </label>
              <TextField
                label="Cost text"
                onChange={(value) => update("costText", value)}
                value={details.costText}
              />
              <TextAreaField
                label="Preparation information"
                onChange={(value) => update("preparationInformation", value)}
                value={details.preparationInformation}
              />
              <TextAreaField
                label="What to bring"
                onChange={(value) => update("whatToBring", value)}
                value={details.whatToBring}
              />
              <TextAreaField
                label="Arrival instructions"
                onChange={(value) => update("arrivalInstructions", value)}
                value={details.arrivalInstructions}
              />
              <TextAreaField
                label="Weather note"
                onChange={(value) => update("weatherNote", value)}
                value={details.weatherNote}
              />
              <TextAreaField
                label="Verified accessibility notes"
                onChange={(value) =>
                  update("verifiedAccessibilityNotes", value)
                }
                value={details.verifiedAccessibilityNotes}
              />
            </div>

            <fieldset className={styles.publicationChoice}>
              <legend>RSVP information</legend>
              <label>
                <input
                  checked={details.rsvpMode === "coming_soon"}
                  name="rsvpMode"
                  onChange={() => {
                    update("rsvpMode", "coming_soon");
                    update("meetupUrlConfirmed", false);
                  }}
                  type="radio"
                />
                <span>
                  <strong>Coming soon</strong>
                  <small>No RSVP button is shown.</small>
                </span>
              </label>
              <label>
                <input
                  checked={details.rsvpMode === "meetup"}
                  name="rsvpMode"
                  onChange={() => update("rsvpMode", "meetup")}
                  type="radio"
                />
                <span>
                  <strong>RSVP on Meetup</strong>
                  <small>
                    Requires the exact individual Meetup event URL saved in the
                    event form.
                  </small>
                </span>
              </label>
              {details.rsvpMode === "meetup" ? (
                <label className={styles.consentField}>
                  <input
                    checked={details.meetupUrlConfirmed}
                    onChange={(event) =>
                      update("meetupUrlConfirmed", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>Confirm this exact event destination</strong>
                    <small>
                      {workspace.event.meetupEventUrl ??
                        "No individual Meetup event URL is currently saved."}
                    </small>
                  </span>
                </label>
              ) : null}
            </fieldset>

            <fieldset className={styles.publicationChoice}>
              <legend>Public hosts</legend>
              <label>
                <input
                  checked={details.publicHostsEnabled}
                  onChange={(event) =>
                    update("publicHostsEnabled", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Show selected eligible hosts</strong>
                  <small>
                    A host appears only while their canonical profile consent
                    and current organizer assignment remain valid.
                  </small>
                </span>
              </label>
              {details.publicHostsEnabled ? (
                <div className={styles.publicHostChoices}>
                  {workspace.hostOptions.length > 0 ? (
                    workspace.hostOptions.map((host) => (
                      <label key={host.profileId}>
                        <input
                          checked={details.publicHostProfileIds.includes(
                            host.profileId,
                          )}
                          disabled={!host.eligible}
                          onChange={(event) =>
                            toggleHost(host.profileId, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>
                          {host.displayName}
                          {!host.eligible ? " — not currently eligible" : ""}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p>No eligible current event organizers are available.</p>
                  )}
                </div>
              ) : null}
            </fieldset>

            {workspace.permissions.canEditPublicDetails ? (
              <button
                className={styles.primaryButton}
                disabled={busy}
                type="submit"
              >
                {busy ? "Saving…" : "Save website details"}
              </button>
            ) : (
              <p className={styles.roleNote}>
                You may view these details, but your current assignment does not
                allow you to change them.
              </p>
            )}
          </fieldset>
        </form>

        <aside className={styles.publicationReadiness}>
          <p className={styles.kicker}>Readiness</p>
          <h3>
            {workspace.readiness.ready
              ? "Ready for the final server check"
              : "Needs attention before publishing"}
          </h3>
          {workspace.readiness.missing.length > 0 ? (
            <ul>
              {workspace.readiness.missing.map((item) => (
                <li key={`${item.code}:${item.field ?? ""}`}>{item.label}</li>
              ))}
            </ul>
          ) : (
            <p>
              The saved record is complete enough to request publication. D1
              still rechecks authorization, versions, slug uniqueness, and
              conflicts in the final atomic write.
            </p>
          )}
          {workspace.permissions.canPreview ? (
            <Link
              className={styles.secondaryButton}
              href={`/organizer/events/${encodeURIComponent(eventId)}/preview`}
            >
              Open protected preview
            </Link>
          ) : null}
          <PublicationActions
            eventId={eventId}
            onBusyChange={setBusy}
            onNotice={setNotice}
            workspace={workspace}
          />
        </aside>
      </div>
    </section>
  );
}

function websiteDetailsSaveNotice(
  priorStatus: PublicationStatus,
  resultStatus: PublicationStatus,
): string {
  if (priorStatus === "published" && resultStatus === "published") {
    return "Website details saved. The live public page has been updated.";
  }
  if (priorStatus === "scheduled" && resultStatus === "unpublished") {
    return "Website details saved. The scheduled publication was cancelled because publication facts changed; the event is now Unpublished.";
  }
  return "Website details saved privately.";
}

export function PublicationActions({
  eventId,
  onBusyChange,
  onNotice,
  workspace,
}: Readonly<{
  eventId: string;
  onBusyChange: (busy: boolean) => void;
  onNotice: (notice: string) => void;
  workspace: PublicationWorkspaceView;
}>) {
  const [publicationDate, setPublicationDate] = useState("");
  const [publicationTime, setPublicationTime] = useState("");
  const [publicationTimezone, setPublicationTimezone] = useState(
    workspace.pendingJob?.originalTimezone ?? "America/Vancouver",
  );
  const [acting, setActing] = useState(false);

  async function act(
    action:
      | "cancel_scheduled_publication"
      | "publish"
      | "schedule_publication"
      | "unpublish",
  ) {
    if (acting) return;
    if (
      (action === "publish" || action === "unpublish") &&
      !window.confirm(actionConfirmation(action))
    ) {
      return;
    }
    setActing(true);
    onBusyChange(true);
    onNotice("");
    try {
      const response = await organizerRequest(
        `/api/organizer/events/${encodeURIComponent(eventId)}/publication/actions`,
        {
          body: JSON.stringify({
            action,
            expectedContentVersion: workspace.event.contentVersion,
            expectedScheduleVersion: workspace.event.scheduleVersion,
            ...(action === "schedule_publication"
              ? {
                  originalTimezone: publicationTimezone,
                  requestedPublicationLocal: `${publicationDate}T${publicationTime}`,
                }
              : {}),
          }),
          method: "POST",
        },
      );
      onNotice(actionOutcomeNotice(action, response));
      window.location.reload();
    } catch (error) {
      onNotice(
        safeNotice(
          error,
          "The website publication action was not completed. No success is being assumed.",
        ),
      );
    } finally {
      setActing(false);
      onBusyChange(false);
    }
  }

  const status = workspace.event.publicationStatus;
  return (
    <div className={styles.publicationActions}>
      {workspace.pendingJob ? (
        <p>
          Scheduled for{" "}
          <strong>
            {formatDateTime(
              workspace.pendingJob.requestedPublicationAtUtc,
              workspace.pendingJob.originalTimezone,
            )}
          </strong>
          . Publication runs on the first relevant request at or after that
          time; there is no background cron promise.
        </p>
      ) : null}
      {(status === "private" || status === "unpublished") &&
      workspace.permissions.canPublish ? (
        <button
          className={styles.primaryButton}
          disabled={acting || !workspace.readiness.ready}
          onClick={() => void act("publish")}
          type="button"
        >
          Publish to Website
        </button>
      ) : null}
      {(status === "private" ||
        status === "scheduled" ||
        status === "unpublished") &&
      workspace.permissions.canSchedule ? (
        <div className={styles.schedulePublication}>
          <h4>Schedule website publication</h4>
          <label>
            <span>Date</span>
            <input
              onChange={(event) => setPublicationDate(event.target.value)}
              type="date"
              value={publicationDate}
            />
          </label>
          <label>
            <span>Time</span>
            <input
              onChange={(event) => setPublicationTime(event.target.value)}
              type="time"
              value={publicationTime}
            />
          </label>
          <label>
            <span>IANA timezone</span>
            <input
              maxLength={255}
              onChange={(event) => setPublicationTimezone(event.target.value)}
              spellCheck={false}
              value={publicationTimezone}
            />
          </label>
          <button
            className={styles.secondaryButton}
            disabled={
              acting ||
              !workspace.readiness.ready ||
              !publicationDate ||
              !publicationTime ||
              !publicationTimezone
            }
            onClick={() => void act("schedule_publication")}
            type="button"
          >
            {status === "scheduled" ? "Reschedule publication" : "Schedule publication"}
          </button>
        </div>
      ) : null}
      {status === "scheduled" &&
      workspace.permissions.canCancelScheduledPublication ? (
        <button
          className={styles.secondaryButton}
          disabled={acting}
          onClick={() => void act("cancel_scheduled_publication")}
          type="button"
        >
          Cancel scheduled publication
        </button>
      ) : null}
      {status === "published" && workspace.permissions.canUnpublish ? (
        <button
          className={styles.secondaryButton}
          disabled={acting}
          onClick={() => void act("unpublish")}
          type="button"
        >
          Unpublish from Website
        </button>
      ) : null}
      {status === "published" &&
      workspace.event.planningStatus !== "cancelled" ? (
        <p>
          To cancel the event while keeping its public page as a truthful
          cancellation notice, use the event lifecycle controls above.
        </p>
      ) : null}
      {workspace.publicPath && status === "published" ? (
        <Link href={workspace.publicPath}>View public page</Link>
      ) : null}
      {!workspace.readiness.ready ? (
        <p>Resolve the readiness items above before publishing or scheduling.</p>
      ) : null}
    </div>
  );
}

function PublicationState({
  planningStatus,
  status,
}: Readonly<{ planningStatus: string; status: PublicationStatus }>) {
  const label =
    status === "published" && planningStatus === "cancelled"
      ? "Published — Cancelled"
      : status[0]?.toUpperCase() + status.slice(1);
  return <strong className={styles.publicationState}>{label}</strong>;
}

function TextField({
  label,
  maxLength = 2_048,
  onChange,
  type = "text",
  value,
}: Readonly<{
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  type?: "text" | "url";
  value: string;
}>) {
  return (
    <label>
      <span>{label}</span>
      <input
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={type !== "url"}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({
  label,
  maxLength = 5_000,
  onChange,
  rows = 4,
  value,
}: Readonly<{
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}>) {
  return (
    <label>
      <span>{label}</span>
      <textarea
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function parseWorkspaceResponse(value: unknown): PublicationWorkspaceView {
  if (!isRecord(value) || !("workspace" in value)) {
    throw new TypeError("Unexpected publication workspace response");
  }
  return parseWorkspace(value.workspace);
}

function parseWorkspace(value: unknown): PublicationWorkspaceView {
  if (
    !isRecord(value) ||
    !isRecord(value.event) ||
    !isRecord(value.permissions) ||
    !isRecord(value.readiness) ||
    !Array.isArray(value.artworkOptions) ||
    !Array.isArray(value.hostOptions) ||
    !Array.isArray(value.readiness.missing)
  ) {
    throw new TypeError("Unexpected publication workspace");
  }
  const rawDetails =
    value.details === null || value.details === undefined
      ? {}
      : isRecord(value.details)
        ? value.details
        : null;
  if (rawDetails === null) {
    throw new TypeError("Unexpected publication details");
  }
  const event = value.event;
  const details = rawDetails;
  const permissions = value.permissions;
  const publicationStatus = requiredPublicationStatus(event.publicationStatus);
  const artworkOptions = Object.freeze(
    value.artworkOptions.map(parseArtworkOption),
  );
  const hostOptions = Object.freeze(value.hostOptions.map(parseHostOption));
  const missing = Object.freeze(value.readiness.missing.map(parseMissingItem));
  const pendingJob =
    value.pendingJob === null || value.pendingJob === undefined
      ? null
      : parsePendingJob(value.pendingJob);
  return Object.freeze({
    artworkOptions,
    details: Object.freeze({
      arrivalInstructions: optionalText(details.arrivalInstructions),
      attendanceMode: requiredAttendanceMode(
        details.attendanceMode ?? "location_undecided",
      ),
      artworkAssetId:
        typeof details.artworkAssetId === "string"
          ? details.artworkAssetId
          : null,
      availabilityState: requiredAvailabilityState(
        details.availabilityState ?? "open",
      ),
      capacity:
        typeof details.capacity === "number" &&
        Number.isSafeInteger(details.capacity) &&
        details.capacity > 0
          ? details.capacity
          : null,
      costText: optionalText(details.costText),
      externalMapUrl: optionalText(details.externalMapUrl),
      metaDescription: optionalText(details.metaDescription),
      meetupUrlConfirmed: details.meetupUrlConfirmed === true,
      preparationInformation: optionalText(details.preparationInformation),
      publicAccessNote: optionalText(details.publicAccessNote),
      publicAddress: optionalText(details.publicAddress),
      publicHostsEnabled: details.publicHostsEnabled === true,
      publicLocationName: optionalText(details.publicLocationName),
      publicOnlineUrl: optionalText(details.publicOnlineUrl),
      rsvpMode: details.rsvpMode === "meetup" ? "meetup" : "coming_soon",
      seoTitle: optionalText(details.seoTitle),
      verifiedAccessibilityNotes: optionalText(
        details.verifiedAccessibilityNotes,
      ),
      weatherNote: optionalText(details.weatherNote),
      whatToBring: optionalText(details.whatToBring),
    }),
    event: Object.freeze({
      contentVersion: requiredPositiveInteger(event.contentVersion),
      id: requiredText(event.id),
      meetupEventUrl:
        typeof event.meetupEventUrl === "string" ? event.meetupEventUrl : null,
      planningStatus: requiredText(event.planningStatus),
      publicationStatus,
      scheduleVersion: requiredPositiveInteger(event.scheduleVersion),
      slug: requiredText(event.slug),
      title: requiredText(event.title),
    }),
    hostOptions,
    pendingJob,
    permissions: Object.freeze({
      canCancelScheduledPublication:
        permissions.canCancelScheduledPublication === true,
      canEditPublicDetails: permissions.canEditPublicDetails === true,
      canPreview: permissions.canPreview === true,
      canPublish: permissions.canPublish === true,
      canSchedule: permissions.canSchedule === true,
      canUnpublish: permissions.canUnpublish === true,
    }),
    publicPath: typeof value.publicPath === "string" ? value.publicPath : null,
    readiness: Object.freeze({
      missing,
      ready: value.readiness.ready === true,
    }),
  });
}

function editableDetails(workspace: PublicationWorkspaceView): EditableDetails {
  return Object.freeze({
    ...workspace.details,
    publicHostProfileIds: Object.freeze(
      workspace.hostOptions
        .filter((host) => host.selected)
        .map((host) => host.profileId),
    ),
  });
}

function parseArtworkOption(value: unknown): ArtworkOptionView {
  if (!isRecord(value)) throw new TypeError("Unexpected artwork option");
  return Object.freeze({
    assetId: requiredText(value.assetId),
    label: requiredText(value.label),
    selected: value.selected === true,
  });
}

function parseHostOption(value: unknown): HostOptionView {
  if (!isRecord(value)) throw new TypeError("Unexpected public host option");
  return Object.freeze({
    displayName: requiredText(value.displayName),
    eligible: value.eligible === true,
    profileId: requiredText(value.profileId),
    selected: value.selected === true,
  });
}

function parseMissingItem(
  value: unknown,
): PublicationWorkspaceView["readiness"]["missing"][number] {
  if (!isRecord(value)) throw new TypeError("Unexpected readiness item");
  return Object.freeze({
    code: requiredText(value.code),
    field: typeof value.field === "string" ? value.field : null,
    label: requiredText(value.label),
  });
}

function parsePendingJob(
  value: unknown,
): NonNullable<PublicationWorkspaceView["pendingJob"]> {
  if (!isRecord(value)) throw new TypeError("Unexpected publication job");
  return Object.freeze({
    originalTimezone: requiredText(value.originalTimezone),
    requestedPublicationAtUtc: requiredNonnegativeInteger(
      value.requestedPublicationAtUtc,
    ),
  });
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Expected non-empty text");
  }
  return value;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requiredPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Expected a positive integer");
  }
  return value;
}

function requiredNonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Expected a nonnegative integer");
  }
  return value;
}

function requiredPublicationStatus(value: unknown): PublicationStatus {
  if (
    value !== "private" &&
    value !== "published" &&
    value !== "scheduled" &&
    value !== "unpublished"
  ) {
    throw new TypeError("Unexpected publication status");
  }
  return value;
}

function requiredAttendanceMode(
  value: unknown,
): PublicDetailsView["attendanceMode"] {
  if (
    value !== "hybrid" &&
    value !== "in_person" &&
    value !== "location_undecided" &&
    value !== "online"
  ) {
    throw new TypeError("Unexpected attendance mode");
  }
  return value;
}

function requiredAvailabilityState(
  value: unknown,
): PublicDetailsView["availabilityState"] {
  if (value !== "full" && value !== "open" && value !== "waitlist") {
    throw new TypeError("Unexpected availability state");
  }
  return value;
}

function optional(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function actionConfirmation(action: "publish" | "unpublish"): string {
  if (action === "publish") {
    return "Publish this confirmed event to the website now?";
  }
  return "Unpublish this event? Its public page and discovery entries will be removed.";
}

function actionOutcomeNotice(action: string, value: unknown): string {
  const outcome =
    isRecord(value) && typeof value.outcome === "string" ? value.outcome : action;
  if (outcome === "published" || action === "publish") {
    return "Published to the website.";
  }
  if (
    outcome === "publication_scheduled" ||
    action === "schedule_publication"
  ) {
    return "Website publication scheduled. It will run on the first relevant request at or after the chosen time.";
  }
  if (
    outcome === "publication_cancelled" ||
    action === "cancel_scheduled_publication"
  ) {
    return "Scheduled website publication cancelled.";
  }
  if (outcome === "unpublished" || action === "unpublish") {
    return "The event was unpublished from the website.";
  }
  return "The requested website publication action completed.";
}

function formatDateTime(value: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
