import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  assertOnlyKeys,
  parseBoundedString,
  parseEnum,
  parseFiniteInteger,
  parseIdentifier,
  parseObject,
  parseOptionalBoundedString,
  validationIssue,
} from "../../validation";
import { SafeApplicationError } from "../../validation/server-observability";
import {
  deriveTaxonomySlug,
  isTaxonomyColorToken,
  isTaxonomySlug,
  TAXONOMY_COLOR_TOKEN_MAX,
  TAXONOMY_DESCRIPTION_MAX,
  TAXONOMY_MAX_ITEMS,
  TAXONOMY_NAME_MAX,
  TAXONOMY_SLUG_MAX,
  TAXONOMY_SORT_ORDER_MAX,
} from "../../taxonomy-contract";

const TAXONOMY_ENTITY_TYPES = ["lane", "category"] as const;
const TAXONOMY_ACTIONS = [
  "update",
  "reorder",
  "archive",
  "safe_delete",
] as const;
const CANONICAL_LANE_SLUGS = new Set([
  "think",
  "reset-and-make",
  "explore",
  "eat-and-play",
]);

const COMMIT_ACTOR_GUARD_SQL = `EXISTS (
  SELECT 1
  FROM organization_memberships AS actor_membership
  JOIN profiles AS actor_profile
    ON actor_profile.id = actor_membership.profile_id
   AND actor_profile.status = 'active'
   AND actor_profile.deleted_at IS NULL
  JOIN organizations AS actor_organization
    ON actor_organization.id = actor_membership.organization_id
   AND actor_organization.deleted_at IS NULL
  WHERE actor_membership.id = ?
    AND actor_membership.organization_id = ?
    AND actor_membership.profile_id = ?
    AND actor_membership.normalized_email = ?
    AND actor_membership.normalized_email = actor_profile.normalized_email
    AND actor_membership.role IN ('owner', 'administrator')
    AND actor_membership.status = 'active'
    AND actor_membership.deleted_at IS NULL
)`;

export type OrganizerTaxonomyEntityType =
  (typeof TAXONOMY_ENTITY_TYPES)[number];

export type OrganizerTaxonomyItemDto = Readonly<{
  archived: boolean;
  blockers: readonly OrganizerTaxonomyBlockerDto[];
  canArchive: boolean;
  canDelete: boolean;
  colorToken: string | null;
  contentVersion: number;
  description: string | null;
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}>;

export type OrganizerTaxonomyBlockerDto = Readonly<{
  count: number;
  label: string;
}>;

export type OrganizerTaxonomyWorkspaceDto = Readonly<{
  categories: readonly OrganizerTaxonomyItemDto[];
  lanes: readonly OrganizerTaxonomyItemDto[];
  permissions: Readonly<{
    canManage: true;
  }>;
}>;

type ParsedTaxonomyFields = Readonly<{
  colorToken: string | null;
  description: string | null;
  name: string;
}>;

type ParsedTaxonomyCreate = ParsedTaxonomyFields &
  Readonly<{
    entityType: OrganizerTaxonomyEntityType;
    slug: string;
    sortOrder: number | null;
  }>;

type ParsedTaxonomyUpdate = ParsedTaxonomyFields &
  Readonly<{
    action: "update";
    entityType: OrganizerTaxonomyEntityType;
    expectedContentVersion: number;
    id: string;
  }>;

type ParsedTaxonomyReorder = Readonly<{
  action: "reorder";
  entityType: OrganizerTaxonomyEntityType;
  items: readonly Readonly<{
    expectedContentVersion: number;
    id: string;
  }>[];
}>;

type ParsedTaxonomyTerminalAction = Readonly<{
  action: "archive" | "safe_delete";
  entityType: OrganizerTaxonomyEntityType;
  expectedContentVersion: number;
  id: string;
}>;

type ParsedTaxonomyAction =
  | ParsedTaxonomyUpdate
  | ParsedTaxonomyReorder
  | ParsedTaxonomyTerminalAction;

type TaxonomyWriteOperation =
  | "create"
  | "update"
  | "reorder"
  | "archive"
  | "safe_delete";

type OrganizerTaxonomyMutationItem =
  OrganizerTaxonomyItemDto &
    Readonly<{
      deletedAt: number | null;
    }>;

export class OrganizerTaxonomyNotFoundError extends SafeApplicationError {
  constructor() {
    super(
      "not_found",
      404,
      "The requested taxonomy item is unavailable.",
    );
    this.name = "OrganizerTaxonomyNotFoundError";
  }
}

export class OrganizerTaxonomyStaleError extends SafeApplicationError {
  constructor() {
    super(
      "stale_edit",
      409,
      "This taxonomy changed in another request. Refresh and try again.",
    );
    this.name = "OrganizerTaxonomyStaleError";
  }
}

export class OrganizerTaxonomyInUseError extends SafeApplicationError {
  constructor() {
    super(
      "conflict",
      409,
      "This taxonomy item is retained by event or public-content history and cannot be deleted.",
    );
    this.name = "OrganizerTaxonomyInUseError";
  }
}

export async function readOrganizerTaxonomyWorkspace(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<OrganizerTaxonomyWorkspaceDto> {
  const actor = await authorizeTaxonomyActor(database, identity);
  await assertTaxonomyStatesReady(database, actor);
  return readWorkspaceForIdentity(database, identity, actor);
}

export async function createOrganizerTaxonomyItem(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerTaxonomyWorkspaceDto> {
  const actor = await authorizeTaxonomyActor(database, identity);
  await assertTaxonomyStatesReady(database, actor);
  const input = parseTaxonomyCreate(inputValue);
  if (
    await taxonomyCreateAlreadyCompleted(
      database,
      actor,
      input,
    )
  ) {
    return readWorkspaceForIdentity(database, identity, actor);
  }
  await assertTaxonomyCapacity(
    database,
    actor.organizationId,
    input.entityType,
  );
  const now = parseNow(nowUtcMs);
  const sortOrder =
    input.sortOrder ??
    (await nextTaxonomySortOrder(
      database,
      actor.organizationId,
      input.entityType,
    ));
  const id = crypto.randomUUID();
  const intentId = crypto.randomUUID();
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const intentStatement = taxonomyIntentStatement(
    database,
    identity,
    actor,
    {
      actorProfileId: actor.profileId,
      entityId: id,
      entityType: input.entityType,
      expectedContentVersion: 0,
      id: intentId,
      mutationGroupId: null,
      mutationGroupSize: null,
      now,
      operation: "create",
      proposedColorToken: input.colorToken,
      proposedContentVersion: 1,
      proposedDeletedAt: null,
      proposedDescription: input.description,
      proposedName: input.name,
      proposedSlug: input.slug,
      proposedSortOrder: sortOrder,
    },
  );
  const baseStatement =
    input.entityType === "lane"
      ? database
          .prepare(
            `INSERT INTO event_lanes (
               id, organization_id, name, slug, description, sort_order,
               created_by_profile_id, created_at, updated_at, deleted_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
             WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
          )
          .bind(
            id,
            actor.organizationId,
            input.name,
            input.slug,
            input.description,
            sortOrder,
            actor.profileId,
            now,
            now,
            ...actorGuardBindings(identity, actor),
          )
      : database
          .prepare(
            `INSERT INTO categories (
               id, organization_id, name, slug, description, color_token,
               created_at, updated_at, deleted_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL
             WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
          )
          .bind(
            id,
            actor.organizationId,
            input.name,
            input.slug,
            input.description,
            input.colorToken,
            now,
            now,
            ...actorGuardBindings(identity, actor),
          );
  const stateStatement =
    input.entityType === "lane"
      ? database
          .prepare(
            `INSERT INTO ${stateTable} (
               ${stateIdColumn}, organization_id, content_version,
               active_intent_id, last_completed_intent_id,
               updated_by_profile_id, created_at, updated_at
             )
             SELECT ?, ?, 1, ?, NULL, ?, ?, ?
             WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
          )
          .bind(
            id,
            actor.organizationId,
            intentId,
            actor.profileId,
            now,
            now,
            ...actorGuardBindings(identity, actor),
          )
      : database
          .prepare(
            `INSERT INTO ${stateTable} (
               ${stateIdColumn}, organization_id, sort_order,
               content_version, active_intent_id,
               last_completed_intent_id, updated_by_profile_id,
               created_at, updated_at
             )
             SELECT ?, ?, ?, 1, ?, NULL, ?, ?, ?
             WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
          )
          .bind(
            id,
            actor.organizationId,
            sortOrder,
            intentId,
            actor.profileId,
            now,
            now,
            ...actorGuardBindings(identity, actor),
          );
  const auditStatement = taxonomyAuditSentinel(
    database,
    identity,
    actor,
    {
      action: `taxonomy.${input.entityType}_created`,
      entityId: id,
      entityType: input.entityType,
      expectedPreviousChanges: 1,
      metadataJson: JSON.stringify({
        slug: input.slug,
        writeIntentId: intentId,
      }),
      now,
    },
  );
  const finalizeStateStatement = taxonomyStateFinalizeStatement(
    database,
    identity,
    actor,
    {
      entityId: id,
      entityType: input.entityType,
      incrementVersion: false,
      intentId,
      now,
      reorder: false,
    },
  );
  const completeIntentStatement = taxonomyIntentCompletionStatement(
    database,
    identity,
    actor,
    intentId,
    now,
    1,
  );

  await runTaxonomyMutationBatch(
    database,
    [
      intentStatement,
      baseStatement,
      stateStatement,
      auditStatement,
      finalizeStateStatement,
      completeIntentStatement,
    ],
    undefined,
    () =>
      taxonomyCreateAlreadyCompleted(
        database,
        actor,
        input,
      ),
  );
  return readWorkspaceForIdentity(database, identity, actor);
}

export async function performOrganizerTaxonomyAction(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  inputValue: unknown,
  nowUtcMs = Date.now(),
): Promise<OrganizerTaxonomyWorkspaceDto> {
  const actor = await authorizeTaxonomyActor(database, identity);
  await assertTaxonomyStatesReady(database, actor);
  const input = parseTaxonomyAction(inputValue);
  const now = parseNow(nowUtcMs);
  if (input.action === "update") {
    await updateTaxonomyItem(database, identity, actor, input, now);
  } else if (input.action === "reorder") {
    await reorderTaxonomyItems(database, identity, actor, input, now);
  } else if (input.action === "archive") {
    await archiveTaxonomyItem(database, identity, actor, input, now);
  } else {
    await safeDeleteTaxonomyItem(database, identity, actor, input, now);
  }
  return readWorkspaceForIdentity(database, identity, actor);
}

async function authorizeTaxonomyActor(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
): Promise<AuthorizedMembership> {
  return authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
}

async function assertTaxonomyStatesReady(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT (
         (
           SELECT count(*)
           FROM event_lanes AS lane
           LEFT JOIN event_lane_taxonomy_states AS state
             ON state.lane_id = lane.id
            AND state.organization_id = lane.organization_id
           WHERE lane.organization_id = ?
             AND (
               state.lane_id IS NULL
               OR state.active_intent_id IS NOT NULL
               OR state.last_completed_intent_id IS NULL
             )
         )
         +
         (
           SELECT count(*)
           FROM categories AS category
           LEFT JOIN category_taxonomy_states AS state
             ON state.category_id = category.id
            AND state.organization_id = category.organization_id
           WHERE category.organization_id = ?
             AND (
               state.category_id IS NULL
               OR state.active_intent_id IS NOT NULL
               OR state.last_completed_intent_id IS NULL
             )
         )
       ) AS violation_count`,
    )
    .bind(actor.organizationId, actor.organizationId)
    .first<Record<string, unknown>>();
  const violationCount = parseFiniteInteger(row?.violation_count, {
    path: "taxonomy.stateViolationCount",
    minimum: 0,
  });
  if (violationCount !== 0) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "Taxonomy is not ready for a safe request.",
    );
  }
}

async function readWorkspaceForActor(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
): Promise<OrganizerTaxonomyWorkspaceDto> {
  const [lanes, categories] = await Promise.all([
    database
      .prepare(
        `SELECT lane.id, lane.name, lane.slug, lane.description,
                lane.sort_order, lane.deleted_at, state.content_version,
                (
                  SELECT count(*)
                  FROM organizer_events AS organizer_event
                  WHERE organizer_event.organization_id =
                        lane.organization_id
                    AND organizer_event.event_lane_id = lane.id
                ) AS organizer_event_count,
                (
                  SELECT count(*)
                  FROM events AS legacy_event
                  WHERE legacy_event.organization_id = lane.organization_id
                    AND legacy_event.event_lane_id = lane.id
                ) AS legacy_event_count,
                (
                  (SELECT count(*)
                   FROM club_public_profiles AS profile
                   WHERE profile.organization_id = lane.organization_id
                     AND profile.primary_event_lane_id = lane.id)
                  +
                  (SELECT count(*)
                   FROM program_public_profile_details AS detail
                   WHERE detail.organization_id = lane.organization_id
                     AND detail.primary_event_lane_id = lane.id)
                  +
                  (SELECT count(*)
                   FROM cms_entity_revisions AS revision
                   WHERE revision.organization_id =
                         lane.organization_id
                     AND revision.entity_type IN (
                       'club_public_profile',
                       'program_public_profile'
                     )
                     AND json_valid(revision.snapshot_json)
                     AND json_extract(
                           revision.snapshot_json,
                           '$.laneId'
                         ) = lane.id)
                ) AS public_profile_count
         FROM event_lanes AS lane
         JOIN event_lane_taxonomy_states AS state
           ON state.lane_id = lane.id
          AND state.organization_id = lane.organization_id
         WHERE lane.organization_id = ?
         ORDER BY (lane.deleted_at IS NOT NULL) ASC,
                  lane.sort_order ASC,
                  lane.name COLLATE NOCASE ASC,
                  lane.id ASC
         LIMIT ?`,
      )
      .bind(actor.organizationId, TAXONOMY_MAX_ITEMS)
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT category.id, category.name, category.slug,
                category.description, category.color_token,
                state.sort_order, category.deleted_at,
                state.content_version,
                (
                  SELECT count(*)
                  FROM organizer_events AS organizer_event
                  WHERE organizer_event.organization_id =
                        category.organization_id
                    AND organizer_event.category_id = category.id
                ) AS organizer_event_count,
                (
                  SELECT count(*)
                  FROM events AS legacy_event
                  WHERE legacy_event.organization_id =
                        category.organization_id
                    AND legacy_event.category_id = category.id
                ) AS legacy_event_count,
                0 AS public_profile_count
         FROM categories AS category
         JOIN category_taxonomy_states AS state
           ON state.category_id = category.id
          AND state.organization_id = category.organization_id
         WHERE category.organization_id = ?
         ORDER BY (category.deleted_at IS NOT NULL) ASC,
                  state.sort_order ASC,
                  category.name COLLATE NOCASE ASC,
                  category.id ASC
         LIMIT ?`,
      )
      .bind(actor.organizationId, TAXONOMY_MAX_ITEMS)
      .all<Record<string, unknown>>(),
  ]);
  return Object.freeze({
    categories: Object.freeze(
      (categories.results ?? []).map((row) =>
        taxonomyItemFromRow(row, "category"),
      ),
    ),
    lanes: Object.freeze(
      (lanes.results ?? []).map((row) =>
        taxonomyItemFromRow(row, "lane"),
      ),
    ),
    permissions: Object.freeze({ canManage: true as const }),
  });
}

async function readWorkspaceForIdentity(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
): Promise<OrganizerTaxonomyWorkspaceDto> {
  const workspace = await readWorkspaceForActor(database, actor);
  const liveActor = await authorizeTaxonomyActor(database, identity);
  if (
    liveActor.membershipId !== actor.membershipId ||
    liveActor.organizationId !== actor.organizationId ||
    liveActor.profileId !== actor.profileId ||
    liveActor.role !== actor.role
  ) {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "Organizer access changed during this request.",
    );
  }
  return workspace;
}

async function updateTaxonomyItem(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyUpdate,
  now: number,
): Promise<void> {
  const current = await readTaxonomyItemForMutation(
    database,
    actor,
    input.entityType,
    input.id,
  );
  if (
    current.contentVersion === input.expectedContentVersion + 1 &&
    await taxonomyCompletedMutationMatches(
      database,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        expectedContentVersion: input.expectedContentVersion,
        operation: "update",
        proposedColorToken: input.colorToken,
        proposedDeletedAtRequired: false,
        proposedDescription: input.description,
        proposedName: input.name,
        proposedSlug: current.slug,
        proposedSortOrder: current.sortOrder,
      },
    )
  ) {
    return;
  }
  assertExpectedTaxonomyVersion(
    current,
    input.expectedContentVersion,
  );
  if (current.archived) throw new OrganizerTaxonomyNotFoundError();

  const table = baseTable(input.entityType);
  const idColumn = baseIdColumn(input.entityType);
  const intentId = crypto.randomUUID();
  const setSql =
    input.entityType === "lane"
      ? "name = ?, description = ?, updated_at = ?"
      : "name = ?, description = ?, color_token = ?, updated_at = ?";
  const setBindings =
    input.entityType === "lane"
      ? [input.name, input.description, now]
      : [input.name, input.description, input.colorToken, now];
  const statements = [
    taxonomyIntentStatement(database, identity, actor, {
      actorProfileId: actor.profileId,
      entityId: input.id,
      entityType: input.entityType,
      expectedContentVersion: input.expectedContentVersion,
      id: intentId,
      mutationGroupId: null,
      mutationGroupSize: null,
      now,
      operation: "update",
      proposedColorToken: input.colorToken,
      proposedContentVersion: input.expectedContentVersion + 1,
      proposedDeletedAt: null,
      proposedDescription: input.description,
      proposedName: input.name,
      proposedSlug: current.slug,
      proposedSortOrder: current.sortOrder,
    }),
    taxonomyStateClaimStatement(
      database,
      identity,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        expectedContentVersion: input.expectedContentVersion,
        intentId,
      },
    ),
    database
      .prepare(
        `UPDATE ${table}
         SET ${setSql}
         WHERE ${idColumn} = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${stateTableName(input.entityType)} AS state
             WHERE state.${stateIdColumnName(input.entityType)} =
                   ${table}.${idColumn}
               AND state.organization_id =
                   ${table}.organization_id
               AND state.active_intent_id = ?
           )
           AND ${COMMIT_ACTOR_GUARD_SQL}`,
      )
      .bind(
        ...setBindings,
        input.id,
        actor.organizationId,
        intentId,
        ...actorGuardBindings(identity, actor),
      ),
    taxonomyAuditSentinel(database, identity, actor, {
      action: `taxonomy.${input.entityType}_updated`,
      entityId: input.id,
      entityType: input.entityType,
      expectedPreviousChanges: 1,
      metadataJson: JSON.stringify({ writeIntentId: intentId }),
      now,
    }),
    taxonomyStateFinalizeStatement(
      database,
      identity,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        incrementVersion: true,
        intentId,
        now,
        reorder: false,
      },
    ),
    taxonomyIntentCompletionStatement(
      database,
      identity,
      actor,
      intentId,
      now,
      1,
    ),
  ];
  await runTaxonomyMutationBatch(
    database,
    statements,
    undefined,
    () =>
      taxonomyCompletedMutationMatches(
        database,
        actor,
        {
          entityId: input.id,
          entityType: input.entityType,
          expectedContentVersion: input.expectedContentVersion,
          operation: "update",
          proposedColorToken: input.colorToken,
          proposedDeletedAtRequired: false,
          proposedDescription: input.description,
          proposedName: input.name,
          proposedSlug: current.slug,
          proposedSortOrder: current.sortOrder,
        },
      ),
  );
}

async function reorderTaxonomyItems(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyReorder,
  now: number,
): Promise<void> {
  const workspace = await readWorkspaceForActor(database, actor);
  if (
    await taxonomyReorderAlreadyCompleted(
      database,
      actor,
      input,
    )
  ) {
    return;
  }
  const currentItems = (
    input.entityType === "lane" ? workspace.lanes : workspace.categories
  ).filter((item) => !item.archived);
  if (currentItems.length !== input.items.length) {
    throw new OrganizerTaxonomyStaleError();
  }
  const currentById = new Map(
    currentItems.map((item) => [item.id, item] as const),
  );
  for (const item of input.items) {
    const current = currentById.get(item.id);
    if (
      current === undefined ||
      current.contentVersion !== item.expectedContentVersion
    ) {
      throw new OrganizerTaxonomyStaleError();
    }
  }

  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const table = baseTable(input.entityType);
  const idColumn = baseIdColumn(input.entityType);
  const groupId = crypto.randomUUID();
  const intentIdPrefix = `taxonomy-reorder:${groupId}`;
  const auditIdPrefix = `taxonomy-reorder-audit:${groupId}`;
  const itemCount = input.items.length;
  const payload = JSON.stringify(
    input.items.map((item, index) => ({
      expectedContentVersion: item.expectedContentVersion,
      id: item.id,
      sortOrder: (index + 1) * 10,
    })),
  );
  const proposedColorSql =
    input.entityType === "lane" ? "NULL" : "base.color_token";
  const intentStatement = database
    .prepare(
      `INSERT INTO taxonomy_write_intents (
         id, organization_id, entity_type, entity_id, operation,
         expected_content_version, proposed_content_version,
         proposed_name, proposed_slug, proposed_description,
         proposed_color_token, proposed_sort_order,
         proposed_deleted_at, mutation_group_id,
         mutation_group_size, actor_profile_id,
         created_at, completed_at
       )
       SELECT ? || ':' || base.${idColumn},
              base.organization_id, ?, base.${idColumn}, 'reorder',
              CAST(
                json_extract(item.value, '$.expectedContentVersion')
                AS INTEGER
              ),
              CAST(
                json_extract(item.value, '$.expectedContentVersion')
                AS INTEGER
              ) + 1,
              base.name, base.slug, base.description,
              ${proposedColorSql},
              CAST(
                json_extract(item.value, '$.sortOrder') AS INTEGER
              ),
              NULL, ?, ?, ?, ?, NULL
       FROM json_each(?) AS item
       JOIN ${table} AS base
         ON base.${idColumn} = json_extract(item.value, '$.id')
       JOIN ${stateTable} AS state
         ON state.${stateIdColumn} = base.${idColumn}
        AND state.organization_id = base.organization_id
       WHERE base.organization_id = ?
         AND base.deleted_at IS NULL
         AND state.active_intent_id IS NULL
         AND state.content_version = CAST(
           json_extract(item.value, '$.expectedContentVersion')
           AS INTEGER
         )
         AND (
           SELECT count(*)
           FROM ${table} AS active_item
           WHERE active_item.organization_id = base.organization_id
             AND active_item.deleted_at IS NULL
         ) = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      intentIdPrefix,
      input.entityType,
      groupId,
      itemCount,
      actor.profileId,
      now,
      payload,
      actor.organizationId,
      itemCount,
      ...actorGuardBindings(identity, actor),
    );

  const claimStateStatement = database
    .prepare(
      `UPDATE ${stateTable}
       SET active_intent_id = (
         SELECT intent.id
         FROM taxonomy_write_intents AS intent
         WHERE intent.organization_id =
               ${stateTable}.organization_id
           AND intent.entity_type = ?
           AND intent.entity_id = ${stateTable}.${stateIdColumn}
           AND intent.operation = 'reorder'
           AND intent.mutation_group_id = ?
           AND intent.completed_at IS NULL
       )
       WHERE organization_id = ?
         AND active_intent_id IS NULL
         AND ${stateIdColumn} IN (
           SELECT intent.entity_id
           FROM taxonomy_write_intents AS intent
           WHERE intent.organization_id = ?
             AND intent.entity_type = ?
             AND intent.operation = 'reorder'
             AND intent.mutation_group_id = ?
             AND intent.completed_at IS NULL
         )
         AND content_version = (
           SELECT intent.expected_content_version
           FROM taxonomy_write_intents AS intent
           WHERE intent.organization_id =
                 ${stateTable}.organization_id
             AND intent.entity_type = ?
             AND intent.entity_id = ${stateTable}.${stateIdColumn}
             AND intent.operation = 'reorder'
             AND intent.mutation_group_id = ?
             AND intent.completed_at IS NULL
         )
         AND (
           SELECT count(*)
           FROM taxonomy_write_intents AS intent
           WHERE intent.organization_id = ?
             AND intent.entity_type = ?
             AND intent.operation = 'reorder'
             AND intent.mutation_group_id = ?
             AND intent.completed_at IS NULL
         ) = ?
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      input.entityType,
      groupId,
      actor.organizationId,
      actor.organizationId,
      input.entityType,
      groupId,
      input.entityType,
      groupId,
      actor.organizationId,
      input.entityType,
      groupId,
      itemCount,
      itemCount,
      ...actorGuardBindings(identity, actor),
    );

  const laneSortSetSql =
    input.entityType === "lane"
      ? `sort_order = (
           SELECT intent.proposed_sort_order
           FROM ${stateTable} AS state
           JOIN taxonomy_write_intents AS intent
             ON intent.id = state.active_intent_id
           WHERE state.${stateIdColumn} = ${table}.${idColumn}
             AND state.organization_id = ${table}.organization_id
         ),`
      : "";
  const baseStatement = database
    .prepare(
      `UPDATE ${table}
       SET ${laneSortSetSql}
           updated_at = ?
       WHERE organization_id = ?
         AND deleted_at IS NULL
         AND ${idColumn} IN (
           SELECT intent.entity_id
           FROM taxonomy_write_intents AS intent
           WHERE intent.organization_id = ?
             AND intent.entity_type = ?
             AND intent.operation = 'reorder'
             AND intent.mutation_group_id = ?
             AND intent.completed_at IS NULL
         )
         AND EXISTS (
           SELECT 1
           FROM ${stateTable} AS state
           WHERE state.${stateIdColumn} = ${table}.${idColumn}
             AND state.organization_id = ${table}.organization_id
             AND state.active_intent_id IS NOT NULL
         )
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      now,
      actor.organizationId,
      actor.organizationId,
      input.entityType,
      groupId,
      itemCount,
      ...actorGuardBindings(identity, actor),
    );

  const auditStatement = database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       SELECT ? || ':' || intent.entity_id,
              intent.organization_id, intent.actor_profile_id,
              ?, ?, intent.entity_id,
              json_object(
                'writeIntentId', intent.id,
                'mutationGroupId', intent.mutation_group_id
              ),
              intent.created_at
       FROM taxonomy_write_intents AS intent
       WHERE intent.organization_id = ?
         AND intent.entity_type = ?
         AND intent.operation = 'reorder'
         AND intent.mutation_group_id = ?
         AND intent.completed_at IS NULL
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      auditIdPrefix,
      `taxonomy.${input.entityType}_reordered`,
      `event_${input.entityType}`,
      actor.organizationId,
      input.entityType,
      groupId,
      itemCount,
      ...actorGuardBindings(identity, actor),
    );

  const categorySortSetSql =
    input.entityType === "category"
      ? `sort_order = (
           SELECT intent.proposed_sort_order
           FROM taxonomy_write_intents AS intent
           WHERE intent.id = ${stateTable}.active_intent_id
         ),`
      : "";
  const finalizeStateStatement = database
    .prepare(
      `UPDATE ${stateTable}
       SET ${categorySortSetSql}
           content_version = content_version + 1,
           last_completed_intent_id = active_intent_id,
           active_intent_id = NULL,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE organization_id = ?
         AND active_intent_id IN (
           SELECT intent.id
           FROM taxonomy_write_intents AS intent
           WHERE intent.organization_id = ?
             AND intent.entity_type = ?
             AND intent.operation = 'reorder'
             AND intent.mutation_group_id = ?
             AND intent.completed_at IS NULL
         )
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      actor.profileId,
      now,
      actor.organizationId,
      actor.organizationId,
      input.entityType,
      groupId,
      input.items.length,
      ...actorGuardBindings(identity, actor),
    );

  const completeIntentStatement = database
    .prepare(
      `UPDATE taxonomy_write_intents
       SET completed_at = ?
       WHERE organization_id = ?
         AND entity_type = ?
         AND operation = 'reorder'
         AND mutation_group_id = ?
         AND completed_at IS NULL
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      now,
      actor.organizationId,
      input.entityType,
      groupId,
      itemCount,
      ...actorGuardBindings(identity, actor),
    );

  await runTaxonomyMutationBatch(
    database,
    [
      intentStatement,
      claimStateStatement,
      baseStatement,
      auditStatement,
      finalizeStateStatement,
      completeIntentStatement,
    ],
    [
      itemCount,
      itemCount,
      itemCount,
      itemCount,
      itemCount,
      itemCount,
    ],
    () =>
      taxonomyReorderAlreadyCompleted(
        database,
        actor,
        input,
      ),
  );
}

async function archiveTaxonomyItem(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyTerminalAction,
  now: number,
): Promise<void> {
  const current = await readTaxonomyItemForMutation(
    database,
    actor,
    input.entityType,
    input.id,
  );
  if (
    current.contentVersion === input.expectedContentVersion + 1 &&
    await taxonomyCompletedMutationMatches(
      database,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        expectedContentVersion: input.expectedContentVersion,
        operation: "archive",
        proposedColorToken: current.colorToken,
        proposedDeletedAtRequired: true,
        proposedDescription: current.description,
        proposedName: current.name,
        proposedSlug: current.slug,
        proposedSortOrder: current.sortOrder,
      },
    )
  ) {
    return;
  }
  assertExpectedTaxonomyVersion(
    current,
    input.expectedContentVersion,
  );
  if (!current.canArchive) throw new OrganizerTaxonomyInUseError();
  const table = baseTable(input.entityType);
  const idColumn = baseIdColumn(input.entityType);
  const intentId = crypto.randomUUID();
  const statements = [
    taxonomyIntentStatement(database, identity, actor, {
      actorProfileId: actor.profileId,
      entityId: input.id,
      entityType: input.entityType,
      expectedContentVersion: input.expectedContentVersion,
      id: intentId,
      mutationGroupId: null,
      mutationGroupSize: null,
      now,
      operation: "archive",
      proposedColorToken: current.colorToken,
      proposedContentVersion: input.expectedContentVersion + 1,
      proposedDeletedAt: now,
      proposedDescription: current.description,
      proposedName: current.name,
      proposedSlug: current.slug,
      proposedSortOrder: current.sortOrder,
    }),
    taxonomyStateClaimStatement(
      database,
      identity,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        expectedContentVersion: input.expectedContentVersion,
        intentId,
      },
    ),
    database
      .prepare(
        `UPDATE ${table}
         SET deleted_at = ?, updated_at = ?
         WHERE ${idColumn} = ?
           AND organization_id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${stateTableName(input.entityType)} AS state
             WHERE state.${stateIdColumnName(input.entityType)} =
                   ${table}.${idColumn}
               AND state.organization_id = ${table}.organization_id
               AND state.active_intent_id = ?
           )
           AND ${COMMIT_ACTOR_GUARD_SQL}`,
      )
      .bind(
        now,
        now,
        input.id,
        actor.organizationId,
        intentId,
        ...actorGuardBindings(identity, actor),
      ),
    taxonomyAuditSentinel(database, identity, actor, {
      action: `taxonomy.${input.entityType}_archived`,
      entityId: input.id,
      entityType: input.entityType,
      expectedPreviousChanges: 1,
      metadataJson: JSON.stringify({ writeIntentId: intentId }),
      now,
    }),
    taxonomyStateFinalizeStatement(
      database,
      identity,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        incrementVersion: true,
        intentId,
        now,
        reorder: false,
      },
    ),
    taxonomyIntentCompletionStatement(
      database,
      identity,
      actor,
      intentId,
      now,
      1,
    ),
  ];
  await runTaxonomyMutationBatch(
    database,
    statements,
    undefined,
    () =>
      taxonomyCompletedMutationMatches(
        database,
        actor,
        {
          entityId: input.id,
          entityType: input.entityType,
          expectedContentVersion: input.expectedContentVersion,
          operation: "archive",
          proposedColorToken: current.colorToken,
          proposedDeletedAtRequired: true,
          proposedDescription: current.description,
          proposedName: current.name,
          proposedSlug: current.slug,
          proposedSortOrder: current.sortOrder,
        },
      ),
  );
}

async function safeDeleteTaxonomyItem(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyTerminalAction,
  now: number,
): Promise<void> {
  if (
    await taxonomySafeDeleteAlreadyCompleted(
      database,
      actor,
      input.entityType,
      input.id,
      input.expectedContentVersion,
    )
  ) {
    return;
  }
  const current = await readTaxonomyItemForMutation(
    database,
    actor,
    input.entityType,
    input.id,
  );
  assertExpectedTaxonomyVersion(
    current,
    input.expectedContentVersion,
  );
  if (!current.archived) throw new OrganizerTaxonomyInUseError();
  if (
    input.entityType === "lane" &&
    CANONICAL_LANE_SLUGS.has(current.slug)
  ) {
    throw new OrganizerTaxonomyInUseError();
  }
  if (!current.canDelete) throw new OrganizerTaxonomyInUseError();
  const blockerCount = await taxonomyReferenceCount(
    database,
    actor.organizationId,
    input.entityType,
    input.id,
  );
  if (blockerCount !== 0) throw new OrganizerTaxonomyInUseError();

  const table = baseTable(input.entityType);
  const idColumn = baseIdColumn(input.entityType);
  const intentId = crypto.randomUUID();
  const auditStatement = taxonomyAuditSentinel(
    database,
    identity,
    actor,
    {
      action: `taxonomy.${input.entityType}_deleted`,
      entityId: input.id,
      entityType: input.entityType,
      expectedPreviousChanges: 1,
      metadataJson: JSON.stringify({ writeIntentId: intentId }),
      now,
    },
  );
  await runTaxonomyMutationBatch(database, [
    taxonomyIntentStatement(database, identity, actor, {
      actorProfileId: actor.profileId,
      entityId: input.id,
      entityType: input.entityType,
      expectedContentVersion: input.expectedContentVersion,
      id: intentId,
      mutationGroupId: null,
      mutationGroupSize: null,
      now,
      operation: "safe_delete",
      proposedColorToken: current.colorToken,
      proposedContentVersion: input.expectedContentVersion + 1,
      proposedDeletedAt: current.deletedAt,
      proposedDescription: current.description,
      proposedName: current.name,
      proposedSlug: current.slug,
      proposedSortOrder: current.sortOrder,
    }),
    taxonomyStateClaimStatement(
      database,
      identity,
      actor,
      {
        entityId: input.id,
        entityType: input.entityType,
        expectedContentVersion: input.expectedContentVersion,
        intentId,
      },
    ),
    database
      .prepare(
        `DELETE FROM ${table}
         WHERE ${idColumn} = ?
           AND organization_id = ?
           AND deleted_at IS NOT NULL
           AND EXISTS (
             SELECT 1
             FROM ${stateTableName(input.entityType)} AS state
             WHERE state.${stateIdColumnName(input.entityType)} =
                   ${table}.${idColumn}
               AND state.organization_id =
                   ${table}.organization_id
               AND state.active_intent_id = ?
           )
           AND changes() = 1
           AND ${COMMIT_ACTOR_GUARD_SQL}`,
      )
      .bind(
        input.id,
        actor.organizationId,
        intentId,
        ...actorGuardBindings(identity, actor),
      ),
    auditStatement,
    taxonomyIntentCompletionStatement(
      database,
      identity,
      actor,
      intentId,
      now,
      1,
    ),
  ], undefined, () =>
    taxonomySafeDeleteAlreadyCompleted(
      database,
      actor,
      input.entityType,
      input.id,
      input.expectedContentVersion,
    ),
  );
}

function taxonomyIntentStatement(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: Readonly<{
    actorProfileId: string;
    entityId: string;
    entityType: OrganizerTaxonomyEntityType;
    expectedContentVersion: number;
    id: string;
    mutationGroupId: string | null;
    mutationGroupSize: number | null;
    now: number;
    operation: TaxonomyWriteOperation;
    proposedColorToken: string | null;
    proposedContentVersion: number;
    proposedDeletedAt: number | null;
    proposedDescription: string | null;
    proposedName: string;
    proposedSlug: string;
    proposedSortOrder: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO taxonomy_write_intents (
         id, organization_id, entity_type, entity_id, operation,
         expected_content_version, proposed_content_version,
         proposed_name, proposed_slug, proposed_description,
         proposed_color_token, proposed_sort_order,
         proposed_deleted_at, mutation_group_id,
         mutation_group_size, actor_profile_id,
         created_at, completed_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
       WHERE ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      input.id,
      actor.organizationId,
      input.entityType,
      input.entityId,
      input.operation,
      input.expectedContentVersion,
      input.proposedContentVersion,
      input.proposedName,
      input.proposedSlug,
      input.proposedDescription,
      input.proposedColorToken,
      input.proposedSortOrder,
      input.proposedDeletedAt,
      input.mutationGroupId,
      input.mutationGroupSize,
      input.actorProfileId,
      input.now,
      ...actorGuardBindings(identity, actor),
    );
}

function taxonomyStateClaimStatement(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: Readonly<{
    entityId: string;
    entityType: OrganizerTaxonomyEntityType;
    expectedContentVersion: number;
    intentId: string;
  }>,
): D1PreparedStatementLike {
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  return database
    .prepare(
      `UPDATE ${stateTable}
       SET active_intent_id = ?
       WHERE ${stateIdColumn} = ?
         AND organization_id = ?
         AND content_version = ?
         AND active_intent_id IS NULL
         AND EXISTS (
           SELECT 1
           FROM taxonomy_write_intents AS intent
           WHERE intent.id = ?
             AND intent.organization_id = ${stateTable}.organization_id
             AND intent.entity_type = ?
             AND intent.entity_id = ${stateTable}.${stateIdColumn}
             AND intent.expected_content_version =
                 ${stateTable}.content_version
             AND intent.completed_at IS NULL
         )
         AND changes() = 1
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      input.intentId,
      input.entityId,
      actor.organizationId,
      input.expectedContentVersion,
      input.intentId,
      input.entityType,
      ...actorGuardBindings(identity, actor),
    );
}

function taxonomyStateFinalizeStatement(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: Readonly<{
    entityId: string;
    entityType: OrganizerTaxonomyEntityType;
    incrementVersion: boolean;
    intentId: string;
    now: number;
    reorder: boolean;
  }>,
): D1PreparedStatementLike {
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const sortOrderSetSql =
    input.entityType === "category" && input.reorder
      ? `sort_order = (
           SELECT intent.proposed_sort_order
           FROM taxonomy_write_intents AS intent
           WHERE intent.id = ${stateTable}.active_intent_id
         ),`
      : "";
  const versionSetSql = input.incrementVersion
    ? "content_version = content_version + 1,"
    : "content_version = content_version,";
  return database
    .prepare(
      `UPDATE ${stateTable}
       SET ${sortOrderSetSql}
           ${versionSetSql}
           last_completed_intent_id = active_intent_id,
           active_intent_id = NULL,
           updated_by_profile_id = ?,
           updated_at = ?
       WHERE ${stateIdColumn} = ?
         AND organization_id = ?
         AND active_intent_id = ?
         AND changes() = 1
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      actor.profileId,
      input.now,
      input.entityId,
      actor.organizationId,
      input.intentId,
      ...actorGuardBindings(identity, actor),
    );
}

function taxonomyIntentCompletionStatement(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  intentId: string,
  now: number,
  expectedPreviousChanges: number,
): D1PreparedStatementLike {
  return database
    .prepare(
      `UPDATE taxonomy_write_intents
       SET completed_at = ?
       WHERE id = ?
         AND organization_id = ?
         AND actor_profile_id = ?
         AND completed_at IS NULL
         AND changes() = ?
         AND ${COMMIT_ACTOR_GUARD_SQL}`,
    )
    .bind(
      now,
      intentId,
      actor.organizationId,
      actor.profileId,
      expectedPreviousChanges,
      ...actorGuardBindings(identity, actor),
    );
}

function assertExpectedTaxonomyVersion(
  current: OrganizerTaxonomyItemDto,
  expectedContentVersion: number,
): void {
  if (current.contentVersion !== expectedContentVersion) {
    throw new OrganizerTaxonomyStaleError();
  }
}

async function taxonomyCompletedMutationMatches(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: Readonly<{
    entityId: string;
    entityType: OrganizerTaxonomyEntityType;
    expectedContentVersion: number;
    operation: "update" | "archive";
    proposedColorToken: string | null;
    proposedDeletedAtRequired: boolean;
    proposedDescription: string | null;
    proposedName: string;
    proposedSlug: string;
    proposedSortOrder: number;
  }>,
): Promise<boolean> {
  const table = baseTable(input.entityType);
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const colorMatchSql =
    input.entityType === "lane"
      ? "intent.proposed_color_token IS NULL"
      : "base.color_token IS intent.proposed_color_token";
  const sortMatchSql =
    input.entityType === "lane"
      ? "base.sort_order = intent.proposed_sort_order"
      : "state.sort_order = intent.proposed_sort_order";
  const deletedShapeSql = input.proposedDeletedAtRequired
    ? "intent.proposed_deleted_at IS NOT NULL"
    : "intent.proposed_deleted_at IS NULL";
  const row = await database
    .prepare(
      `SELECT count(*) AS match_count
       FROM ${table} AS base
       JOIN ${stateTable} AS state
         ON state.${stateIdColumn} = base.id
        AND state.organization_id = base.organization_id
       JOIN taxonomy_write_intents AS intent
         ON intent.id = state.last_completed_intent_id
        AND intent.organization_id = state.organization_id
        AND intent.entity_type = ?
        AND intent.entity_id = base.id
       WHERE base.id = ?
         AND base.organization_id = ?
         AND state.active_intent_id IS NULL
         AND state.content_version = ?
         AND state.updated_by_profile_id = ?
         AND intent.operation = ?
         AND intent.expected_content_version = ?
         AND intent.proposed_content_version = ?
         AND intent.actor_profile_id = ?
         AND intent.completed_at IS NOT NULL
         AND intent.proposed_name = ?
         AND intent.proposed_slug = ?
         AND intent.proposed_description IS ?
         AND intent.proposed_color_token IS ?
         AND intent.proposed_sort_order = ?
         AND ${deletedShapeSql}
         AND base.name = intent.proposed_name
         AND base.slug = intent.proposed_slug
         AND base.description IS intent.proposed_description
         AND ${colorMatchSql}
         AND ${sortMatchSql}
         AND base.deleted_at IS intent.proposed_deleted_at
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = intent.organization_id
             AND audit.actor_profile_id = intent.actor_profile_id
             AND audit.entity_type = 'event_' || intent.entity_type
             AND audit.entity_id = intent.entity_id
             AND audit.action = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
         )`,
    )
    .bind(
      input.entityType,
      input.entityId,
      actor.organizationId,
      input.expectedContentVersion + 1,
      actor.profileId,
      input.operation,
      input.expectedContentVersion,
      input.expectedContentVersion + 1,
      actor.profileId,
      input.proposedName,
      input.proposedSlug,
      input.proposedDescription,
      input.proposedColorToken,
      input.proposedSortOrder,
      `taxonomy.${input.entityType}_${
        input.operation === "archive" ? "archived" : "updated"
      }`,
    )
    .first<Record<string, unknown>>();
  return readExactMatchCount(row) === 1;
}

async function taxonomyCreateAlreadyCompleted(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyCreate,
): Promise<boolean> {
  const table = baseTable(input.entityType);
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const colorMatchSql =
    input.entityType === "lane"
      ? "intent.proposed_color_token IS NULL"
      : "base.color_token IS intent.proposed_color_token";
  const sortMatchSql =
    input.entityType === "lane"
      ? "base.sort_order = intent.proposed_sort_order"
      : "state.sort_order = intent.proposed_sort_order";
  const explicitSortSql =
    input.sortOrder === null
      ? ""
      : "AND intent.proposed_sort_order = ?";
  const bindings: (string | number | null)[] = [
    input.entityType,
    actor.organizationId,
    input.slug,
    actor.profileId,
    actor.profileId,
    input.name,
    input.description,
    input.colorToken,
  ];
  if (input.sortOrder !== null) bindings.push(input.sortOrder);
  bindings.push(`taxonomy.${input.entityType}_created`);
  const row = await database
    .prepare(
      `SELECT count(*) AS match_count
       FROM ${table} AS base
       JOIN ${stateTable} AS state
         ON state.${stateIdColumn} = base.id
        AND state.organization_id = base.organization_id
       JOIN taxonomy_write_intents AS intent
         ON intent.id = state.last_completed_intent_id
        AND intent.organization_id = state.organization_id
        AND intent.entity_type = ?
        AND intent.entity_id = base.id
       WHERE base.organization_id = ?
         AND base.slug = ?
         AND base.deleted_at IS NULL
         AND state.active_intent_id IS NULL
         AND state.content_version = 1
         AND state.updated_by_profile_id = ?
         AND intent.operation = 'create'
         AND intent.expected_content_version = 0
         AND intent.proposed_content_version = 1
         AND intent.actor_profile_id = ?
         AND intent.completed_at IS NOT NULL
         AND intent.proposed_name = ?
         AND intent.proposed_slug = base.slug
         AND intent.proposed_description IS ?
         AND intent.proposed_color_token IS ?
         ${explicitSortSql}
         AND intent.proposed_deleted_at IS NULL
         AND base.name = intent.proposed_name
         AND base.description IS intent.proposed_description
         AND ${colorMatchSql}
         AND ${sortMatchSql}
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = intent.organization_id
             AND audit.actor_profile_id = intent.actor_profile_id
             AND audit.entity_type = 'event_' || intent.entity_type
             AND audit.entity_id = intent.entity_id
             AND audit.action = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
         )`,
    )
    .bind(...bindings)
    .first<Record<string, unknown>>();
  return readExactMatchCount(row) === 1;
}

async function taxonomySafeDeleteAlreadyCompleted(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  entityType: OrganizerTaxonomyEntityType,
  entityId: string,
  expectedContentVersion: number,
): Promise<boolean> {
  const table = baseTable(entityType);
  const stateTable = stateTableName(entityType);
  const stateIdColumn = stateIdColumnName(entityType);
  const row = await database
    .prepare(
      `SELECT count(*) AS match_count
       FROM taxonomy_write_intents AS intent
       WHERE intent.organization_id = ?
         AND intent.entity_type = ?
         AND intent.entity_id = ?
         AND intent.operation = 'safe_delete'
         AND intent.expected_content_version = ?
         AND intent.proposed_content_version = ?
         AND intent.proposed_deleted_at IS NOT NULL
         AND intent.actor_profile_id = ?
         AND intent.completed_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM ${table} AS base
           WHERE base.id = intent.entity_id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM ${stateTable} AS state
           WHERE state.${stateIdColumn} = intent.entity_id
         )
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = intent.organization_id
             AND audit.actor_profile_id = intent.actor_profile_id
             AND audit.entity_type = 'event_' || intent.entity_type
             AND audit.entity_id = intent.entity_id
             AND audit.action = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
         )`,
    )
    .bind(
      actor.organizationId,
      entityType,
      entityId,
      expectedContentVersion,
      expectedContentVersion + 1,
      actor.profileId,
      `taxonomy.${entityType}_deleted`,
    )
    .first<Record<string, unknown>>();
  return readExactMatchCount(row) === 1;
}

async function taxonomyReorderAlreadyCompleted(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  input: ParsedTaxonomyReorder,
): Promise<boolean> {
  const table = baseTable(input.entityType);
  const stateTable = stateTableName(input.entityType);
  const stateIdColumn = stateIdColumnName(input.entityType);
  const payload = JSON.stringify(
    input.items.map((item, index) => ({
      expectedContentVersion: item.expectedContentVersion,
      id: item.id,
      sortOrder: (index + 1) * 10,
    })),
  );
  const colorMatchSql =
    input.entityType === "lane"
      ? "intent.proposed_color_token IS NULL"
      : "base.color_token IS intent.proposed_color_token";
  const sortMatchSql =
    input.entityType === "lane"
      ? "base.sort_order = intent.proposed_sort_order"
      : "state.sort_order = intent.proposed_sort_order";
  const row = await database
    .prepare(
      `SELECT count(*) AS match_count
       FROM json_each(?) AS item
       JOIN ${table} AS base
         ON base.id = json_extract(item.value, '$.id')
       JOIN ${stateTable} AS state
         ON state.${stateIdColumn} = base.id
        AND state.organization_id = base.organization_id
       JOIN taxonomy_write_intents AS intent
         ON intent.id = state.last_completed_intent_id
        AND intent.organization_id = state.organization_id
        AND intent.entity_type = ?
        AND intent.entity_id = base.id
       WHERE base.organization_id = ?
         AND base.deleted_at IS NULL
         AND state.active_intent_id IS NULL
         AND state.content_version = CAST(
           json_extract(item.value, '$.expectedContentVersion')
           AS INTEGER
         ) + 1
         AND intent.operation = 'reorder'
         AND intent.expected_content_version = CAST(
           json_extract(item.value, '$.expectedContentVersion')
           AS INTEGER
         )
         AND intent.proposed_content_version =
             state.content_version
         AND intent.proposed_sort_order = CAST(
           json_extract(item.value, '$.sortOrder') AS INTEGER
         )
         AND intent.mutation_group_size = ?
         AND intent.actor_profile_id = ?
         AND intent.completed_at IS NOT NULL
         AND intent.proposed_name = base.name
         AND intent.proposed_slug = base.slug
         AND intent.proposed_description IS base.description
         AND intent.proposed_deleted_at IS NULL
         AND ${colorMatchSql}
         AND ${sortMatchSql}
         AND (
           SELECT count(*)
           FROM ${table} AS active_item
           WHERE active_item.organization_id = base.organization_id
             AND active_item.deleted_at IS NULL
         ) = ?
         AND EXISTS (
           SELECT 1
           FROM audit_logs AS audit
           WHERE audit.organization_id = intent.organization_id
             AND audit.actor_profile_id = intent.actor_profile_id
             AND audit.entity_type = 'event_' || intent.entity_type
             AND audit.entity_id = intent.entity_id
             AND audit.action = ?
             AND json_extract(
                   audit.metadata_json,
                   '$.writeIntentId'
                 ) = intent.id
         )
       GROUP BY intent.mutation_group_id
       HAVING count(*) = ?
          AND count(DISTINCT intent.id) = ?
          AND count(DISTINCT intent.proposed_sort_order) = ?`,
    )
    .bind(
      payload,
      input.entityType,
      actor.organizationId,
      input.items.length,
      actor.profileId,
      input.items.length,
      `taxonomy.${input.entityType}_reordered`,
      input.items.length,
      input.items.length,
      input.items.length,
    )
    .first<Record<string, unknown>>();
  return readExactMatchCount(row) === input.items.length;
}

function readExactMatchCount(
  row: Record<string, unknown> | null,
): number {
  if (row === null) return 0;
  return parseFiniteInteger(row.match_count, {
    path: "taxonomy.recoveryMatchCount",
    minimum: 0,
  });
}

async function runTaxonomyMutationBatch(
  database: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
  expectedChanges?: readonly number[],
  recognizeCommitted?: () => Promise<boolean>,
): Promise<void> {
  const exactChanges =
    expectedChanges ?? statements.map(() => 1);
  if (exactChanges.length !== statements.length) {
    throw new TypeError("Taxonomy batch expectations are misconfigured.");
  }
  try {
    const results = await database.batch(statements);
    if (
      results.some((result) => result.success === false) ||
      results.some(
        (result, index) =>
          statementChanges(result) !== exactChanges[index],
      )
    ) {
      throw new OrganizerTaxonomyStaleError();
    }
  } catch (error) {
    if (recognizeCommitted !== undefined) {
      try {
        if (await recognizeCommitted()) return;
      } catch {
        // Recovery is deliberately fail-closed; the original error is safer.
      }
    }
    throw mapTaxonomyMutationError(error);
  }
}

function taxonomyAuditSentinel(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
  input: Readonly<{
    action: string;
    entityId: string;
    entityType: OrganizerTaxonomyEntityType;
    expectedPreviousChanges: number;
    metadataJson: string;
    now: number;
  }>,
): D1PreparedStatementLike {
  return database
    .prepare(
      `INSERT INTO audit_logs (
         id, organization_id, actor_profile_id, action,
         entity_type, entity_id, metadata_json, created_at
       )
       VALUES (
         ?, ?, ?,
         CASE WHEN changes() = ?
                    AND ${COMMIT_ACTOR_GUARD_SQL}
              THEN ? ELSE NULL END,
         ?, ?, ?, ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      actor.organizationId,
      actor.profileId,
      input.expectedPreviousChanges,
      ...actorGuardBindings(identity, actor),
      input.action,
      `event_${input.entityType}`,
      input.entityId,
      input.metadataJson,
      input.now,
    );
}

async function readTaxonomyItemForMutation(
  database: D1DatabaseLike,
  actor: AuthorizedMembership,
  entityType: OrganizerTaxonomyEntityType,
  id: string,
): Promise<OrganizerTaxonomyMutationItem> {
  const rows = await readWorkspaceForActor(database, actor);
  const item = (entityType === "lane" ? rows.lanes : rows.categories).find(
    (candidate) => candidate.id === id,
  );
  if (!item) throw new OrganizerTaxonomyNotFoundError();
  const timestampRow = await database
    .prepare(
      `SELECT deleted_at
       FROM ${baseTable(entityType)}
       WHERE id = ?
         AND organization_id = ?`,
    )
    .bind(id, actor.organizationId)
    .first<Record<string, unknown>>();
  if (!timestampRow) throw new OrganizerTaxonomyNotFoundError();
  return Object.freeze({
    ...item,
    deletedAt:
      timestampRow.deleted_at === null ||
      timestampRow.deleted_at === undefined
        ? null
        : parseFiniteInteger(timestampRow.deleted_at, {
            path: "taxonomy.deletedAt",
            minimum: 0,
          }),
  });
}

async function taxonomyReferenceCount(
  database: D1DatabaseLike,
  organizationId: string,
  entityType: OrganizerTaxonomyEntityType,
  id: string,
): Promise<number> {
  const laneAdditional =
    entityType === "lane"
      ? `+
         (SELECT count(*) FROM club_public_profiles
          WHERE organization_id = ? AND primary_event_lane_id = ?)
         +
         (SELECT count(*) FROM program_public_profile_details
          WHERE organization_id = ? AND primary_event_lane_id = ?)
         +
         (SELECT count(*) FROM cms_entity_revisions
          WHERE organization_id = ?
            AND entity_type IN (
              'club_public_profile',
              'program_public_profile'
            )
            AND json_valid(snapshot_json)
            AND json_extract(snapshot_json, '$.laneId') = ?)`
      : "";
  const row = await database
    .prepare(
      `SELECT (
         (SELECT count(*) FROM organizer_events
          WHERE organization_id = ? AND ${
            entityType === "lane" ? "event_lane_id" : "category_id"
          } = ?)
         +
         (SELECT count(*) FROM events
          WHERE organization_id = ? AND ${
            entityType === "lane" ? "event_lane_id" : "category_id"
          } = ?)
         ${laneAdditional}
       ) AS reference_count`,
    )
    .bind(
      organizationId,
      id,
      organizationId,
      id,
      ...(entityType === "lane"
        ? [
            organizationId,
            id,
            organizationId,
            id,
            organizationId,
            id,
          ]
        : []),
    )
    .first<Record<string, unknown>>();
  return parseFiniteInteger(row?.reference_count, {
    path: "taxonomy.referenceCount",
    minimum: 0,
  });
}

async function nextTaxonomySortOrder(
  database: D1DatabaseLike,
  organizationId: string,
  entityType: OrganizerTaxonomyEntityType,
): Promise<number> {
  const row = await database
    .prepare(
      entityType === "lane"
        ? `SELECT min(
             COALESCE(max(lane.sort_order), 0) + 10,
             ?
           ) AS next_sort_order
           FROM event_lanes AS lane
           WHERE lane.organization_id = ?`
        : `SELECT min(
             COALESCE(max(state.sort_order), 0) + 10,
             ?
           ) AS next_sort_order
           FROM category_taxonomy_states AS state
           WHERE state.organization_id = ?`,
    )
    .bind(TAXONOMY_SORT_ORDER_MAX, organizationId)
    .first<Record<string, unknown>>();
  return parseFiniteInteger(row?.next_sort_order, {
    path: "taxonomy.nextSortOrder",
    minimum: 0,
    maximum: TAXONOMY_SORT_ORDER_MAX,
  });
}

async function assertTaxonomyCapacity(
  database: D1DatabaseLike,
  organizationId: string,
  entityType: OrganizerTaxonomyEntityType,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT count(*) AS item_count
       FROM ${baseTable(entityType)}
       WHERE organization_id = ?`,
    )
    .bind(organizationId)
    .first<Record<string, unknown>>();
  const count = parseFiniteInteger(row?.item_count, {
    path: "taxonomy.itemCount",
    minimum: 0,
  });
  if (count >= TAXONOMY_MAX_ITEMS) {
    throw new SafeApplicationError(
      "conflict",
      409,
      "This taxonomy has reached its supported item limit.",
    );
  }
}

function parseTaxonomyCreate(inputValue: unknown): ParsedTaxonomyCreate {
  const input = parseObject(inputValue);
  assertOnlyKeys(input, [
    "colorToken",
    "description",
    "entityType",
    "name",
    "slug",
    "sortOrder",
  ]);
  const entityType = parseEnum(
    input.entityType,
    TAXONOMY_ENTITY_TYPES,
    "entityType",
  );
  return Object.freeze({
    ...parseTaxonomyFields(input, entityType),
    entityType,
    slug: parseTaxonomyCreateSlug(input.slug, input.name),
    sortOrder:
      input.sortOrder === undefined || input.sortOrder === null
        ? null
        : parseFiniteInteger(input.sortOrder, {
            path: "sortOrder",
            minimum: 0,
            maximum: TAXONOMY_SORT_ORDER_MAX,
          }),
  });
}

function parseTaxonomyAction(inputValue: unknown): ParsedTaxonomyAction {
  const input = parseObject(inputValue);
  const action = parseEnum(input.action, TAXONOMY_ACTIONS, "action");
  const entityType = parseEnum(
    input.entityType,
    TAXONOMY_ENTITY_TYPES,
    "entityType",
  );
  if (action === "update") {
    assertOnlyKeys(input, [
      "action",
      "colorToken",
      "description",
      "entityType",
      "expectedContentVersion",
      "id",
      "name",
    ]);
    return Object.freeze({
      action,
      entityType,
      expectedContentVersion: parseExpectedVersion(
        input.expectedContentVersion,
      ),
      id: parseIdentifier(input.id, "id"),
      ...parseTaxonomyFields(input, entityType),
    });
  }
  if (action === "reorder") {
    assertOnlyKeys(input, ["action", "entityType", "items"]);
    if (!Array.isArray(input.items)) {
      throw validationIssue(
        "items",
        "invalid_type",
        "Expected an ordered list.",
      );
    }
    if (
      input.items.length < 1 ||
      input.items.length > TAXONOMY_MAX_ITEMS
    ) {
      throw validationIssue(
        "items",
        "invalid_length",
        "The ordered list has an invalid length.",
      );
    }
    const ids = new Set<string>();
    const items = input.items.map((value, index) => {
      const item = parseObject(value, `items.${index}`);
      assertOnlyKeys(
        item,
        ["expectedContentVersion", "id"],
        `items.${index}`,
      );
      const id = parseIdentifier(item.id, `items.${index}.id`);
      if (ids.has(id)) {
        throw validationIssue(
          "items",
          "duplicate_item",
          "The ordered list contains duplicate items.",
        );
      }
      ids.add(id);
      return Object.freeze({
        expectedContentVersion: parseExpectedVersion(
          item.expectedContentVersion,
          `items.${index}.expectedContentVersion`,
        ),
        id,
      });
    });
    return Object.freeze({
      action,
      entityType,
      items: Object.freeze(items),
    });
  }
  assertOnlyKeys(input, [
    "action",
    "entityType",
    "expectedContentVersion",
    "id",
  ]);
  return Object.freeze({
    action,
    entityType,
    expectedContentVersion: parseExpectedVersion(
      input.expectedContentVersion,
    ),
    id: parseIdentifier(input.id, "id"),
  });
}

function parseTaxonomyFields(
  input: Record<string, unknown>,
  entityType: OrganizerTaxonomyEntityType,
): ParsedTaxonomyFields {
  const colorToken =
    entityType === "category"
      ? parseOptionalBoundedString(input.colorToken, {
          path: "colorToken",
          maxLength: TAXONOMY_COLOR_TOKEN_MAX,
        })
      : null;
  if (colorToken !== null && !isTaxonomyColorToken(colorToken)) {
    throw validationIssue(
      "colorToken",
      "invalid_format",
      "Use a lowercase color token.",
    );
  }
  return Object.freeze({
    colorToken,
    description: parseOptionalBoundedString(input.description, {
      path: "description",
      maxLength: TAXONOMY_DESCRIPTION_MAX,
    }),
    name: parseBoundedString(input.name, {
      path: "name",
      minLength: 1,
      maxLength: TAXONOMY_NAME_MAX,
    }),
  });
}

function parseTaxonomySlug(value: unknown): string {
  const slug = parseBoundedString(value, {
    path: "slug",
    minLength: 1,
    maxLength: TAXONOMY_SLUG_MAX,
  }).toLocaleLowerCase("en-CA");
  if (!isTaxonomySlug(slug)) {
    throw validationIssue(
      "slug",
      "invalid_format",
      "Use a lowercase URL-safe slug.",
    );
  }
  return slug;
}

function parseTaxonomyCreateSlug(
  value: unknown,
  nameValue: unknown,
): string {
  if (value !== undefined && value !== null && value !== "") {
    return parseTaxonomySlug(value);
  }
  const name = parseBoundedString(nameValue, {
    path: "name",
    minLength: 1,
    maxLength: TAXONOMY_NAME_MAX,
  });
  const derived = deriveTaxonomySlug(name);
  if (!isTaxonomySlug(derived)) {
    throw validationIssue(
      "slug",
      "invalid_format",
      "Add a URL-safe slug for this name.",
    );
  }
  return derived;
}

function parseExpectedVersion(
  value: unknown,
  path = "expectedContentVersion",
): number {
  return parseFiniteInteger(value, {
    path,
    minimum: 1,
    maximum: 2_147_483_647,
  });
}

function parseNow(value: unknown): number {
  return parseFiniteInteger(value, {
    path: "nowUtcMs",
    minimum: 0,
  });
}

function taxonomyItemFromRow(
  row: Record<string, unknown>,
  entityType: OrganizerTaxonomyEntityType,
): OrganizerTaxonomyItemDto {
  const archived =
    row.deleted_at !== null && row.deleted_at !== undefined;
  const organizerEventCount = parseFiniteInteger(
    row.organizer_event_count,
    {
      path: "taxonomy.organizerEventCount",
      minimum: 0,
    },
  );
  const legacyEventCount = parseFiniteInteger(row.legacy_event_count, {
    path: "taxonomy.legacyEventCount",
    minimum: 0,
  });
  const publicProfileCount = parseFiniteInteger(
    row.public_profile_count,
    {
      path: "taxonomy.publicProfileCount",
      minimum: 0,
    },
  );
  const blockerValues: OrganizerTaxonomyBlockerDto[] = [];
  if (organizerEventCount > 0) {
    blockerValues.push(
      Object.freeze({
        count: organizerEventCount,
        label: "Organizer event records",
      }),
    );
  }
  if (legacyEventCount > 0) {
    blockerValues.push(
      Object.freeze({
        count: legacyEventCount,
        label: "Imported or synchronized event records",
      }),
    );
  }
  if (publicProfileCount > 0) {
    blockerValues.push(
      Object.freeze({
        count: publicProfileCount,
        label: "Club or Program public profiles",
      }),
    );
  }
  const blockers = Object.freeze(blockerValues);
  const slug = parseTaxonomySlug(row.slug);
  const canArchive =
    !archived &&
    (entityType === "category" ||
      (publicProfileCount === 0 && !CANONICAL_LANE_SLUGS.has(slug)));
  return Object.freeze({
    archived,
    blockers,
    canArchive,
    canDelete:
      archived &&
      blockers.length === 0 &&
      (entityType === "category" || !CANONICAL_LANE_SLUGS.has(slug)),
    colorToken: entityType === "category"
      ? parseOptionalBoundedString(row.color_token, {
          path: "taxonomy.colorToken",
          maxLength: TAXONOMY_COLOR_TOKEN_MAX,
        })
      : null,
    contentVersion: parseFiniteInteger(row.content_version, {
      path: "taxonomy.contentVersion",
      minimum: 1,
    }),
    description: parseOptionalBoundedString(row.description, {
      path: "taxonomy.description",
      maxLength: TAXONOMY_DESCRIPTION_MAX,
    }),
    id: parseIdentifier(row.id, "taxonomy.id"),
    name: parseBoundedString(row.name, {
      path: "taxonomy.name",
      maxLength: TAXONOMY_NAME_MAX,
    }),
    slug,
    sortOrder: parseFiniteInteger(row.sort_order, {
      path: "taxonomy.sortOrder",
      minimum: 0,
      maximum: TAXONOMY_SORT_ORDER_MAX,
    }),
  });
}

function baseTable(entityType: OrganizerTaxonomyEntityType): string {
  return entityType === "lane" ? "event_lanes" : "categories";
}

function baseIdColumn(entityType: OrganizerTaxonomyEntityType): string {
  return entityType === "lane" ? "id" : "id";
}

function stateTableName(entityType: OrganizerTaxonomyEntityType): string {
  return entityType === "lane"
    ? "event_lane_taxonomy_states"
    : "category_taxonomy_states";
}

function stateIdColumnName(
  entityType: OrganizerTaxonomyEntityType,
): string {
  return entityType === "lane" ? "lane_id" : "category_id";
}

function actorGuardBindings(
  identity: TrustedServerIdentity,
  actor: AuthorizedMembership,
): readonly [string, string, string, string] {
  return [
    actor.membershipId,
    actor.organizationId,
    actor.profileId,
    identity.email,
  ];
}

function statementChanges(result: Readonly<{
  meta?: Readonly<{ changes?: number }>;
}>): number {
  return Number(result.meta?.changes ?? 0);
}

function mapTaxonomyMutationError(error: unknown): Error {
  if (error instanceof SafeApplicationError) return error;
  const message = error instanceof Error ? error.message : "";
  if (
    /UNIQUE constraint failed: (?:event_lanes|categories)\.organization_id/iu.test(
      message,
    )
  ) {
    return new SafeApplicationError(
      "conflict",
      409,
      "That taxonomy slug is already in use.",
    );
  }
  if (/NOT NULL constraint failed: audit_logs\.action/iu.test(message)) {
    return new OrganizerTaxonomyStaleError();
  }
  if (
    /phase6_(?:lane|category)_taxonomy_delete_blocked/iu.test(message)
  ) {
    return new OrganizerTaxonomyInUseError();
  }
  if (
    /phase6_(?:taxonomy_intent_(?:invalid|incomplete)|(?:lane|category)_taxonomy_(?:state_mismatch|write_invalid|write_required))/iu.test(
      message,
    ) ||
    /UNIQUE constraint failed: taxonomy_write_intents\./iu.test(message)
  ) {
    return new OrganizerTaxonomyStaleError();
  }
  return new SafeApplicationError(
    "internal_error",
    500,
    "The taxonomy change could not be completed safely.",
  );
}
