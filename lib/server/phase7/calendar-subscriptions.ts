import {
  authorizeMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseBoundedString,
  parseFiniteInteger,
  parseIdentifier,
  parseOptionalBoundedString,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  buildIcalendar,
  type CalendarComponentFacts,
} from "./export-format";
import {
  reconcileCalendarComponentRevisions,
} from "./calendar-component-revisions";

const MAX_ACTIVE_TOKENS = 3;
const PRIVATE_FEED_EVENT_LIMIT = 500;
const LAST_USED_WRITE_INTERVAL_MS = 86_400_000;
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type CalendarSubscriptionDto = Readonly<{
  createdAt: number;
  id: string;
  label: string | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}>;

export type CreatedCalendarSubscription = Readonly<{
  subscription: CalendarSubscriptionDto;
  token: string;
}>;

export async function listOwnCalendarSubscriptions(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<readonly CalendarSubscriptionDto[]> {
  const actor = await authorizeMembership(database, identity);
  const result = await database
    .prepare(
      `SELECT token.id, token.label, token.created_at,
              token.last_used_at, token.revoked_at
       FROM ics_subscription_tokens AS token
       WHERE token.organization_id = ?
         AND token.profile_id = ?
       ORDER BY
         CASE WHEN token.revoked_at IS NULL THEN 0 ELSE 1 END ASC,
         token.created_at DESC,
         token.id ASC
       LIMIT 50`,
    )
    .bind(actor.organizationId, actor.profileId)
    .all<Record<string, unknown>>();
  assertResult(result.success);
  return Object.freeze((result.results ?? []).map(readSubscription));
}

export async function createOwnCalendarSubscription(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  labelValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CreatedCalendarSubscription> {
  const actor = await authorizeMembership(database, identity);
  const label =
    parseOptionalBoundedString(labelValue, {
      path: "label",
      maxLength: 80,
    }) ?? null;
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const id = `calendar-token:${crypto.randomUUID()}`;
  const token = createRawToken();
  const tokenHash = await sha256Hex(token);
  const auditMetadata = JSON.stringify({
    labelProvided: label !== null,
  });
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO ics_subscription_tokens (
           id, organization_id, profile_id, token_hash, label,
           created_at, last_used_at, revoked_at
         )
         SELECT ?, membership.organization_id, membership.profile_id,
                ?, ?, ?, NULL, NULL
         FROM organization_memberships AS membership
         JOIN profiles AS profile
           ON profile.id = membership.profile_id
         JOIN organizations AS organization
           ON organization.id = membership.organization_id
         WHERE membership.id = ?
           AND membership.organization_id = ?
           AND membership.profile_id = ?
           AND membership.role IN ('owner', 'administrator', 'organizer')
           AND membership.status = 'active'
           AND membership.deleted_at IS NULL
           AND profile.status = 'active'
           AND profile.deleted_at IS NULL
           AND organization.deleted_at IS NULL
           AND (
             SELECT count(*)
             FROM ics_subscription_tokens AS active_token
             WHERE active_token.organization_id = membership.organization_id
               AND active_token.profile_id = membership.profile_id
               AND active_token.revoked_at IS NULL
           ) < ?`,
      )
      .bind(
        id,
        tokenHash,
        label,
        now,
        actor.membershipId,
        actor.organizationId,
        actor.profileId,
        MAX_ACTIVE_TOKENS,
      ),
    database
      .prepare(
        `INSERT INTO audit_logs (
           id, organization_id, actor_profile_id, action,
           entity_type, entity_id, metadata_json, created_at
         )
         SELECT ?, ?, ?, 'calendar_subscription.created',
                'ics_subscription_token', ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(
        `audit:${crypto.randomUUID()}`,
        actor.organizationId,
        actor.profileId,
        id,
        auditMetadata,
        now,
      ),
  ]);
  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "No more than three active calendar subscriptions are allowed.",
    );
  }
  return Object.freeze({
    subscription: Object.freeze({
      createdAt: now,
      id,
      label,
      lastUsedAt: null,
      revokedAt: null,
    }),
    token,
  });
}

export async function revokeOwnCalendarSubscription(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  tokenIdValue: unknown,
  nowUtcMs = Date.now(),
): Promise<CalendarSubscriptionDto> {
  const actor = await authorizeMembership(database, identity);
  const tokenId = parseIdentifier(tokenIdValue, "tokenId");
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });
  const existing = await readOwnSubscription(
    database,
    actor.organizationId,
    actor.profileId,
    tokenId,
  );
  if (!existing) return privateNotFound();
  if (existing.revokedAt !== null) return existing;

  try {
    const results = await database.batch([
      database
        .prepare(
          `UPDATE ics_subscription_tokens AS token
           SET revoked_at = ?
           WHERE token.id = ?
             AND token.organization_id = ?
             AND token.profile_id = ?
             AND token.revoked_at IS NULL
             AND EXISTS (
               SELECT 1
               FROM organization_memberships AS membership
               JOIN profiles AS profile
                 ON profile.id = membership.profile_id
               WHERE membership.id = ?
                 AND membership.organization_id = token.organization_id
                 AND membership.profile_id = token.profile_id
                 AND membership.role IN (
                   'owner', 'administrator', 'organizer'
                 )
                 AND membership.status = 'active'
                 AND membership.deleted_at IS NULL
                 AND profile.status = 'active'
                 AND profile.deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          tokenId,
          actor.organizationId,
          actor.profileId,
          actor.membershipId,
        ),
      database
        .prepare(
          `INSERT INTO audit_logs (
             id, organization_id, actor_profile_id, action,
             entity_type, entity_id, metadata_json, created_at
           )
           SELECT ?, ?, ?, 'calendar_subscription.revoked',
                  'ics_subscription_token', ?, '{}', ?
           WHERE changes() = 1`,
        )
        .bind(
          `audit:${crypto.randomUUID()}`,
          actor.organizationId,
          actor.profileId,
          tokenId,
          now,
        ),
    ]);
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      throw new Error("calendar_subscription_revoke_conflict");
    }
  } catch {
    const current = await readOwnSubscription(
      database,
      actor.organizationId,
      actor.profileId,
      tokenId,
    );
    if (current?.revokedAt !== null && current?.revokedAt !== undefined) {
      return current;
    }
    throw new SafeApplicationError(
      "conflict",
      409,
      "The calendar subscription changed before it could be revoked.",
    );
  }
  return Object.freeze({ ...existing, revokedAt: now });
}

export async function readPrivateCalendarSubscription(
  database: D1DatabaseLike,
  rawTokenValue: unknown,
  input: Readonly<{
    generatedAt: number;
    origin: string;
  }>,
): Promise<string> {
  const rawToken =
    typeof rawTokenValue === "string" &&
    RAW_TOKEN_PATTERN.test(rawTokenValue)
      ? rawTokenValue
      : privateNotFound();
  const generatedAt = parseFiniteInteger(input.generatedAt, {
    path: "generatedAt",
    minimum: 0,
  });
  const origin = parseRequestOrigin(input.origin);
  const tokenHash = await sha256Hex(rawToken);
  const row = await database
    .prepare(PRIVATE_CALENDAR_FEED_SQL)
    .bind(tokenHash, PRIVATE_FEED_EVENT_LIMIT + 1)
    .first<Record<string, unknown>>();
  if (!row) return privateNotFound();
  const tokenId = parseIdentifier(row.token_id, "calendarToken.id");
  const organizationId = parseIdentifier(
    row.organization_id,
    "calendarToken.organizationId",
  );
  const profileId = parseIdentifier(
    row.profile_id,
    "calendarToken.profileId",
  );
  const timeZone = parseBoundedString(row.timezone, {
    path: "calendarToken.timezone",
    maxLength: 100,
  });
  const lastUsedAt = optionalInteger(row.last_used_at);
  const events = readPrivateFeedEvents(row.events_json);
  if (events.length > PRIVATE_FEED_EVENT_LIMIT) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "The private calendar is too large to download safely.",
    );
  }
  if (
    lastUsedAt === null ||
    generatedAt - lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS
  ) {
    const update = await database
      .prepare(
        `UPDATE ics_subscription_tokens AS token
         SET last_used_at = ?
         WHERE token.id = ?
           AND token.organization_id = ?
           AND token.profile_id = ?
           AND token.token_hash = ?
           AND token.revoked_at IS NULL
           AND (
             token.last_used_at IS NULL
             OR token.last_used_at <= ?
           )
           AND EXISTS (
             SELECT 1
             FROM organization_memberships AS membership
             JOIN profiles AS profile
               ON profile.id = membership.profile_id
             JOIN organizations AS organization
               ON organization.id = membership.organization_id
             WHERE membership.organization_id = token.organization_id
               AND membership.profile_id = token.profile_id
               AND membership.role IN ('owner', 'administrator', 'organizer')
               AND membership.status = 'active'
               AND membership.deleted_at IS NULL
               AND profile.status = 'active'
               AND profile.deleted_at IS NULL
               AND organization.deleted_at IS NULL
           )`,
      )
      .bind(
        generatedAt,
        tokenId,
        organizationId,
        profileId,
        tokenHash,
        generatedAt - LAST_USED_WRITE_INTERVAL_MS,
      )
      .run();
    const updateChanges = changes(update);
    if (updateChanges !== 0 && updateChanges !== 1) {
      return privateNotFound();
    }
  }
  if (
    !(await hasActivePrivateCalendarToken(database, {
      organizationId,
      profileId,
      tokenHash,
      tokenId,
    }))
  ) {
    return privateNotFound();
  }
  const components = await Promise.all(
    events.map((event) =>
      toPrivateCalendarComponent(
        event,
        organizationId,
        origin,
        timeZone,
      ),
    ),
  );
  const calendarEvents = await reconcileCalendarComponentRevisions(
    database,
    {
      candidates: events.map((event, index) =>
        Object.freeze({
          event: components[index],
          eventKey: `${event.sourceKind}:${event.id}`,
        }),
      ),
      organizationId,
      scope: "private",
    },
  );
  return buildIcalendar(calendarEvents, {
    calendarName: "Vancouver Curiosity Club · private planning",
    generatedAt,
  });
}

async function hasActivePrivateCalendarToken(
  database: D1DatabaseLike,
  input: Readonly<{
    organizationId: string;
    profileId: string;
    tokenHash: string;
    tokenId: string;
  }>,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT 1 AS is_active
       FROM ics_subscription_tokens AS token
       JOIN organization_memberships AS membership
         ON membership.organization_id = token.organization_id
        AND membership.profile_id = token.profile_id
        AND membership.role IN ('owner', 'administrator', 'organizer')
        AND membership.status = 'active'
        AND membership.deleted_at IS NULL
       JOIN profiles AS profile
         ON profile.id = token.profile_id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
       JOIN organizations AS organization
         ON organization.id = token.organization_id
        AND organization.deleted_at IS NULL
       WHERE token.id = ?
         AND token.organization_id = ?
         AND token.profile_id = ?
         AND token.token_hash = ?
         AND token.revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(
      input.tokenId,
      input.organizationId,
      input.profileId,
      input.tokenHash,
    )
    .first<{ is_active: number }>();
  return row?.is_active === 1;
}

const PRIVATE_CALENDAR_FEED_SQL = `
WITH authorized_token AS (
  SELECT token.id AS token_id,
         token.organization_id,
         token.profile_id,
         token.last_used_at,
         organization.timezone,
         organization.updated_at AS organization_updated_at
  FROM ics_subscription_tokens AS token
  JOIN organizations AS organization
    ON organization.id = token.organization_id
   AND organization.deleted_at IS NULL
  JOIN organization_memberships AS membership
    ON membership.organization_id = token.organization_id
   AND membership.profile_id = token.profile_id
   AND membership.role IN ('owner', 'administrator', 'organizer')
   AND membership.status = 'active'
   AND membership.deleted_at IS NULL
  JOIN profiles AS profile
    ON profile.id = token.profile_id
   AND profile.status = 'active'
   AND profile.deleted_at IS NULL
  WHERE token.token_hash = ?
    AND token.revoked_at IS NULL
  LIMIT 1
),
private_events AS (
  SELECT 'manual' AS source_kind,
         event.id,
         event.title,
         club.name AS club_name,
         event.planning_status,
         event.publication_status,
         event.schedule_shape,
         event.starts_at_utc,
         event.ends_at_utc,
         event.timezone,
         event.all_day_start_date,
         event.all_day_end_date_exclusive,
         CASE
           WHEN venue.is_public = 1
           THEN COALESCE(venue.public_location_name, venue.name)
           ELSE NULL
         END AS venue_label
  FROM authorized_token AS authorization
  JOIN organizer_events AS event
    ON event.organization_id = authorization.organization_id
   AND event.deleted_at IS NULL
   AND event.schedule_shape IN ('timed', 'all_day')
   AND event.planning_status IN (
     'idea', 'draft', 'tentative_hold', 'confirmed', 'cancelled'
   )
  JOIN clubs AS club
    ON club.id = event.club_id
   AND club.organization_id = event.organization_id
   AND club.deleted_at IS NULL
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
   AND venue.deleted_at IS NULL

  UNION ALL

  SELECT 'legacy' AS source_kind,
         event.id,
         event.title,
         club.name AS club_name,
         event.status AS planning_status,
         CASE
           WHEN event.visibility = 'public'
            AND event.published_at IS NOT NULL
           THEN 'published'
           ELSE 'private'
         END AS publication_status,
         event.time_kind AS schedule_shape,
         event.starts_at_utc,
         event.ends_at_utc,
         event.timezone,
         event.all_day_start_date,
         event.all_day_end_date_exclusive,
         CASE
           WHEN venue.is_public = 1
           THEN COALESCE(venue.public_location_name, venue.name)
           ELSE NULL
         END AS venue_label
  FROM authorized_token AS authorization
  JOIN events AS event
    ON event.organization_id = authorization.organization_id
   AND event.deleted_at IS NULL
   AND event.time_kind IN ('timed', 'all_day')
  JOIN clubs AS club
    ON club.id = event.club_id
   AND club.organization_id = event.organization_id
   AND club.deleted_at IS NULL
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
   AND venue.deleted_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM external_source_links AS source_link
    WHERE source_link.organization_id = event.organization_id
      AND source_link.entity_type = 'event'
      AND source_link.entity_id = event.id
      AND source_link.source_type = 'meetup_ics'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM organizer_events AS adopted_event
      WHERE adopted_event.id = event.id
        AND adopted_event.organization_id = event.organization_id
    )
    AND event.status IN (
      'idea', 'draft', 'hold', 'tentative', 'confirmed', 'cancelled'
    )

  UNION ALL

  SELECT 'meetup' AS source_kind,
         snapshot.event_id AS id,
         snapshot.title,
         club.name AS club_name,
         snapshot.status AS planning_status,
         CASE
           WHEN event.visibility = 'public'
            AND event.published_at IS NOT NULL
           THEN 'published'
           ELSE 'private'
         END AS publication_status,
         snapshot.time_kind AS schedule_shape,
         snapshot.starts_at_utc,
         snapshot.ends_at_utc,
         snapshot.timezone,
         snapshot.all_day_start_date,
         snapshot.all_day_end_date_exclusive,
         CASE
           WHEN venue.is_public = 1
           THEN COALESCE(venue.public_location_name, venue.name)
           ELSE NULL
         END AS venue_label
  FROM authorized_token AS authorization
  JOIN sync_sources AS source
    ON source.organization_id = authorization.organization_id
   AND source.source_type = 'meetup_ics'
   AND source.enabled = 1
   AND source.active_generation_id IS NOT NULL
   AND source.deleted_at IS NULL
  JOIN meetup_sync_generations AS generation
    ON generation.id = source.active_generation_id
   AND generation.organization_id = source.organization_id
   AND generation.sync_source_id = source.id
   AND generation.state = 'published'
  JOIN meetup_event_snapshots AS snapshot
    ON snapshot.organization_id = source.organization_id
   AND snapshot.sync_source_id = source.id
   AND snapshot.generation_id = source.active_generation_id
   AND snapshot.time_kind IN ('timed', 'all_day')
  JOIN events AS event
    ON event.id = snapshot.event_id
   AND event.organization_id = source.organization_id
  JOIN clubs AS club
    ON club.id = source.club_id
   AND club.organization_id = source.organization_id
   AND club.deleted_at IS NULL
  LEFT JOIN venues AS venue
    ON venue.id = event.venue_id
   AND venue.organization_id = event.organization_id
   AND venue.deleted_at IS NULL
  WHERE snapshot.status IN (
    'idea', 'draft', 'hold', 'tentative', 'confirmed', 'cancelled'
  )
),
bounded_events AS (
  SELECT *
  FROM private_events
  ORDER BY
    CASE schedule_shape
      WHEN 'timed' THEN starts_at_utc
      ELSE CAST(strftime(
        '%s', all_day_start_date || 'T00:00:00Z'
      ) AS INTEGER) * 1000
    END ASC,
    source_kind ASC,
    id ASC
  LIMIT ?
)
SELECT authorization.token_id,
       authorization.organization_id,
       authorization.profile_id,
       authorization.last_used_at,
       authorization.timezone,
       COALESCE((
         SELECT json_group_array(json_object(
           'sourceKind', event.source_kind,
           'id', event.id,
           'title', event.title,
           'clubName', event.club_name,
           'planningStatus', event.planning_status,
           'publicationStatus', event.publication_status,
           'scheduleShape', event.schedule_shape,
           'startsAtUtc', event.starts_at_utc,
           'endsAtUtc', event.ends_at_utc,
           'timezone', event.timezone,
           'allDayStartDate', event.all_day_start_date,
           'allDayEndDateExclusive', event.all_day_end_date_exclusive,
           'venueLabel', event.venue_label
         ))
         FROM bounded_events AS event
       ), '[]') AS events_json
FROM authorized_token AS authorization
`;

type PrivateFeedEvent = Readonly<{
  allDayEndDateExclusive: string | null;
  allDayStartDate: string | null;
  clubName: string;
  endsAtUtc: number | null;
  id: string;
  planningStatus: string;
  publicationStatus: string;
  scheduleShape: "all_day" | "timed";
  sourceKind: "legacy" | "manual" | "meetup";
  startsAtUtc: number | null;
  timeZone: string;
  title: string;
  venueLabel: string | null;
}>;

function readPrivateFeedEvents(value: unknown): readonly PrivateFeedEvent[] {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > 4_000_000
  ) {
    return invalidPrivateFeed();
  }
  let rows: unknown;
  try {
    rows = JSON.parse(value);
  } catch {
    return invalidPrivateFeed();
  }
  if (!Array.isArray(rows) || rows.length > PRIVATE_FEED_EVENT_LIMIT + 1) {
    return invalidPrivateFeed();
  }
  return Object.freeze(
    rows.map((value, index) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return invalidPrivateFeed();
      }
      const row = value as Record<string, unknown>;
      const scheduleShape =
        row.scheduleShape === "timed" || row.scheduleShape === "all_day"
          ? row.scheduleShape
          : invalidPrivateFeed();
      const timeZone = parseBoundedString(row.timezone, {
        path: `privateCalendar.events.${index}.timezone`,
        maxLength: 100,
      });
      return Object.freeze({
        allDayEndDateExclusive: nullableString(row.allDayEndDateExclusive),
        allDayStartDate: nullableString(row.allDayStartDate),
        clubName: parseBoundedString(row.clubName, {
          path: `privateCalendar.events.${index}.clubName`,
          maxLength: 160,
        }),
        endsAtUtc: optionalInteger(row.endsAtUtc),
        id: parseIdentifier(row.id, `privateCalendar.events.${index}.id`),
        planningStatus: parseBoundedString(row.planningStatus, {
          path: `privateCalendar.events.${index}.planningStatus`,
          maxLength: 40,
        }),
        publicationStatus: parseBoundedString(row.publicationStatus, {
          path: `privateCalendar.events.${index}.publicationStatus`,
          maxLength: 40,
        }),
        scheduleShape,
        sourceKind:
          row.sourceKind === "manual" ||
          row.sourceKind === "legacy" ||
          row.sourceKind === "meetup"
            ? row.sourceKind
            : invalidPrivateFeed(),
        startsAtUtc: optionalInteger(row.startsAtUtc),
        timeZone,
        title: parseBoundedString(row.title, {
          path: `privateCalendar.events.${index}.title`,
          maxLength: 200,
        }),
        venueLabel:
          parseOptionalBoundedString(row.venueLabel, {
            path: `privateCalendar.events.${index}.venueLabel`,
            maxLength: 200,
          }) ?? null,
      });
    }),
  );
}

async function toPrivateCalendarComponent(
  event: PrivateFeedEvent,
  organizationId: string,
  origin: URL,
  organizationTimeZone: string,
): Promise<CalendarComponentFacts> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${organizationId}\u0000${event.sourceKind}\u0000${event.id}`,
    ),
  );
  const status =
    event.planningStatus === "cancelled"
      ? ("cancelled" as const)
      : event.planningStatus === "completed"
        ? ("completed" as const)
        : event.planningStatus === "tentative_hold" ||
            event.planningStatus === "tentative"
          ? ("tentative" as const)
          : ("confirmed" as const);
  const schedule =
    event.scheduleShape === "timed" &&
    event.startsAtUtc !== null &&
    event.endsAtUtc !== null
      ? Object.freeze({
          kind: "timed" as const,
          startsAtUtc: new Date(event.startsAtUtc).toISOString(),
          endsAtUtc: new Date(event.endsAtUtc).toISOString(),
        })
      : event.scheduleShape === "all_day" &&
          event.allDayStartDate &&
          event.allDayEndDateExclusive
        ? Object.freeze({
            kind: "all_day" as const,
            startDate: event.allDayStartDate,
            endDateExclusive: event.allDayEndDateExclusive,
          })
        : invalidPrivateFeed();
  return Object.freeze({
    description: [
      `Club: ${event.clubName}`,
      `Planning status: ${event.planningStatus}`,
      `Publication status: ${event.publicationStatus}`,
    ].join("\n"),
    location: event.venueLabel,
    schedule,
    status,
    summary: event.title,
    timeZone:
      event.scheduleShape === "timed"
        ? event.timeZone
        : organizationTimeZone,
    uid: `${hex(digest).slice(0, 40)}@private.vancouver-curiosity-club`,
    url: new URL(
      `/organizer/events/${encodeURIComponent(event.id)}`,
      origin,
    ).toString(),
  });
}

async function readOwnSubscription(
  database: D1DatabaseLike,
  organizationId: string,
  profileId: string,
  tokenId: string,
): Promise<CalendarSubscriptionDto | null> {
  const row = await database
    .prepare(
      `SELECT id, label, created_at, last_used_at, revoked_at
       FROM ics_subscription_tokens
       WHERE id = ?
         AND organization_id = ?
         AND profile_id = ?
       LIMIT 1`,
    )
    .bind(tokenId, organizationId, profileId)
    .first<Record<string, unknown>>();
  return row ? readSubscription(row) : null;
}

function readSubscription(
  row: Record<string, unknown>,
): CalendarSubscriptionDto {
  return Object.freeze({
    createdAt: parseFiniteInteger(row.created_at, {
      path: "calendarSubscription.createdAt",
      minimum: 0,
    }),
    id: parseIdentifier(row.id, "calendarSubscription.id"),
    label:
      parseOptionalBoundedString(row.label, {
        path: "calendarSubscription.label",
        maxLength: 80,
      }) ?? null,
    lastUsedAt: optionalInteger(row.last_used_at),
    revokedAt: optionalInteger(row.revoked_at),
  });
}

function createRawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256Hex(value: string): Promise<string> {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function changes(result: unknown): number {
  if (typeof result !== "object" || result === null) return 0;
  const meta = Reflect.get(result, "meta");
  if (typeof meta !== "object" || meta === null) return 0;
  const value = Reflect.get(meta, "changes");
  return typeof value === "number" ? value : 0;
}

function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : parseFiniteInteger(value, {
        path: "calendarSubscription.timestamp",
        minimum: 0,
      });
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : invalidPrivateFeed();
}

function parseRequestOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return privateNotFound();
  }
  const isLocal =
    origin.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]", "::1"].includes(origin.hostname);
  if (
    origin.origin !== value ||
    (origin.protocol !== "https:" && !isLocal) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    return privateNotFound();
  }
  return origin;
}

function assertResult(success: unknown): void {
  if (success === false) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "Calendar subscriptions are temporarily unavailable.",
    );
  }
}

function privateNotFound(): never {
  throw new SafeApplicationError(
    "not_found",
    404,
    "The calendar subscription could not be found.",
  );
}

function invalidPrivateFeed(): never {
  throw new SafeApplicationError(
    "service_unavailable",
    503,
    "The private calendar is temporarily unavailable.",
  );
}
