"use client";

import {
  CONTACT_TOPICS,
  HOST_FORMATS,
  PARTNERSHIP_TYPES,
  VOLUNTEER_INTERESTS,
  publicFormLabel,
  type PublicFormKey,
} from "@/lib/server/phase7/public-form-contract";
import { PUBLIC_FORM_MINIMUM_COMPLETION_MS } from "@/lib/server/phase7/public-form-protection";
import { useEffect, useId, useRef, useState } from "react";

export type PublicFormChoice = Readonly<{
  label: string;
  value: string;
}>;

type FormState = Readonly<Record<string, string | readonly string[]>>;
type FormInstanceState = "error" | "loading" | "ready" | "slow";
type FormInstanceGate = Readonly<{
  promise: Promise<string | null>;
  resolve(value: string | null): void;
}>;

const FORM_INSTANCE_SLOW_MS = 750;
const FORM_INSTANCE_TIMEOUT_MS = 10_000;

export function PublicSubmissionForm({
  choices = [],
  formKey,
  id,
}: Readonly<{
  choices?: readonly PublicFormChoice[];
  formKey: PublicFormKey;
  id?: string;
}>) {
  const [instanceToken, setInstanceToken] = useState("");
  const [instanceState, setInstanceState] =
    useState<FormInstanceState>("loading");
  const [instanceRequest, setInstanceRequest] = useState(0);
  const [instanceNotice, setInstanceNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState(false);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [values, setValues] = useState<FormState>(() =>
    initialValues(formKey),
  );
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const instanceGateRef = useRef<FormInstanceGate | null>(null);
  const instanceReceivedAtRef = useRef(0);
  const successRef = useRef<HTMLDivElement>(null);
  if (instanceGateRef.current === null) {
    instanceGateRef.current = createFormInstanceGate();
  }
  const reactInstanceId = useId().replaceAll(":", "");
  const idPrefix = `${formKey}-${reactInstanceId}`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const instanceGate =
      instanceGateRef.current ?? createFormInstanceGate();
    instanceGateRef.current = instanceGate;
    const slowTimer = window.setTimeout(() => {
      if (!active) return;
      setInstanceState((current) =>
        current === "loading" ? "slow" : current,
      );
    }, FORM_INSTANCE_SLOW_MS);
    const timeout = window.setTimeout(
      () => controller.abort(),
      FORM_INSTANCE_TIMEOUT_MS,
    );
    async function loadInstance() {
      try {
        const response = await fetch(
          `/api/forms/instance?form=${encodeURIComponent(formKey)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        const body = (await response.json()) as unknown;
        if (
          !response.ok ||
          !isRecord(body) ||
          typeof body.instanceToken !== "string"
        ) {
          throw new TypeError("Form instance unavailable");
        }
        if (!active) return;
        window.clearTimeout(slowTimer);
        instanceReceivedAtRef.current = Date.now();
        setInstanceToken(body.instanceToken);
        setInstanceState("ready");
        setInstanceNotice("");
        instanceGate.resolve(body.instanceToken);
      } catch (error) {
        if (!active) return;
        instanceGate.resolve(null);
        setInstanceState("error");
        setInstanceNotice(
          (error as { name?: unknown }).name === "AbortError"
            ? "The form is taking too long to load. Try again."
            : "The form is temporarily unavailable. Try again.",
        );
      } finally {
        window.clearTimeout(slowTimer);
        window.clearTimeout(timeout);
      }
    }
    void loadInstance();
    return () => {
      active = false;
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [formKey, instanceRequest]);

  useEffect(() => {
    if (!success) return;
    successRef.current?.focus();
  }, [success]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || instanceState === "error") return;
    setBusy(true);
    setNotice("");
    setErrors({});
    const formData = new FormData(event.currentTarget);
    try {
      const token =
        instanceToken ||
        (await instanceGateRef.current?.promise) ||
        null;
      if (!token) {
        throw new Error("The form is temporarily unavailable. Try again.");
      }
      await waitForMinimumFormCompletion(instanceReceivedAtRef.current);
      const response = await fetch(
        `/api/forms/${encodeURIComponent(formKey)}`,
        {
          body: JSON.stringify({
            companyFax: formData.get("companyFax"),
            instanceToken: token,
            payload: values,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as unknown;
      if (
        response.status === 422 &&
        isRecord(body) &&
        isRecord(body.error) &&
        isStringRecord(body.error.fieldErrors)
      ) {
        setErrors(body.error.fieldErrors);
        setNotice("Check the marked fields and try again.");
        requestAnimationFrame(() => errorSummaryRef.current?.focus());
        return;
      }
      if (
        !response.ok ||
        !isRecord(body) ||
        typeof body.message !== "string" ||
        typeof body.publicReference !== "string"
      ) {
        const message =
          isRecord(body) &&
          isRecord(body.error) &&
          typeof body.error.message === "string"
            ? body.error.message
            : "The submission could not be stored. Please try again.";
        throw new Error(message);
      }
      setSuccess(true);
      setNotice(body.message);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The submission could not be stored. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function update(field: string, value: string | readonly string[]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function retryInstance() {
    setInstanceToken("");
    instanceReceivedAtRef.current = 0;
    instanceGateRef.current = createFormInstanceGate();
    setInstanceState("loading");
    setInstanceNotice("");
    setInstanceRequest((current) => current + 1);
  }

  const title =
    formKey === "contact" ? "Feedback" : publicFormLabel(formKey);
  return (
    <section
      className="public-submission"
      data-form-key={formKey}
      id={id}
      aria-labelledby={`${idPrefix}-title`}
    >
      <div className="public-submission__heading">
        <p className="section-kicker">Send this to the organizers</p>
        <h2 id={`${idPrefix}-title`}>{title}</h2>
      </div>

      <noscript>
        <div
          className="public-submission__load-error public-submission__noscript"
          role="status"
        >
          <p>
            JavaScript is required to send this form. Your information has not been sent.
            Please enable JavaScript and reload this page.
          </p>
        </div>
      </noscript>

      {success ? (
        <div
          className="public-submission__success"
          id={`${idPrefix}-success`}
          ref={successRef}
          role="status"
          tabIndex={-1}
        >
          <p>{notice}</p>
        </div>
      ) : (
        <form
          acceptCharset="UTF-8"
          action={`/api/forms/${encodeURIComponent(formKey)}`}
          aria-busy={busy}
          className="public-submission__form"
          method="post"
          onSubmit={submit}
          ref={formRef}
        >
          <input name="instanceToken" type="hidden" value={instanceToken} />
          {Object.keys(errors).length > 0 ? (
            <div
              aria-labelledby={`${idPrefix}-error-summary-title`}
              className="public-submission__error-summary"
              ref={errorSummaryRef}
              role="alert"
              tabIndex={-1}
            >
              <h3 id={`${idPrefix}-error-summary-title`}>
                Check the following fields
              </h3>
              <ul>
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>
                    <a href={`#${errorTargetId(idPrefix, field)}`}>
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <TextField
            autoComplete="name"
            error={errors.name}
            idPrefix={idPrefix}
            label={formKey === "partnership" ? "Contact name" : "Name"}
            maxLength={100}
            minLength={2}
            name="name"
            onChange={(value) => update("name", value)}
            required
            value={stringValue(values.name)}
          />
          <TextField
            autoComplete="email"
            error={errors.replyEmail}
            idPrefix={idPrefix}
            label="Reply email"
            maxLength={254}
            minLength={3}
            name="replyEmail"
            onChange={(value) => update("replyEmail", value)}
            required
            type="email"
            value={stringValue(values.replyEmail)}
          />

          {formKey === "contact" ? (
            <>
              <SelectField
                error={errors.topic}
                idPrefix={idPrefix}
                label="Topic"
                name="topic"
                onChange={(value) => update("topic", value)}
                options={CONTACT_TOPICS.map(choice)}
                required
                value={stringValue(values.topic)}
              />
              <TextField
                error={errors.message}
                idPrefix={idPrefix}
                label="Message"
                maxLength={4_000}
                minLength={10}
                multiline
                name="message"
                onChange={(value) => update("message", value)}
                required
                value={stringValue(values.message)}
              />
            </>
          ) : null}

          {formKey === "volunteer" ? (
            <>
              <CheckboxGroup
                error={errors.interestAreas}
                idPrefix={idPrefix}
                label="Interest areas"
                name="interestAreas"
                onChange={(value) => update("interestAreas", value)}
                options={VOLUNTEER_INTERESTS}
                values={arrayValue(values.interestAreas)}
              />
              <TextField
                error={errors.howToHelp}
                idPrefix={idPrefix}
                label="How would you like to help?"
                maxLength={4_000}
                minLength={10}
                multiline
                name="howToHelp"
                onChange={(value) => update("howToHelp", value)}
                required
                value={stringValue(values.howToHelp)}
              />
              <TextField
                error={errors.availabilityContext}
                idPrefix={idPrefix}
                label="Availability or relevant context"
                maxLength={1_000}
                multiline
                name="availabilityContext"
                onChange={(value) => update("availabilityContext", value)}
                value={stringValue(values.availabilityContext)}
              />
            </>
          ) : null}

          {formKey === "host_event" ? (
            <>
              <TextField
                error={errors.proposedTitle}
                idPrefix={idPrefix}
                label="Proposed event title or topic"
                maxLength={160}
                minLength={3}
                name="proposedTitle"
                onChange={(value) => update("proposedTitle", value)}
                required
                value={stringValue(values.proposedTitle)}
              />
              <TextField
                error={errors.eventIdea}
                idPrefix={idPrefix}
                label="Short event idea"
                maxLength={4_000}
                minLength={10}
                multiline
                name="eventIdea"
                onChange={(value) => update("eventIdea", value)}
                required
                value={stringValue(values.eventIdea)}
              />
              <SelectField
                error={errors.preferredClubOrProgram}
                idPrefix={idPrefix}
                label="Preferred club or program"
                name="preferredClubOrProgram"
                onChange={(value) => update("preferredClubOrProgram", value)}
                options={choices}
                value={stringValue(values.preferredClubOrProgram)}
              />
              <SelectField
                error={errors.format}
                idPrefix={idPrefix}
                label="Format"
                name="format"
                onChange={(value) => update("format", value)}
                options={HOST_FORMATS.map(choice)}
                required
                value={stringValue(values.format)}
              />
              <TextField
                error={errors.preferredTiming}
                idPrefix={idPrefix}
                label="Preferred timing"
                maxLength={1_000}
                multiline
                name="preferredTiming"
                onChange={(value) => update("preferredTiming", value)}
                value={stringValue(values.preferredTiming)}
              />
            </>
          ) : null}

          {formKey === "partnership" ? (
            <>
              <TextField
                error={errors.organizationOrVenueName}
                idPrefix={idPrefix}
                label="Organization, venue, or supporter name"
                maxLength={160}
                minLength={2}
                name="organizationOrVenueName"
                onChange={(value) => update("organizationOrVenueName", value)}
                required
                value={stringValue(values.organizationOrVenueName)}
              />
              <SelectField
                error={errors.partnershipType}
                idPrefix={idPrefix}
                label="Partnership type"
                name="partnershipType"
                onChange={(value) => update("partnershipType", value)}
                options={PARTNERSHIP_TYPES.map(choice)}
                required
                value={stringValue(values.partnershipType)}
              />
              <TextField
                error={errors.website}
                idPrefix={idPrefix}
                label="Website (HTTPS)"
                maxLength={500}
                name="website"
                onChange={(value) => update("website", value)}
                pattern="[Hh][Tt][Tt][Pp][Ss]://.*"
                type="url"
                value={stringValue(values.website)}
              />
              <TextField
                error={errors.message}
                idPrefix={idPrefix}
                label="Message"
                maxLength={4_000}
                minLength={10}
                multiline
                name="message"
                onChange={(value) => update("message", value)}
                required
                value={stringValue(values.message)}
              />
            </>
          ) : null}

          <div className="public-submission__honeypot" aria-hidden="true">
            <label htmlFor={`${idPrefix}-company-fax`}>
              Leave this field blank
            </label>
            <input
              autoComplete="off"
              id={`${idPrefix}-company-fax`}
              name="companyFax"
              tabIndex={-1}
              type="text"
            />
          </div>

          {instanceState === "error" ? (
            <div className="public-submission__load-error" role="alert">
              <p>{instanceNotice}</p>
              <button onClick={retryInstance} type="button">
                Try loading the form again
              </button>
            </div>
          ) : instanceState === "slow" ? (
            <p className="public-submission__instance-status" role="status">
              Send is taking a little longer to prepare. You can keep filling
              out the form and press Send when you are ready.
            </p>
          ) : null}

          <button
            disabled={busy || instanceState === "error"}
            type="submit"
          >
            {busy ? "Sending..." : submitButtonLabel(formKey)}
          </button>
          <p
            className="public-submission__notice"
            id={`${idPrefix}-notice`}
            role="status"
          >
            {notice}
          </p>
        </form>
      )}
    </section>
  );
}

function submitButtonLabel(formKey: PublicFormKey): string {
  switch (formKey) {
    case "contact":
      return "Send feedback";
    case "volunteer":
      return "Send volunteer interest";
    case "host_event":
      return "Send event idea";
    case "partnership":
      return "Send partnership or support inquiry";
  }
}

function createFormInstanceGate(): FormInstanceGate {
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((complete) => {
    resolve = complete;
  });
  return Object.freeze({ promise, resolve });
}

async function waitForMinimumFormCompletion(
  instanceReceivedAtUtcMs: number,
): Promise<void> {
  const remaining = Math.max(
    0,
    PUBLIC_FORM_MINIMUM_COMPLETION_MS -
      (Date.now() - instanceReceivedAtUtcMs),
  );
  if (remaining === 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
}

function TextField({
  autoComplete,
  error,
  idPrefix,
  label,
  maxLength,
  minLength,
  multiline = false,
  name,
  onChange,
  pattern,
  required = false,
  type = "text",
  value,
}: Readonly<{
  autoComplete?: string;
  error?: string;
  idPrefix: string;
  label: string;
  maxLength?: number;
  minLength?: number;
  multiline?: boolean;
  name: string;
  onChange: (value: string) => void;
  pattern?: string;
  required?: boolean;
  type?: string;
  value: string;
}>) {
  const inputId = `${idPrefix}-${name}`;
  const errorId = `${inputId}-error`;
  const common = {
    "aria-describedby": error ? errorId : undefined,
    "aria-invalid": error ? true : undefined,
    id: inputId,
    maxLength,
    minLength,
    name,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.currentTarget.value),
    required,
    value,
  };
  return (
    <label className="public-submission__field" htmlFor={inputId}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea {...common} rows={6} />
      ) : (
        <input
          {...common}
          autoComplete={autoComplete}
          pattern={pattern}
          type={type}
        />
      )}
      {error ? (
        <small className="public-submission__error" id={errorId}>
          {error}
        </small>
      ) : null}
    </label>
  );
}

function SelectField({
  error,
  idPrefix,
  label,
  name,
  onChange,
  options,
  required = false,
  value,
}: Readonly<{
  error?: string;
  idPrefix: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: readonly PublicFormChoice[];
  required?: boolean;
  value: string;
}>) {
  const inputId = `${idPrefix}-${name}`;
  const errorId = `${inputId}-error`;
  return (
    <label className="public-submission__field" htmlFor={inputId}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        id={inputId}
        name={name}
        onChange={(event) => onChange(event.currentTarget.value)}
        required={required}
        value={value}
      >
        <option value="">Choose an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <small className="public-submission__error" id={errorId}>
          {error}
        </small>
      ) : null}
    </label>
  );
}

function CheckboxGroup({
  error,
  idPrefix,
  label,
  name,
  onChange,
  options,
  values,
}: Readonly<{
  error?: string;
  idPrefix: string;
  label: string;
  name: string;
  onChange: (values: readonly string[]) => void;
  options: readonly string[];
  values: readonly string[];
}>) {
  const errorId = `${idPrefix}-${name}-error`;
  return (
    <fieldset
      aria-required="true"
      className="public-submission__choices"
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend>{label} *</legend>
      {options.map((option, index) => (
        <label key={option}>
          <input
            checked={values.includes(option)}
            id={`${idPrefix}-${name}-${index}`}
            name={name}
            onChange={(event) =>
              onChange(
                event.currentTarget.checked
                  ? [...values, option]
                  : values.filter((value) => value !== option),
              )
            }
            required={values.length === 0 && index === 0}
            type="checkbox"
            value={option}
          />
          <span>{option}</span>
        </label>
      ))}
      {error ? (
        <small className="public-submission__error" id={errorId}>
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}

function initialValues(formKey: PublicFormKey): FormState {
  const base = { name: "", replyEmail: "" };
  if (formKey === "contact") return { ...base, topic: "", message: "" };
  if (formKey === "volunteer") {
    return {
      ...base,
      interestAreas: [],
      howToHelp: "",
      availabilityContext: "",
    };
  }
  if (formKey === "host_event") {
    return {
      ...base,
      proposedTitle: "",
      eventIdea: "",
      preferredClubOrProgram: "",
      format: "",
      preferredTiming: "",
    };
  }
  return {
    ...base,
    organizationOrVenueName: "",
    partnershipType: "",
    website: "",
    message: "",
  };
}

function choice(value: string): PublicFormChoice {
  return { label: value, value };
}

function stringValue(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(
  value: string | readonly string[] | undefined,
): readonly string[] {
  return Array.isArray(value) ? value : [];
}

function errorTargetId(idPrefix: string, field: string): string {
  return field === "interestAreas"
    ? `${idPrefix}-${field}-0`
    : `${idPrefix}-${field}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
