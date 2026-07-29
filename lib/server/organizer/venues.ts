import {
  authorizeMembership,
  OrganizerAccessDeniedError,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
} from "../../validation";
import { parseIanaTimeZone } from "../../time";
import { SafeApplicationError } from "../../validation/server-observability";

export type OrganizerVenueDto = Readonly<{
  accessibilityNotes: string;
  archived: boolean;
  id: string;
  name: string;
  privateAddress: string;
  privateDirections: string;
  timezone: string;
  version: number;
}>;

type VenueInput = Readonly<{
  accessibilityNotes: string | null;
  name: string;
  privateAddress: string | null;
  privateDirections: string | null;
  timezone: string;
}>;

const VENUE_SELECT = `
SELECT id, name, timezone, private_address, private_directions,
       accessibility_notes, updated_at, deleted_at
FROM venues`;

export async function listOrganizerVenues(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly OrganizerVenueDto[]> {
  const actor = await authorizeMembership(database, identity);
  const result = await database
    .prepare(
      `WITH current_actor AS (
         SELECT membership.organization_id
         FROM organization_memberships AS membership
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
          AND profile.normalized_email = ?
          AND profile.status = 'active'
          AND profile.deleted_at IS NULL
         JOIN organizations AS organization
           ON organization.id = membership.organization_id
          AND organization.deleted_at IS NULL
         WHERE membership.id = ?
           AND membership.organization_id = ?
           AND membership.profile_id = ?
           AND membership.role = ?
           AND membership.normalized_email = ?
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
         LIMIT 1
       )
       SELECT venue.id, venue.name, venue.timezone, venue.private_address,
              venue.private_directions, venue.accessibility_notes,
              venue.updated_at, venue.deleted_at
       FROM current_actor
       LEFT JOIN venues AS venue
         ON venue.organization_id = current_actor.organization_id
       ORDER BY venue.deleted_at IS NOT NULL, lower(venue.name), venue.id
       LIMIT 250`,
    )
    .bind(
      identity.email,
      actor.membershipId,
      actor.organizationId,
      actor.profileId,
      actor.role,
      identity.email,
    )
    .all<Record<string, unknown>>();
  const rows = result.results ?? [];
  if (rows.length === 0) {
    throw new OrganizerAccessDeniedError("inactive_membership");
  }
  return Object.freeze(
    rows.filter((row) => row.id !== null).map(readVenue),
  );
}

export async function createOrganizerVenue(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  value: unknown,
): Promise<OrganizerVenueDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const input = parseVenueInput(value, false);
  const id = `venue:${crypto.randomUUID()}`;
  const now = Date.now();
  const slug = `${slugify(input.name)}-${id.slice(-8).toLowerCase()}`;
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO venues (
           id, organization_id, name, slug, timezone, public_location_name,
           public_address, private_address, private_directions,
           accessibility_notes, is_public, created_by_profile_id,
           updated_by_profile_id, created_at, updated_at, deleted_at
         )
         SELECT ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, ?, ?, ?, ?, NULL
         WHERE EXISTS (
           SELECT 1
           FROM organization_memberships AS membership
           JOIN profiles AS profile
             ON profile.id = membership.profile_id
            AND profile.status = 'active'
            AND profile.deleted_at IS NULL
           WHERE membership.id = ?
             AND membership.organization_id = ?
             AND membership.profile_id = ?
             AND membership.role IN ('owner', 'administrator')
             AND membership.status = 'active'
             AND membership.deleted_at IS NULL
         )`,
      )
      .bind(
        id,
        actor.organizationId,
        input.name,
        slug,
        input.timezone,
        input.privateAddress,
        input.privateDirections,
        input.accessibilityNotes,
        actor.profileId,
        actor.profileId,
        now,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
      ),
    venueAudit(
      database,
      actor.organizationId,
      actor.profileId,
      id,
      "venue.created",
      { timezone: input.timezone },
      now,
    ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw privateConflict("The private venue could not be created.");
  }
  return requireVenue(database, actor.organizationId, id);
}

export async function updateOrganizerVenue(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  venueIdValue: unknown,
  value: unknown,
): Promise<OrganizerVenueDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const venueId = parseIdentifier(venueIdValue, "venueId");
  const input = parseVenueInput(value, true);
  const body = parseObject(value, "body");
  const expectedVersion = parseFiniteInteger(body.expectedVersion, {
    path: "expectedVersion",
    minimum: 1,
  });
  const now = Math.max(Date.now(), expectedVersion + 1);
  const results = await database.batch([
    database
      .prepare(
        `UPDATE venues AS venue
         SET name = ?,
             timezone = ?,
             private_address = ?,
             private_directions = ?,
             accessibility_notes = ?,
             updated_by_profile_id = ?,
             updated_at = ?
         WHERE venue.id = ?
           AND venue.organization_id = ?
           AND venue.updated_at = ?
           AND venue.deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = venue.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
           )`,
      )
      .bind(
        input.name,
        input.timezone,
        input.privateAddress,
        input.privateDirections,
        input.accessibilityNotes,
        actor.profileId,
        now,
        venueId,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
      ),
    venueAudit(
      database,
      actor.organizationId,
      actor.profileId,
      venueId,
      "venue.updated",
      { version: now },
      now,
    ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw staleVenue();
  }
  return requireVenue(database, actor.organizationId, venueId);
}

export async function archiveOrganizerVenue(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  venueIdValue: unknown,
  expectedVersionValue: unknown,
): Promise<OrganizerVenueDto> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const venueId = parseIdentifier(venueIdValue, "venueId");
  const expectedVersion = parseFiniteInteger(expectedVersionValue, {
    path: "expectedVersion",
    minimum: 1,
  });
  const now = Math.max(Date.now(), expectedVersion + 1);
  const results = await database.batch([
    database
      .prepare(
        `UPDATE venues AS venue
         SET deleted_at = ?, updated_at = ?, updated_by_profile_id = ?
         WHERE venue.id = ?
           AND venue.organization_id = ?
           AND venue.updated_at = ?
           AND venue.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM organizer_events
             WHERE organization_id = venue.organization_id
               AND venue_id = venue.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM events
             WHERE organization_id = venue.organization_id
               AND venue_id = venue.id
               AND deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM organizer_external_reservation_intervals
             WHERE organization_id = venue.organization_id
               AND venue_id = venue.id
           )
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
              AND profile.status = 'active'
              AND profile.deleted_at IS NULL
             WHERE membership.id = ?
               AND membership.organization_id = venue.organization_id
               AND membership.profile_id = ?
               AND membership.role IN ('owner', 'administrator')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
           )`,
      )
      .bind(
        now,
        now,
        actor.profileId,
        venueId,
        actor.organizationId,
        expectedVersion,
        actor.membershipId,
        actor.profileId,
      ),
    venueAudit(
      database,
      actor.organizationId,
      actor.profileId,
      venueId,
      "venue.archived",
      { version: now },
      now,
    ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw privateConflict(
      "Archive is blocked while the venue is used by an event, or the venue changed in another session.",
    );
  }
  return requireVenue(database, actor.organizationId, venueId);
}

async function requireVenue(
  database: D1DatabaseLike,
  organizationId: string,
  venueId: string,
): Promise<OrganizerVenueDto> {
  const row = await database
    .prepare(`${VENUE_SELECT} WHERE organization_id = ? AND id = ? LIMIT 1`)
    .bind(organizationId, venueId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new SafeApplicationError(
      "not_found",
      404,
      "The private venue could not be found.",
    );
  }
  return readVenue(row);
}

function parseVenueInput(value: unknown, expectsVersion: boolean): VenueInput {
  const input = parseObject(value, "body");
  assertOnlyKeys(
    input,
    [
      "accessibilityNotes",
      ...(expectsVersion ? ["expectedVersion"] : []),
      "name",
      "privateAddress",
      "privateDirections",
      "timezone",
    ],
    "body",
  );
  return Object.freeze({
    accessibilityNotes: parseOptionalBoundedString(input.accessibilityNotes, {
      path: "accessibilityNotes",
      maxLength: 2_000,
    }),
    name: parseBoundedString(input.name, {
      path: "name",
      maxLength: 180,
    }),
    privateAddress: parseOptionalBoundedString(input.privateAddress, {
      path: "privateAddress",
      maxLength: 500,
    }),
    privateDirections: parseOptionalBoundedString(input.privateDirections, {
      path: "privateDirections",
      maxLength: 2_000,
    }),
    timezone: parseIanaTimeZone(input.timezone, "timezone"),
  });
}

function readVenue(row: Record<string, unknown>): OrganizerVenueDto {
  const id = stringValue(row.id);
  const name = stringValue(row.name);
  const timezone = stringValue(row.timezone);
  const version = integerValue(row.updated_at);
  if (!id || !name || !timezone || version === null) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The private venue data is unavailable.",
    );
  }
  return Object.freeze({
    accessibilityNotes: optionalString(row.accessibility_notes),
    archived: row.deleted_at !== null,
    id,
    name,
    privateAddress: optionalString(row.private_address),
    privateDirections: optionalString(row.private_directions),
    timezone,
    version,
  });
}

function venueAudit(
  database: D1DatabaseLike,
  organizationId: string,
  actorProfileId: string,
  venueId: string,
  action: string,
  metadata: Readonly<Record<string, number | string>>,
  createdAt: number,
) {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action, entity_type,
         entity_id, metadata_json, created_at
       )
       SELECT ?, ?, ?, ?, 'venue', ?, ?, ?
       WHERE changes() = 1`,
    )
    .bind(
      `audit:${crypto.randomUUID()}`,
      organizationId,
      actorProfileId,
      action,
      venueId,
      JSON.stringify(metadata),
      createdAt,
    );
}

function staleVenue(): SafeApplicationError {
  return new SafeApplicationError(
    "stale_edit",
    409,
    "The private venue changed in another session. Refresh before saving.",
  );
}

function privateConflict(message: string): SafeApplicationError {
  return new SafeApplicationError("conflict", 409, message);
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 72) || "venue"
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function changes(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return 0;
  const count = Reflect.get(meta, "changes");
  return typeof count === "number" ? count : 0;
}
