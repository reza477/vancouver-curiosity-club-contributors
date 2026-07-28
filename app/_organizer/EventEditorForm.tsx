"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isRecord, organizerRequest, safeNotice } from "./client";
import {
  eventEditorApiInput,
  reconcileEventEditorClubSelection,
  type EventEditorValue,
} from "./event-editor-state";
import type { OrganizerEventFormOptions } from "./types";
import styles from "./workspace.module.css";

export function EventEditorForm({
  canManageOrganizationWide,
  currentActorProfileId,
  eventId,
  initialValue,
  mode,
  options,
}: Readonly<{
  canManageOrganizationWide: boolean;
  currentActorProfileId: string;
  eventId?: string;
  initialValue: EventEditorValue;
  mode: "create" | "edit";
  options: OrganizerEventFormOptions;
}>) {
  const router = useRouter();
  const summaryRef = useRef<HTMLDivElement>(null);
  const scheduleHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewSequenceRef = useRef(0);
  const [value, setValue] = useState(initialValue);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ConflictPreviewState>({
    conflicts: [],
    kind: "idle",
    message: "Choose a real schedule to check for coordination conflicts.",
  });

  function update<K extends keyof EventEditorValue>(
    key: K,
    next: EventEditorValue[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  const previewFingerprint = conflictPreviewFingerprint(value, eventId);
  useEffect(() => {
    const sequence = ++previewSequenceRef.current;
    const controller = new AbortController();
    if (previewFingerprint === null) {
      const idleTimer = window.setTimeout(() => {
        if (previewSequenceRef.current !== sequence) return;
        setPreview({
          conflicts: [],
          kind: "idle",
          message: "Choose a real schedule to check for coordination conflicts.",
        });
      }, 0);
      return () => {
        window.clearTimeout(idleTimer);
        controller.abort();
      };
    }

    const timer = window.setTimeout(async () => {
      if (previewSequenceRef.current !== sequence) return;
      setPreview((current) => ({
        ...current,
        kind: "checking",
        message: "Checking the current private schedule…",
      }));
      try {
        const body = await organizerRequest("/api/organizer/conflicts/preview", {
          body: previewFingerprint,
          method: "POST",
          signal: controller.signal,
        });
        if (previewSequenceRef.current !== sequence) return;
        const conflicts = parseConflictPreview(body);
        setPreview({
          conflicts,
          kind: "ready",
          message:
            conflicts.length === 0
              ? "No current conflict was found. Final save will check D1 again."
              : `${conflicts.length} current ${conflicts.length === 1 ? "conflict" : "conflicts"} found. Final save will check D1 again.`,
        });
      } catch {
        if (controller.signal.aborted || previewSequenceRef.current !== sequence) {
          return;
        }
        setPreview({
          conflicts: [],
          kind: "unavailable",
          message:
            "Advisory preview is unavailable. No safety claim is being made; final save still checks D1.",
        });
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [previewFingerprint]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validate(value);
    setErrors(nextErrors);
    setNotice("");
    if (nextErrors.length > 0) {
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    setBusy(true);
    try {
      const body = await organizerRequest(
        mode === "create"
          ? "/api/organizer/events"
          : `/api/organizer/events/${encodeURIComponent(eventId ?? "")}`,
        {
          body: JSON.stringify(
            mode === "create"
              ? eventEditorApiInput(value)
              : {
                  conflictReason: conflictReason.trim() || null,
                  event: eventEditorApiInput(value),
                  expectedContentVersion: value.expectedEditVersion,
                  expectedScheduleVersion: value.expectedScheduleVersion,
                },
          ),
          method: mode === "create" ? "POST" : "PATCH",
        },
      );
      if (
        isRecord(body) &&
        body.outcome === "pending_approval" &&
        typeof body.reviewRequestId === "string" &&
        isRecord(body.event)
      ) {
        setNotice(
          "Approval requested. The current reservation remains unchanged until an authorized reviewer approves this exact schedule.",
        );
        return;
      }
      if (!isRecord(body) || !isRecord(body.event) || typeof body.event.id !== "string") {
        throw new TypeError("Unexpected event response");
      }
      setNotice(mode === "create" ? "Private planning record created." : "Changes saved.");
      if (mode === "create") {
        router.replace(`/organizer/events/${encodeURIComponent(body.event.id)}`);
      } else {
        router.refresh();
      }
    } catch (error) {
      const fallback =
        mode === "create"
          ? "The private planning record could not be created."
          : "Your changes were not saved.";
      const message = safeNotice(error, fallback);
      setErrors([message]);
      setNotice(message);
      window.requestAnimationFrame(() => summaryRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const selectedClub = value.clubId;
  const availablePrograms = options.programs.filter(
    (program) => !selectedClub || program.clubId === selectedClub,
  );
  const clubScopedOrganizers = options.organizers.filter(
    (organizer) =>
      organizer.organizationWide ||
      !selectedClub ||
      organizer.clubs.some((clubId) => clubId === selectedClub),
  );
  const availableOrganizers = clubScopedOrganizers;
  const primaryOrganizerOptions = canManageOrganizationWide
    ? clubScopedOrganizers
    : options.organizers.filter(
        (organizer) =>
          organizer.id ===
          (value.primaryOrganizerProfileId || currentActorProfileId),
      );
  const primaryOrganizerLocked =
    !canManageOrganizationWide &&
    value.primaryOrganizerProfileId !== currentActorProfileId;
  const venueOptions = (options.venues ?? []).filter(
    (venue) => !venue.archived || venue.id === value.venueId,
  );
  const planningIsEditable =
    value.planningStatus === "idea" || value.planningStatus === "draft";

  return (
    <form className={styles.eventForm} noValidate onSubmit={submit}>
      {errors.length > 0 ? (
        <div
          className={styles.errorSummary}
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
        >
          <h2>Review this form</h2>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className={styles.formSection} aria-labelledby="event-basics-title">
        <header>
          <p className={styles.kicker}>1 · Planning record</p>
          <h2 id="event-basics-title">What are you considering?</h2>
          <p>
            Start with the title and the club responsible for this private
            planning record.
          </p>
        </header>
        <div className={styles.formFields}>
          <label className={styles.fieldFull}>
            <span>Title <strong aria-hidden="true">*</strong></span>
            <input
              autoComplete="off"
              maxLength={180}
              onChange={(event) => update("title", event.target.value)}
              required
              value={value.title}
            />
          </label>
          <label>
            <span>Club <strong aria-hidden="true">*</strong></span>
            <select
              onChange={(event) => {
                const nextClubId = event.target.value;
                setValue((current) =>
                  reconcileEventEditorClubSelection(
                    current,
                    nextClubId,
                    options.organizers,
                    currentActorProfileId,
                  ),
                );
              }}
              required
              value={value.clubId}
            >
              <option value="">Choose a club</option>
              {options.clubs.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-schedule-title">
        <header>
          <p className={styles.kicker}>2 · Schedule</p>
          <h2 id="event-schedule-title" ref={scheduleHeadingRef} tabIndex={-1}>
            When might it happen?
          </h2>
          <p>
            An Idea may remain unscheduled. A Draft needs a real timed or
            all-day schedule.
          </p>
        </header>
        <div className={styles.formFields}>
          <fieldset className={styles.segmentedFieldset}>
            <legend>Schedule shape</legend>
            {[
              ["unscheduled", "Unscheduled"],
              ["timed", "Timed"],
              ["all_day", "All day"],
            ].map(([id, label]) => (
              <label key={id}>
                <input
                  checked={value.scheduleShape === id}
                  name="scheduleShape"
                  onChange={() =>
                    update(
                      "scheduleShape",
                      id as EventEditorValue["scheduleShape"],
                    )
                  }
                  type="radio"
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          {value.scheduleShape === "timed" ? (
            <>
              <label>
                <span>Start date <strong aria-hidden="true">*</strong></span>
                <input onChange={(event) => update("startDate", event.target.value)} required type="date" value={value.startDate} />
              </label>
              <label>
                <span>Start time <strong aria-hidden="true">*</strong></span>
                <input onChange={(event) => update("startTime", event.target.value)} required type="time" value={value.startTime} />
              </label>
              <label>
                <span>End date <strong aria-hidden="true">*</strong></span>
                <input onChange={(event) => update("endDate", event.target.value)} required type="date" value={value.endDate} />
              </label>
              <label>
                <span>End time <strong aria-hidden="true">*</strong></span>
                <input onChange={(event) => update("endTime", event.target.value)} required type="time" value={value.endTime} />
              </label>
            </>
          ) : null}

          {value.scheduleShape === "all_day" ? (
            <>
              <label>
                <span>First day <strong aria-hidden="true">*</strong></span>
                <input onChange={(event) => update("allDayStartDate", event.target.value)} required type="date" value={value.allDayStartDate} />
              </label>
              <label>
                <span>End date, exclusive <strong aria-hidden="true">*</strong></span>
                <input
                  aria-describedby="all-day-end-help"
                  onChange={(event) => update("allDayEndDateExclusive", event.target.value)}
                  required
                  type="date"
                  value={value.allDayEndDateExclusive}
                />
                <small id="all-day-end-help">For one day, choose the following date.</small>
              </label>
            </>
          ) : null}

          {value.scheduleShape !== "unscheduled" ? (
            <label className={styles.fieldFull}>
              <span>Original timezone <strong aria-hidden="true">*</strong></span>
              <input
                autoComplete="off"
                list="organizer-timezones"
                onChange={(event) => update("timezone", event.target.value)}
                required
                value={value.timezone}
              />
              <datalist id="organizer-timezones">
                <option value="America/Vancouver" />
                <option value="America/Toronto" />
                <option value="America/New_York" />
                <option value="Europe/London" />
                <option value="UTC" />
              </datalist>
              <small>Use an IANA timezone such as America/Vancouver, never a fixed UTC offset.</small>
            </label>
          ) : null}
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-team-title">
        <header>
          <p className={styles.kicker}>3 · People</p>
          <h2 id="event-team-title">Who is coordinating?</h2>
          <p>Organizer choices are limited to active assignments for this club.</p>
        </header>
        <div className={styles.formFields}>
          <label className={styles.fieldFull}>
            <span>Primary organizer <strong aria-hidden="true">*</strong></span>
            <select
              disabled={primaryOrganizerLocked}
              onChange={(event) => update("primaryOrganizerProfileId", event.target.value)}
              required
              value={value.primaryOrganizerProfileId}
            >
              <option value="">Choose an organizer</option>
              {primaryOrganizerOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            {primaryOrganizerLocked ? (
              <small>
                As a co-organizer, you may edit the record but cannot reassign its primary organizer.
              </small>
            ) : null}
          </label>
          <fieldset className={`${styles.checkboxGroup} ${styles.fieldFull}`}>
            <legend>Co-organizers</legend>
            {availableOrganizers
              .filter((organizer) => organizer.id !== value.primaryOrganizerProfileId)
              .map((organizer) => (
                <label key={organizer.id}>
                  <input
                    checked={value.coOrganizerProfileIds.includes(organizer.id)}
                    disabled={
                      primaryOrganizerLocked ||
                      (!value.coOrganizerProfileIds.includes(organizer.id) &&
                        value.coOrganizerProfileIds.length >= 12)
                    }
                    onChange={(event) =>
                      update(
                        "coOrganizerProfileIds",
                        event.target.checked
                          ? [...value.coOrganizerProfileIds, organizer.id]
                          : value.coOrganizerProfileIds.filter((id) => id !== organizer.id),
                      )
                    }
                    type="checkbox"
                  />
                  <span>{organizer.label}</span>
                </label>
              ))}
            {availableOrganizers.length <= 1 ? (
              <p>No additional active organizer is available for this club.</p>
            ) : primaryOrganizerLocked ? (
              <p>
                As a co-organizer, you may edit event details but cannot change
                the primary organizer or co-organizer team.
              </p>
            ) : (
              <p>
                Choose up to 12 co-organizers. Organization-wide roles and
                club-assigned Organizers only.
              </p>
            )}
          </fieldset>
          <label className={styles.fieldFull}>
            <span>Venue</span>
            <select
              onChange={(event) =>
                update("venueId", event.target.value || null)
              }
              value={value.venueId ?? ""}
            >
              <option value="">No venue selected</option>
              {venueOptions.map((venue) => (
                <option
                  disabled={venue.archived}
                  key={venue.id}
                  value={venue.id}
                >
                  {venue.label}
                  {venue.archived ? " — archived, retained" : ""}
                </option>
              ))}
            </select>
            <small>
              Only active private workspace venues can be selected. Venue
              publishing is not available here.
            </small>
          </label>
          <label>
            <span>Setup buffer, minutes</span>
            <input
              max={1_440}
              min={0}
              onChange={(event) =>
                update("setupBufferMinutes", Number(event.target.value))
              }
              step={5}
              type="number"
              value={value.setupBufferMinutes}
            />
          </label>
          <label>
            <span>Cleanup or travel buffer, minutes</span>
            <input
              max={1_440}
              min={0}
              onChange={(event) =>
                update("cleanupBufferMinutes", Number(event.target.value))
              }
              step={5}
              type="number"
              value={value.cleanupBufferMinutes}
            />
          </label>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-state-title">
        <header>
          <p className={styles.kicker}>4 · State and coordination</p>
          <h2 id="event-state-title">How should this private record be saved?</h2>
          <p>
            Reserving transitions use the separate Hold and Confirm actions
            after the record exists. Every final save rechecks current D1 state.
          </p>
        </header>
        <div className={styles.formFields}>
          {planningIsEditable ? (
            <label>
              <span>
                Planning status <strong aria-hidden="true">*</strong>
              </span>
              <select
                onChange={(event) =>
                  update(
                    "planningStatus",
                    event.target.value as "draft" | "idea",
                  )
                }
                value={value.planningStatus}
              >
                <option value="idea">Idea</option>
                <option value="draft">Draft</option>
              </select>
            </label>
          ) : (
            <div className={styles.fixedField}>
              <span>Planning status</span>
              <strong>{planningStatusLabel(value.planningStatus)}</strong>
              <small>Use the explicit lifecycle actions on the event page.</small>
            </div>
          )}
          <div className={styles.fixedField}>
            <span>Publication</span>
            <strong>Managed below</strong>
            <small>
              Save the canonical event here, then use Website publication on
              the event page.
            </small>
          </div>
          <div
            aria-busy={preview.kind === "checking"}
            className={`${styles.conflictPreview} ${styles.fieldFull}`}
          >
            <header>
              <div>
                <span className={styles.kicker}>Advisory preview</span>
                <h3>Current schedule conflicts</h3>
              </div>
              <span className={styles.previewState}>
                {preview.kind === "checking" ? "Checking…" : "D1 rechecks on save"}
              </span>
            </header>
            <p aria-atomic="true" aria-live="polite">
              {preview.message}
            </p>
            {preview.conflicts.length > 0 ? (
              <>
                <ol className={styles.conflictPreviewList}>
                  {preview.conflicts.map((conflict) => (
                    <li key={conflict.id}>
                      <article>
                      <header>
                        <div>
                          <strong>{conflict.title}</strong>
                          <span>
                            {conflict.clubName} · {conflict.organizerName}
                          </span>
                        </div>
                        <span>
                          {conflict.classification === "direct"
                            ? "Direct overlap"
                            : "Buffer conflict"}
                        </span>
                      </header>
                      <p>{conflict.scheduleLabel}</p>
                      <p>
                        <strong>Overlap:</strong> {conflict.overlapLabel}
                      </p>
                      <ul aria-label="Conflict resources">
                        {conflict.resources.map((resource) => (
                          <li key={`${resource.type}:${resource.label}`}>
                            {resource.label}
                          </li>
                        ))}
                      </ul>
                      <p>
                        {conflict.planningStatus} · {conflict.sourceLabel}
                        {conflict.readOnly ? " · read-only" : ""}
                      </p>
                      <div className={styles.conflictLinks}>
                        {conflict.readOnly ? (
                          <span>Read-only source event</span>
                        ) : (
                          <a
                            href={`/organizer/events/${encodeURIComponent(conflict.eventId)}`}
                          >
                            View event
                          </a>
                        )}
                        <button
                          onClick={() => {
                            scheduleHeadingRef.current?.focus();
                            scheduleHeadingRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          type="button"
                        >
                          Change time
                        </button>
                      </div>
                      </article>
                    </li>
                  ))}
                </ol>
                {!planningIsEditable ? (
                  <label className={styles.fieldFull}>
                    <span>
                      Coordination reason, when workspace policy requires it
                    </span>
                    <textarea
                      maxLength={1_000}
                      onChange={(event) =>
                        setConflictReason(event.target.value)
                      }
                      rows={4}
                      value={conflictReason}
                    />
                    <small>
                      This is private and applies only to the exact schedule
                      versions rechecked when you save.
                    </small>
                  </label>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-details-title">
        <header>
          <p className={styles.kicker}>4 · Working details</p>
          <h2 id="event-details-title">Notes for the team</h2>
          <p>
            Public-facing copy remains private until an explicit, authorized
            website publication succeeds. Private notes never enter the public
            event projection.
          </p>
        </header>
        <div className={styles.formFields}>
          <label>
            <span>Program</span>
            <select
              disabled={!value.clubId}
              onChange={(event) => update("programId", event.target.value)}
              value={value.programId}
            >
              <option value="">No program</option>
              {availablePrograms.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Lane</span>
            <select
              onChange={(event) => update("laneId", event.target.value)}
              value={value.laneId}
            >
              <option value="">No lane selected</option>
              {selectableTaxonomyOptions(options.lanes, value.laneId).map(
                (option) => (
                  <option
                    disabled={option.archived}
                    key={option.id}
                    value={option.id}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
            {selectedArchivedTaxonomyOption(
              options.lanes,
              value.laneId,
            ) ? (
              <small>
                This archived lane is retained for the existing event. Choose
                an active lane to replace it.
              </small>
            ) : null}
          </label>
          <label>
            <span>Category</span>
            <select
              onChange={(event) => update("categoryId", event.target.value)}
              value={value.categoryId}
            >
              <option value="">No category selected</option>
              {selectableTaxonomyOptions(
                options.categories,
                value.categoryId,
              ).map((option) => (
                <option
                  disabled={option.archived}
                  key={option.id}
                  value={option.id}
                >
                  {option.label}
                </option>
              ))}
            </select>
            {selectedArchivedTaxonomyOption(
              options.categories,
              value.categoryId,
            ) ? (
              <small>
                This archived category is retained for the existing event.
                Choose an active category to replace it.
              </small>
            ) : null}
          </label>
          <label className={styles.fieldFull}>
            <span>Private organizer notes</span>
            <textarea
              maxLength={10_000}
              onChange={(event) => update("internalNotes", event.target.value)}
              rows={6}
              value={value.internalNotes}
            />
          </label>
          <label className={styles.fieldFull}>
            <span>Public summary</span>
            <textarea
              maxLength={500}
              onChange={(event) => update("publicSummary", event.target.value)}
              rows={3}
              value={value.publicSummary}
            />
          </label>
          <label className={styles.fieldFull}>
            <span>Public description</span>
            <textarea
              maxLength={20_000}
              onChange={(event) => update("publicDescription", event.target.value)}
              rows={7}
              value={value.publicDescription}
            />
          </label>
          <label className={styles.fieldFull}>
            <span>Real Meetup event URL, if one already exists</span>
            <input
              inputMode="url"
              maxLength={2048}
              onChange={(event) => update("meetupEventUrl", event.target.value)}
              placeholder="https://www.meetup.com/.../events/..."
              spellCheck={false}
              type="url"
              value={value.meetupEventUrl}
            />
            <small>This does not turn the manual record into a synced source record.</small>
          </label>
        </div>
      </section>

      <footer className={styles.formFooter}>
        <button className={styles.primaryButton} disabled={busy} type="submit">
          {busy ? "Saving…" : mode === "create" ? "Create private record" : "Save changes"}
        </button>
        <button className={styles.secondaryButton} onClick={() => router.back()} type="button">
          Cancel
        </button>
        <p aria-live="polite">{notice}</p>
      </footer>
    </form>
  );
}

function selectableTaxonomyOptions(
  options: OrganizerEventFormOptions["categories"],
  selectedId: string,
) {
  return options.filter(
    (option) => !option.archived || option.id === selectedId,
  );
}

function selectedArchivedTaxonomyOption(
  options: OrganizerEventFormOptions["categories"],
  selectedId: string,
) {
  return (
    selectedId.length > 0 &&
    options.some(
      (option) => option.id === selectedId && option.archived === true,
    )
  );
}

function validate(value: EventEditorValue): readonly string[] {
  const errors: string[] = [];
  if (!value.title.trim()) errors.push("Add a title.");
  if (!value.clubId) errors.push("Choose a club.");
  if (!value.primaryOrganizerProfileId) errors.push("Choose a primary organizer.");
  if (value.coOrganizerProfileIds.length > 12) {
    errors.push("Choose no more than 12 co-organizers.");
  }
  if (value.planningStatus === "draft" && value.scheduleShape === "unscheduled") {
    errors.push("A Draft needs a timed or all-day schedule.");
  }
  if (
    (value.planningStatus === "tentative_hold" ||
      value.planningStatus === "confirmed") &&
    value.scheduleShape === "unscheduled"
  ) {
    errors.push("A hold or confirmed event needs a real schedule.");
  }
  if (value.scheduleShape === "timed") {
    if (!value.startDate || !value.startTime || !value.endDate || !value.endTime) {
      errors.push("Complete the timed start and end.");
    } else if (`${value.endDate}T${value.endTime}` <= `${value.startDate}T${value.startTime}`) {
      errors.push("The timed end must be after the start.");
    }
  }
  if (value.scheduleShape === "all_day") {
    if (!value.allDayStartDate || !value.allDayEndDateExclusive) {
      errors.push("Complete the all-day date range.");
    } else if (value.allDayEndDateExclusive <= value.allDayStartDate) {
      errors.push("The all-day exclusive end date must be after the first day.");
    }
  }
  if (value.scheduleShape !== "unscheduled" && !value.timezone.trim()) {
    errors.push("Add the original IANA timezone.");
  }
  if (value.meetupEventUrl && !isValidHttpsUrl(value.meetupEventUrl)) {
    errors.push("Enter a valid HTTPS Meetup event URL or leave it blank.");
  }
  if (
    !Number.isSafeInteger(value.setupBufferMinutes) ||
    value.setupBufferMinutes < 0 ||
    value.setupBufferMinutes > 1_440 ||
    !Number.isSafeInteger(value.cleanupBufferMinutes) ||
    value.cleanupBufferMinutes < 0 ||
    value.cleanupBufferMinutes > 1_440
  ) {
    errors.push("Buffers must be whole minutes from 0 through 1440.");
  }
  return errors;
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "www.meetup.com" &&
      /^\/[A-Za-z0-9_-]+\/events\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

type ConflictPreviewResource = Readonly<{
  label: string;
  type: "co_organizer" | "organization" | "organizer" | "venue";
}>;

type ConflictPreviewItem = Readonly<{
  classification: "buffer" | "direct";
  clubName: string;
  eventId: string;
  id: string;
  organizerName: string;
  overlapLabel: string;
  planningStatus: string;
  readOnly: boolean;
  resources: readonly ConflictPreviewResource[];
  scheduleLabel: string;
  sourceLabel: string;
  title: string;
}>;

type ConflictPreviewState = Readonly<{
  conflicts: readonly ConflictPreviewItem[];
  kind: "checking" | "idle" | "ready" | "unavailable";
  message: string;
}>;

function conflictPreviewFingerprint(
  value: EventEditorValue,
  eventId: string | undefined,
): string | null {
  if (
    !value.clubId ||
    !value.primaryOrganizerProfileId ||
    value.scheduleShape === "unscheduled"
  ) {
    return null;
  }
  const schedule =
    value.scheduleShape === "timed"
      ? value.startDate &&
        value.startTime &&
        value.endDate &&
        value.endTime &&
        value.timezone
        ? {
            endLocal: `${value.endDate}T${value.endTime}`,
            shape: "timed",
            startLocal: `${value.startDate}T${value.startTime}`,
            timeZone: value.timezone,
          }
        : null
      : value.allDayStartDate &&
          value.allDayEndDateExclusive &&
          value.timezone
        ? {
            allDayEndDateExclusive: value.allDayEndDateExclusive,
            allDayStartDate: value.allDayStartDate,
            shape: "all_day",
            timeZone: value.timezone,
          }
        : null;
  if (!schedule) return null;
  return JSON.stringify({
    bufferAfterMinutes: value.cleanupBufferMinutes,
    bufferBeforeMinutes: value.setupBufferMinutes,
    clubId: value.clubId,
    coOrganizerProfileIds: [...value.coOrganizerProfileIds].sort(),
    eventId: eventId ?? null,
    expectedScheduleVersion: value.expectedScheduleVersion,
    planningStatus: value.planningStatus,
    primaryOrganizerProfileId: value.primaryOrganizerProfileId,
    schedule,
    venueId: value.venueId,
  });
}

function parseConflictPreview(value: unknown): readonly ConflictPreviewItem[] {
  if (!isRecord(value) || !Array.isArray(value.conflicts)) return [];
  return Object.freeze(
    value.conflicts.slice(0, 25).flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const id = boundedText(raw.id, 128);
      const eventId = boundedText(raw.eventId, 128);
      const title = boundedText(raw.title, 180);
      const clubName = boundedText(raw.clubName, 180);
      const organizerName = boundedText(raw.organizerName, 180);
      const planningStatus = boundedText(raw.planningStatus, 40);
      const scheduleLabel = boundedText(raw.scheduleLabel, 300);
      const overlapLabel = boundedText(raw.overlapLabel, 300);
      const sourceLabel = boundedText(raw.sourceLabel, 80);
      if (
        !id ||
        !eventId ||
        !title ||
        !clubName ||
        !organizerName ||
        !planningStatus ||
        !scheduleLabel ||
        !overlapLabel ||
        !sourceLabel ||
        (raw.classification !== "direct" && raw.classification !== "buffer")
      ) {
        return [];
      }
      const resources: ConflictPreviewResource[] = Array.isArray(raw.resources)
        ? raw.resources.slice(0, 16).flatMap((resource) => {
            if (!isRecord(resource)) return [];
            const label = boundedText(resource.label, 180);
            const type =
              resource.type === "organization" ||
              resource.type === "organizer" ||
              resource.type === "co_organizer" ||
              resource.type === "venue"
                ? resource.type
                : null;
            return label && type
              ? [Object.freeze({ label, type }) as ConflictPreviewResource]
              : [];
          })
        : [];
      return [
        Object.freeze({
          classification: raw.classification,
          clubName,
          eventId,
          id,
          organizerName,
          overlapLabel,
          planningStatus,
          readOnly: raw.readOnly === true,
          resources: Object.freeze(resources),
          scheduleLabel,
          sourceLabel,
          title,
        }),
      ];
    }),
  );
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function planningStatusLabel(value: EventEditorValue["planningStatus"]): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
