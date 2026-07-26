"use client";

export class OrganizerRequestError extends Error {
  readonly code: string;
  readonly conflict: OrganizerConflictDetails | null;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
    conflict: OrganizerConflictDetails | null = null,
  ) {
    super(message);
    this.name = "OrganizerRequestError";
    this.code = code;
    this.conflict = conflict;
    this.status = status;
  }
}

export type OrganizerConflictDetails = Readonly<{
  eventCount: number | null;
  invitationCount: number | null;
  memberCount: number | null;
  programCount: number | null;
  records: readonly Readonly<{
    eventId: string;
    source: "legacy_read_only" | "manual" | null;
    title: string;
  }>[];
  sourceCount: number | null;
}>;

export async function organizerRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const code =
      error && typeof error.code === "string" ? error.code : "request_failed";
    const message =
      error && typeof error.message === "string"
        ? error.message
        : safeStatusMessage(response.status);
    throw new OrganizerRequestError(
      code,
      message,
      response.status,
      parseOrganizerConflictDetails(error, code, response.status),
    );
  }
  return body;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeNotice(error: unknown, fallback: string): string {
  return error instanceof OrganizerRequestError ? error.message : fallback;
}

export function organizerConflictDetails(
  error: unknown,
): OrganizerConflictDetails | null {
  return error instanceof OrganizerRequestError ? error.conflict : null;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeStatusMessage(status: number): string {
  if (status === 401) return "Sign in with ChatGPT to continue.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "That private record is not available.";
  if (status === 409) return "This record changed. Refresh before trying again.";
  if (status === 422) return "Review the form and correct the highlighted information.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "The request could not be completed.";
}

export function parseOrganizerConflictDetails(
  error: Record<string, unknown> | null,
  code: string,
  status: number,
): OrganizerConflictDetails | null {
  if (!error || code !== "conflict" || status !== 409) return null;
  const rawRecords = Array.isArray(error.blockers)
    ? error.blockers
    : Array.isArray(error.events)
      ? error.events
      : [];
  const records = rawRecords
    .slice(0, 25)
    .map(readBlockingRecord)
    .filter(
      (
        record,
      ): record is OrganizerConflictDetails["records"][number] =>
        record !== null,
    );
  const eventCount = readConflictCount(error.eventCount);
  const invitationCount = readConflictCount(error.invitationCount);
  const memberCount = readConflictCount(error.memberCount);
  const programCount = readConflictCount(error.programCount);
  const sourceCount = readConflictCount(error.sourceCount);
  return records.length > 0 ||
    eventCount !== null ||
    invitationCount !== null ||
    memberCount !== null ||
    programCount !== null ||
    sourceCount !== null
    ? Object.freeze({
        eventCount,
        invitationCount,
        memberCount,
        programCount,
        records: Object.freeze(records),
        sourceCount,
      })
    : null;
}

function readConflictCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000
    ? value
    : null;
}

function readBlockingRecord(
  value: unknown,
): OrganizerConflictDetails["records"][number] | null {
  if (!isRecord(value)) return null;
  const eventId =
    typeof value.eventId === "string" &&
    value.eventId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u.test(value.eventId)
      ? value.eventId
      : null;
  const title =
    typeof value.title === "string" &&
    value.title.length > 0 &&
    value.title.length <= 180
      ? value.title
      : null;
  const source =
    value.source === "manual" || value.source === "legacy_read_only"
      ? value.source
      : null;
  return eventId && title
    ? Object.freeze({ eventId, source, title })
    : null;
}
