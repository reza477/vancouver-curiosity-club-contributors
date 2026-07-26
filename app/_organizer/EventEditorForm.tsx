"use client";

import { useRef, useState } from "react";
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
  const [value, setValue] = useState(initialValue);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function update<K extends keyof EventEditorValue>(
    key: K,
    next: EventEditorValue[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
  }

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
                  event: eventEditorApiInput(value),
                  expectedContentVersion: value.expectedEditVersion,
                },
          ),
          method: mode === "create" ? "POST" : "PATCH",
        },
      );
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
      setNotice(safeNotice(error, fallback));
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
            Phase 3 saves private Ideas and Drafts only. It cannot reserve a
            time or publish to the website.
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
            <select onChange={(event) => update("laneId", event.target.value)} value={value.laneId}>
              <option value="">No lane selected</option>
              {options.lanes.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select onChange={(event) => update("categoryId", event.target.value)} value={value.categoryId}>
              <option value="">No category selected</option>
              {options.categories.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Planning status <strong aria-hidden="true">*</strong></span>
            <select
              onChange={(event) =>
                update("planningStatus", event.target.value as "draft" | "idea")
              }
              value={value.planningStatus}
            >
              <option value="idea">Idea</option>
              <option value="draft">Draft</option>
            </select>
          </label>
          <div className={styles.fixedField}>
            <span>Publication</span>
            <strong>Private</strong>
            <small>Publication begins in a later authorized phase.</small>
          </div>
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-schedule-title">
        <header>
          <p className={styles.kicker}>2 · Schedule</p>
          <h2 id="event-schedule-title">When might it happen?</h2>
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
        </div>
      </section>

      <section className={styles.formSection} aria-labelledby="event-details-title">
        <header>
          <p className={styles.kicker}>4 · Working details</p>
          <h2 id="event-details-title">Notes for the team</h2>
          <p>
            Public-facing copy remains private in Phase 3. Private notes never
            enter the public event projection.
          </p>
        </header>
        <div className={styles.formFields}>
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
            <span>Draft public summary</span>
            <textarea
              maxLength={500}
              onChange={(event) => update("publicSummary", event.target.value)}
              rows={3}
              value={value.publicSummary}
            />
          </label>
          <label className={styles.fieldFull}>
            <span>Draft public description</span>
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
          <label>
            <span>Setup buffer, minutes</span>
            <input
              max={1_440}
              min={0}
              onChange={(event) => update("setupBufferMinutes", Number(event.target.value))}
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
              onChange={(event) => update("cleanupBufferMinutes", Number(event.target.value))}
              step={5}
              type="number"
              value={value.cleanupBufferMinutes}
            />
          </label>
          <p className={`${styles.fieldFull} ${styles.formNotice}`}>
            Buffers are stored for Phase 4 planning but do not reserve time or
            produce a conflict claim in Phase 3.
          </p>
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
