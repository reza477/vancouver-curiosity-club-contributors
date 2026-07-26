import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  OrganizerAccessDeniedError,
  generateInvitationToken,
  hashInvitationToken,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { ensureDatabaseInvariantsReady } from "../database/invariant-ready.mjs";
import {
  acceptOrganizerInvitation,
  createOrganizerInvitation,
  listOrganizerInvitations,
  revokeOrganizerInvitation,
} from "../../lib/server/organizer/invitations.ts";
import {
  TeamMutationBlockedError,
  listTeamMembers,
  transferWorkspaceOwnership,
  updateTeamMember,
} from "../../lib/server/organizer/team.ts";
import {
  getOrganizerProfile,
  updateOrganizerProfile,
} from "../../lib/server/organizer/profiles.ts";
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "../../lib/server/organizer/settings.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  prepareNotificationInsert,
  setNotificationReadState,
  updateNotificationPreferenceMode,
} from "../../lib/server/organizer/notifications.ts";
import {
  ClubArchiveBlockedError,
  archivePrivateOrganizerClub,
  createPrivateOrganizerClub,
  listOrganizerClubs,
  updateOrganizerClub,
} from "../../lib/server/organizer/clubs.ts";
import { listActivityHistory } from "../../lib/server/organizer/activity.ts";
import { consumeOrganizerRateLimit } from "../../lib/server/organizer/rate-limit.ts";
import {
  createOrganizerEvent,
  softDeleteOrganizerEvent,
} from "../../lib/server/organizer/events.ts";
import { listUpcomingPublicEvents } from "../../lib/server/public/events.ts";
import { SqliteD1TestDatabase } from "../auth/sqlite-d1.mjs";

function migrationSql() {
  return readdirSync(join(process.cwd(), "drizzle"))
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort()
    .map((name) =>
      readFileSync(join(process.cwd(), "drizzle", name), "utf8"),
    )
    .join("\n");
}

async function newDatabase() {
  const database = new SqliteD1TestDatabase(migrationSql());
  await ensureDatabaseInvariantsReady(database);
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_at, updated_at, deleted_at
    ) VALUES (
      'org_vcc', 'Vancouver Curiosity and Education Society',
      'vancouver-curiosity-and-education-society',
      'America/Vancouver', 1, 1, 1, NULL
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, description,
      created_at, updated_at, deleted_at
    ) VALUES
      ('club_think', 'org_vcc', 'Think Club', 'think-club', NULL, 1, 1, NULL),
      ('club_make', 'org_vcc', 'Make Club', 'make-club', NULL, 1, 1, NULL);
  `);
  seedMember(database, {
    email: "owner@example.com",
    membershipId: "membership_owner",
    profileId: "profile_owner",
    role: "owner",
  });
  database.exec(`
    INSERT INTO organizer_conflict_policies (
      id, organization_id, mode, policy_version, default_hold_hours,
      nearing_expiry_hours, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'phase4-policy-org-vcc', 'org_vcc', 'warn_reason', 1, 72, 24,
      'profile_owner', 1, 1
    );
  `);
  return database;
}

function seedMember(
  database,
  {
    clubIds = [],
    email,
    membershipId,
    profileId,
    role,
    status = "active",
  },
) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status,
      created_at, updated_at, deleted_at
    ) VALUES (
      '${profileId}', 'email:${email}', '${email}', '${role} Person',
      0, 'active', 1, 1, NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email,
      role, status, created_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      '${membershipId}', 'org_vcc', '${profileId}', '${email}',
      '${role}', '${status}', 'profile_owner', 1, 1, NULL
    );
  `);
  for (const [index, clubId] of clubIds.entries()) {
    database.exec(`
      INSERT INTO club_memberships (
        id, organization_id, club_id, organization_membership_id,
        profile_id, role, status, created_by_profile_id,
        created_at, updated_at, deleted_at
      ) VALUES (
        'assignment_${profileId}_${index}', 'org_vcc', '${clubId}',
        '${membershipId}', '${profileId}', 'organizer', 'active',
        'profile_owner', 1, 1, NULL
      );
    `);
  }
}

function identity(email, displayName = "Test organizer") {
  return trustedIdentityFromSites({ email, displayName });
}

test("invitation wrappers rate-limit, redact, revoke, and atomically accept once", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");

  const created = await createOrganizerInvitation(
    database,
    owner,
    {
      clubId: "club_think",
      expiresAt: 500_000,
      intendedRole: "organizer",
      targetEmail: "invitee@example.com",
    },
    100_000,
  );
  assert.match(
    created.copyablePath,
    /^\/accept-invitation\?token=[A-Za-z0-9_-]{43}$/u,
  );
  const token = new URL(
    created.copyablePath,
    "https://example.test",
  ).searchParams.get("token");
  assert.ok(token);

  const listed = await listOrganizerInvitations(
    database,
    owner,
    100_001,
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].targetEmail, "invitee@example.com");
  assert.equal(listed[0].state, "pending");
  const serializedList = JSON.stringify(listed);
  assert.equal(serializedList.includes(token), false);
  assert.equal(serializedList.includes("token_hash"), false);

  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("wrong@example.com"),
      token,
      100_002,
    ),
    OrganizerAccessDeniedError,
  );
  const accepted = await acceptOrganizerInvitation(
    database,
    identity("invitee@example.com", "Invitee"),
    token,
    100_003,
  );
  assert.deepEqual(accepted, { role: "organizer" });
  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("invitee@example.com"),
      token,
      100_004,
    ),
    OrganizerAccessDeniedError,
  );

  const membership = await database
    .prepare(
      `SELECT role, status
       FROM organization_memberships
       WHERE normalized_email = 'invitee@example.com'`,
    )
    .first();
  assert.deepEqual({ ...membership }, {
    role: "organizer",
    status: "active",
  });
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM club_memberships
         WHERE profile_id = (
           SELECT id FROM profiles
           WHERE normalized_email = 'invitee@example.com'
         )
           AND club_id = 'club_think'
           AND status = 'active'`,
      )
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM notifications
         WHERE recipient_profile_id = 'profile_owner'
           AND type = 'invitation_accepted'`,
      )
      .first("count"),
    1,
  );
  const auditText = JSON.stringify(
    await database
      .prepare(
        `SELECT action, metadata_json
         FROM audit_logs
         WHERE entity_type IN ('invitation', 'membership')
         ORDER BY created_at`,
      )
      .all(),
  );
  assert.equal(auditText.includes(token), false);
  assert.equal(auditText.includes("invitee@example.com"), false);

  const second = await createOrganizerInvitation(
    database,
    owner,
    {
      clubId: null,
      expiresAt: 500_000,
      intendedRole: "administrator",
      targetEmail: "admin@example.com",
    },
    100_010,
  );
  const revoked = await revokeOrganizerInvitation(
    database,
    owner,
    second.invitation.id,
    100_011,
  );
  assert.equal(revoked.state, "revoked");
  const secondToken = new URL(
    second.copyablePath,
    "https://example.test",
  ).searchParams.get("token");
  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("admin@example.com"),
      secondToken,
      100_012,
    ),
    OrganizerAccessDeniedError,
  );
});

test("missing SIWC full name never substitutes the private email into team or notification DTOs", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  seedMember(database, {
    clubIds: ["club_think"],
    email: "viewer@example.com",
    membershipId: "membership_viewer",
    profileId: "profile_viewer",
    role: "organizer",
  });
  const created = await createOrganizerInvitation(
    database,
    identity("owner@example.com", "Owner"),
    {
      clubId: "club_think",
      expiresAt: 500_000,
      intendedRole: "organizer",
      targetEmail: "private-account@example.com",
    },
    100_000,
  );
  const token = new URL(
    created.copyablePath,
    "https://example.test",
  ).searchParams.get("token");
  const noNameIdentity = trustedIdentityFromSites({
    email: "private-account@example.com",
  });
  assert.equal(noNameIdentity.displayName, "Organizer");
  await acceptOrganizerInvitation(
    database,
    noNameIdentity,
    token,
    100_001,
  );

  const acceptedProfile = await database
    .prepare(
      `SELECT id, display_name
       FROM profiles
       WHERE normalized_email = 'private-account@example.com'`,
    )
    .first();
  assert.equal(acceptedProfile.display_name, "Organizer");
  const notificationPayloads = JSON.stringify(
    await database
      .prepare(
        `SELECT payload_json
         FROM notifications
         WHERE type = 'invitation_accepted'`,
      )
      .all(),
  );
  assert.equal(
    notificationPayloads.includes("private-account@example.com"),
    false,
  );

  const organizerView = await listTeamMembers(
    database,
    identity("viewer@example.com", "Viewer"),
  );
  const acceptedMember = organizerView.find(
    (member) => member.profileId === acceptedProfile.id,
  );
  assert.ok(acceptedMember);
  assert.equal(acceptedMember.displayName, "Organizer");
  assert.equal("email" in acceptedMember, false);
  assert.equal(
    JSON.stringify(acceptedMember).includes("private-account@example.com"),
    false,
  );
});

test("invitation service rejects Owner, cross-organization clubs, malformed and expired tokens", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_at, updated_at, deleted_at
    ) VALUES (
      'org_other', 'Other', 'other', 'America/Vancouver',
      NULL, 1, 1, NULL
    );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_at, updated_at, deleted_at
    ) VALUES (
      'club_other', 'org_other', 'Other', 'other', 1, 1, NULL
    );
  `);
  const owner = identity("owner@example.com");
  seedMember(database, {
    email: "admin@example.com",
    membershipId: "membership_admin",
    profileId: "profile_admin",
    role: "administrator",
  });
  seedMember(database, {
    clubIds: ["club_think"],
    email: "organizer@example.com",
    membershipId: "membership_organizer",
    profileId: "profile_organizer",
    role: "organizer",
  });

  await assert.rejects(
    createOrganizerInvitation(
      database,
      owner,
      {
        expiresAt: 500_000,
        intendedRole: "owner",
        targetEmail: "new@example.com",
      },
      100_000,
    ),
  );
  await assert.rejects(
    createOrganizerInvitation(
      database,
      owner,
      {
        clubId: "club_other",
        expiresAt: 500_000,
        intendedRole: "organizer",
        targetEmail: "new@example.com",
      },
      100_000,
    ),
    OrganizerAccessDeniedError,
  );
  const organizerInvitationByAdmin = await createOrganizerInvitation(
    database,
    identity("admin@example.com"),
    {
      clubId: "club_think",
      expiresAt: 500_000,
      intendedRole: "organizer",
      targetEmail: "admin-invited-organizer@example.com",
    },
    100_001,
  );
  assert.equal(
    organizerInvitationByAdmin.invitation.intendedRole,
    "organizer",
  );
  assert.equal(
    (
      await revokeOrganizerInvitation(
        database,
        identity("admin@example.com"),
        organizerInvitationByAdmin.invitation.id,
        100_002,
      )
    ).state,
    "revoked",
  );
  await assert.rejects(
    createOrganizerInvitation(
      database,
      identity("admin@example.com"),
      {
        expiresAt: 500_000,
        intendedRole: "administrator",
        targetEmail: "second-admin@example.com",
      },
      100_000,
    ),
    OrganizerAccessDeniedError,
  );
  await assert.rejects(
    createOrganizerInvitation(
      database,
      identity("organizer@example.com"),
      {
        clubId: "club_think",
        expiresAt: 500_000,
        intendedRole: "organizer",
        targetEmail: "other-organizer@example.com",
      },
      100_000,
    ),
    OrganizerAccessDeniedError,
  );
  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("new@example.com"),
      "malformed",
      100_000,
    ),
  );
  const crossOrganizationToken = generateInvitationToken();
  const crossOrganizationHash = await hashInvitationToken(
    crossOrganizationToken,
  );
  await database
    .prepare(
      `INSERT INTO invitations (
         id, organization_id, club_id, token_hash,
         target_normalized_email, intended_role,
         created_by_profile_id, expires_at,
         revoked_at, used_at, used_by_profile_id,
         created_at, updated_at
       )
       VALUES (
         'invitation_cross_org', 'org_vcc', 'club_other', ?,
         'cross@example.com', 'organizer',
         'profile_owner', 500000,
         NULL, NULL, NULL, 100000, 100000
       )`,
    )
    .bind(crossOrganizationHash)
    .run();
  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("cross@example.com"),
      crossOrganizationToken,
      100_003,
    ),
    OrganizerAccessDeniedError,
  );
  assert.deepEqual(
    {
      usedAt: await database
        .prepare(
          `SELECT used_at FROM invitations
           WHERE id = 'invitation_cross_org'`,
        )
        .first("used_at"),
      membershipCount: await database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM organization_memberships
           WHERE normalized_email = 'cross@example.com'`,
        )
        .first("count"),
    },
    { usedAt: null, membershipCount: 0 },
  );

  const expired = await createOrganizerInvitation(
    database,
    owner,
    {
      expiresAt: 105 * 60_000,
      intendedRole: "administrator",
      targetEmail: "expired@example.com",
    },
    100 * 60_000,
  );
  const expiredToken = new URL(
    expired.copyablePath,
    "https://example.test",
  ).searchParams.get("token");
  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      identity("expired@example.com"),
      expiredToken,
      105 * 60_000,
    ),
    OrganizerAccessDeniedError,
  );
});

test("durable rate limits survive isolated bindings without storing scope material", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const isolated = () => ({
    batch: (statements) => database.batch(statements),
    prepare: (sql) => database.prepare(sql),
  });
  for (let index = 0; index < 2; index += 1) {
    await consumeOrganizerRateLimit(isolated(), {
      action: "invitation_accept",
      scopeMaterial: "private-scope@example.com",
      limit: 2,
      windowMs: 60_000,
      nowUtcMs: 10_000,
    });
  }
  await assert.rejects(
    consumeOrganizerRateLimit(isolated(), {
      action: "invitation_accept",
      scopeMaterial: "private-scope@example.com",
      limit: 2,
      windowMs: 60_000,
      nowUtcMs: 10_001,
    }),
    (error) => error?.status === 429 && error?.code === "rate_limited",
  );
  const persisted = await database
    .prepare(
      `SELECT scope_key, request_count
       FROM organizer_rate_limits`,
    )
    .first();
  assert.match(persisted.scope_key, /^[a-f0-9]{64}$/u);
  assert.equal(
    persisted.scope_key.includes("private-scope@example.com"),
    false,
  );
  assert.equal(persisted.request_count, 2);
});

test("invitation acceptance rate limit cannot be bypassed by rotating invalid tokens", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const attemptedIdentity = identity("rotating-attempts@example.com");

  for (let index = 0; index < 12; index += 1) {
    const token = Buffer.alloc(32, index + 1).toString("base64url");
    await assert.rejects(
      acceptOrganizerInvitation(
        database,
        attemptedIdentity,
        token,
        10_000 + index,
      ),
      OrganizerAccessDeniedError,
    );
  }

  await assert.rejects(
    acceptOrganizerInvitation(
      database,
      attemptedIdentity,
      Buffer.alloc(32, 99).toString("base64url"),
      10_020,
    ),
    (error) => error?.status === 429 && error?.code === "rate_limited",
  );

  const persisted = await database
    .prepare(
      `SELECT COUNT(*) AS rows, MAX(request_count) AS max_count
       FROM organizer_rate_limits
       WHERE action = 'invitation_accept'`,
    )
    .first();
  assert.deepEqual({ ...persisted }, { max_count: 12, rows: 13 });
  assert.equal(
    JSON.stringify(persisted).includes("rotating-attempts@example.com"),
    false,
  );
});

test("team permissions hide email from Organizers and block owned/co-organized private or legacy records", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "admin@example.com",
    membershipId: "membership_admin",
    profileId: "profile_admin",
    role: "administrator",
  });
  seedMember(database, {
    clubIds: ["club_think"],
    email: "organizer@example.com",
    membershipId: "membership_organizer",
    profileId: "profile_organizer",
    role: "organizer",
  });
  seedMember(database, {
    clubIds: ["club_think"],
    email: "co@example.com",
    membershipId: "membership_co",
    profileId: "profile_co",
    role: "organizer",
  });

  const ownerView = await listTeamMembers(
    database,
    identity("owner@example.com"),
  );
  assert.ok(ownerView.every((member) => typeof member.email === "string"));
  const organizerView = await listTeamMembers(
    database,
    identity("organizer@example.com"),
  );
  assert.ok(organizerView.every((member) => !("email" in member)));

  await assert.rejects(
    updateTeamMember(
      database,
      identity("admin@example.com"),
      "membership_admin",
      { status: "suspended" },
      10_000,
    ),
    OrganizerAccessDeniedError,
  );
  await assert.rejects(
    updateTeamMember(
      database,
      identity("admin@example.com"),
      "membership_owner",
      { status: "suspended" },
      10_000,
    ),
    OrganizerAccessDeniedError,
  );
  const updatedOrganizer = await updateTeamMember(
    database,
    identity("admin@example.com"),
    "membership_organizer",
    {
      clubIds: ["club_think", "club_make"],
      role: "organizer",
      status: "active",
    },
    10_001,
  );
  assert.deepEqual(
    updatedOrganizer.clubs.map((club) => club.id).sort(),
    ["club_make", "club_think"],
  );
  await assert.rejects(
    updateTeamMember(
      database,
      identity("owner@example.com"),
      "membership_cross_org",
      { status: "suspended" },
      10_002,
    ),
    (error) => error?.status === 404,
  );

  const manualEvent = await createOrganizerEvent(
    database,
    identity("organizer@example.com"),
    {
      clubId: "club_think",
      coOrganizerProfileIds: ["profile_co"],
      planningStatus: "idea",
      primaryOrganizerProfileId: "profile_organizer",
      publicationStatus: "private",
      scheduleShape: "unscheduled",
      timeZone: "America/Vancouver",
      title: "Manual idea",
    },
  );
  database.exec(`
    INSERT INTO events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, status, visibility, time_kind,
      starts_at_utc, ends_at_utc, timezone,
      buffer_before_minutes, buffer_after_minutes,
      organizer_scope_json, schedule_version, schedule_review_state,
      created_by_profile_id, updated_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      'legacy_event', 'org_vcc', 'club_think', 'profile_organizer',
      'Read-only confirmed event', 'read-only-confirmed-event',
      'confirmed', 'private', 'timed',
      1000000, 1100000, 'America/Vancouver',
      0, 0, '["profile_organizer"]', 1, 'unreviewed',
      'profile_owner', 'profile_owner', 1, 1, NULL
    );
  `);

  for (const membershipId of [
    "membership_organizer",
    "membership_co",
  ]) {
    await assert.rejects(
      updateTeamMember(
        database,
        identity("owner@example.com"),
        membershipId,
        { status: "suspended" },
        20_000,
      ),
      (error) =>
        error instanceof TeamMutationBlockedError &&
        error.blockers.length >= 1,
    );
  }
  let organizerBlockers;
  await assert.rejects(
    updateTeamMember(
      database,
      identity("owner@example.com"),
      "membership_organizer",
      { status: "revoked" },
      20_001,
    ),
    (error) => {
      organizerBlockers = error;
      return error instanceof TeamMutationBlockedError;
    },
  );
  assert.ok(
    organizerBlockers.blockers.some(
      (blocker) => blocker.source === "legacy_read_only",
    ),
  );

  await softDeleteOrganizerEvent(
    database,
    identity("organizer@example.com"),
    manualEvent.id,
    manualEvent.contentVersion,
    manualEvent.scheduleVersion,
  );
  await assert.rejects(
    updateTeamMember(
      database,
      identity("owner@example.com"),
      "membership_co",
      { status: "suspended" },
      20_003,
    ),
    (error) =>
      error instanceof TeamMutationBlockedError &&
      error.blockers.some(
        (blocker) =>
          blocker.eventId === manualEvent.id &&
          blocker.source === "manual",
      ),
  );
});

test("team updates recheck event blockers inside the mutation transaction", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  seedMember(database, {
    clubIds: ["club_think", "club_make"],
    email: "racing-organizer@example.com",
    membershipId: "membership_racing_organizer",
    profileId: "profile_racing_organizer",
    role: "organizer",
  });

  const originalBatch = database.batch.bind(database);
  let insertedConcurrentEvent = false;
  database.batch = async (statements) => {
    if (!insertedConcurrentEvent) {
      insertedConcurrentEvent = true;
      database.exec(`
        INSERT INTO organizer_events (
          id, organization_id, club_id, primary_organizer_profile_id,
          title, slug, planning_status, publication_status, schedule_shape,
          timezone, buffer_before_minutes, buffer_after_minutes,
          content_version, schedule_version,
          created_by_profile_id, updated_by_profile_id,
          created_at, updated_at, deleted_at
        ) VALUES (
          'concurrent_manual_event', 'org_vcc', 'club_make',
          'profile_racing_organizer',
          'Concurrent planning idea', 'concurrent-planning-idea',
          'idea', 'private', 'unscheduled', 'America/Vancouver',
          0, 0, 1, 1, 'profile_racing_organizer',
          'profile_racing_organizer', 1, 1, NULL
        );
      `);
    }
    return originalBatch(statements);
  };

  await assert.rejects(
    updateTeamMember(
      database,
      identity("owner@example.com"),
      "membership_racing_organizer",
      {
        clubIds: ["club_think"],
        role: "organizer",
        status: "active",
      },
      30_000,
    ),
    (error) => error?.status === 409,
  );

  const membership = await database
    .prepare(
      `SELECT role, status
       FROM organization_memberships
       WHERE id = 'membership_racing_organizer'`,
    )
    .first();
  assert.deepEqual({ ...membership }, {
    role: "organizer",
    status: "active",
  });
  const activeClubs = (
    await database
    .prepare(
      `SELECT club_id
       FROM club_memberships
       WHERE organization_membership_id = 'membership_racing_organizer'
         AND status = 'active'
         AND deleted_at IS NULL
       ORDER BY club_id`,
    )
    .all()
  ).results.map((row) => row.club_id);
  assert.deepEqual(activeClubs, ["club_make", "club_think"]);
});

test("ownership transfer is atomic, concurrent-safe, audited, and preserves exactly one active Owner", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "admin@example.com",
    membershipId: "membership_admin",
    profileId: "profile_admin",
    role: "administrator",
  });
  const owner = identity("owner@example.com", "Owner");
  const attempts = await Promise.allSettled([
    transferWorkspaceOwnership(
      database,
      owner,
      "membership_admin",
      20_000,
    ),
    transferWorkspaceOwnership(
      database,
      owner,
      "membership_admin",
      20_000,
    ),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.filter((result) => result.status === "rejected").length,
    1,
  );
  const activeOwners = await database
    .prepare(
      `SELECT id
       FROM organization_memberships
       WHERE organization_id = 'org_vcc'
         AND role = 'owner'
         AND status = 'active'
         AND deleted_at IS NULL`,
    )
    .all();
  assert.deepEqual(
    activeOwners.results.map((row) => row.id),
    ["membership_admin"],
  );
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count FROM ownership_transfer_locks`,
      )
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM audit_logs
         WHERE action = 'membership.ownership_transferred'`,
      )
      .first("count"),
    1,
  );
  assert.throws(() =>
    database.exec(`
      UPDATE organization_memberships
      SET role = 'owner'
      WHERE id = 'membership_owner';
    `),
  );
});

test("profiles, private settings, notifications, clubs, and allowlisted history remain scoped and auditable", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");

  database.exec(`
    UPDATE profiles
    SET display_name = 'Published Host',
        public_attribution_consent = 1,
        updated_at = 2
    WHERE id = 'profile_owner';
    INSERT INTO events (
      id, organization_id, club_id, primary_organizer_profile_id,
      title, slug, status, visibility, time_kind,
      starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, schedule_version, schedule_review_state,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event_public_profile_boundary', 'org_vcc', 'club_think',
      'profile_owner', 'Public profile boundary event',
      'public-profile-boundary-event', 'confirmed', 'public', 'timed',
      1900000000000, 1900003600000, 'America/Vancouver',
      '["profile_owner"]', 1, 'unreviewed', 1,
      'profile_owner', 'profile_owner', 1, 1
    );
    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role,
      is_publicly_listed, created_by_profile_id, created_at
    ) VALUES (
      'public-profile-boundary-organizer', 'org_vcc',
      'event_public_profile_boundary', 'profile_owner', 'primary',
      1, 'profile_owner', 1
    );
  `);
  const publicBeforeProfileDraft = await listUpcomingPublicEvents(database, {
    fromUtcMs: 1,
    organizationId: "org_vcc",
    todayDate: "2026-07-25",
  });
  assert.deepEqual(publicBeforeProfileDraft[0]?.organizers, [
    { displayName: "Published Host" },
  ]);

  const profile = await updateOrganizerProfile(
    database,
    owner,
    {
      calendarColor: "cobalt",
      displayName: "Reza",
      initials: "RJ",
      publicAttributionConsent: false,
      publicBiography: "Organizer profile draft.",
    },
    30_000,
  );
  assert.equal(profile.displayName, "Reza");
  assert.equal(profile.calendarColor, "cobalt");
  assert.equal(
    (await getOrganizerProfile(database, owner)).initials,
    "RJ",
  );
  assert.deepEqual(
    await listUpcomingPublicEvents(database, {
      fromUtcMs: 1,
      organizationId: "org_vcc",
      todayDate: "2026-07-25",
    }),
    publicBeforeProfileDraft,
    "private profile drafts cannot rename or remove a published host",
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT display_name, public_attribution_consent, updated_at
           FROM profiles
           WHERE id = 'profile_owner'`,
        )
        .first()),
    },
    {
      display_name: "Published Host",
      public_attribution_consent: 1,
      updated_at: 2,
    },
  );
  assert.equal(
    (await listTeamMembers(database, owner))[0]?.displayName,
    "Reza",
  );

  database.exec(`
    UPDATE profiles
    SET public_attribution_consent = 0
    WHERE id = 'profile_owner';
  `);
  const publicWithoutCanonicalConsent =
    await listUpcomingPublicEvents(database, {
      fromUtcMs: 1,
      organizationId: "org_vcc",
      todayDate: "2026-07-25",
    });
  await updateOrganizerProfile(
    database,
    owner,
    {
      calendarColor: "cobalt",
      displayName: "PRIVATE-PROFILE-SENTINEL",
      initials: "PS",
      publicAttributionConsent: true,
      publicBiography: "PRIVATE-BIOGRAPHY-SENTINEL",
    },
    30_001,
  );
  assert.deepEqual(
    await listUpcomingPublicEvents(database, {
      fromUtcMs: 1,
      organizationId: "org_vcc",
      todayDate: "2026-07-25",
    }),
    publicWithoutCanonicalConsent,
    "draft consent cannot add a public host",
  );
  await updateNotificationPreferenceMode(
    database,
    owner,
    "important_only",
    30_002,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT workspace_display_name,
                  public_attribution_consent_draft
           FROM organizer_profile_preferences
           WHERE profile_id = 'profile_owner'`,
        )
        .first()),
    },
    {
      workspace_display_name: "PRIVATE-PROFILE-SENTINEL",
      public_attribution_consent_draft: 1,
    },
  );

  const beforeOrganization = await database
    .prepare(
      `SELECT name, timezone FROM organizations WHERE id = 'org_vcc'`,
    )
    .first();
  const settings = await updateWorkspaceSettings(
    database,
    owner,
    {
      defaultTimezone: "America/Toronto",
      workspaceName: "Private planning room",
    },
    30_003,
  );
  assert.equal(settings.workspaceName, "Private planning room");
  assert.deepEqual(
    await getWorkspaceSettings(database, owner),
    settings,
  );
  assert.deepEqual(
    await database
      .prepare(
        `SELECT name, timezone FROM organizations WHERE id = 'org_vcc'`,
      )
      .first(),
    beforeOrganization,
  );

  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, owner_bootstrap_closed_at,
      created_at, updated_at, deleted_at
    ) VALUES (
      'org_external', 'External', 'external',
      'America/Vancouver', 1, 1, 1, NULL
    );
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name,
      public_attribution_consent, status,
      created_at, updated_at, deleted_at
    ) VALUES (
      'profile_external', 'email:external@example.com',
      'external@example.com', 'External organizer',
      0, 'active', 1, 1, NULL
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email,
      role, status, created_by_profile_id,
      created_at, updated_at, deleted_at
    ) VALUES (
      'membership_external', 'org_external', 'profile_external',
      'external@example.com', 'owner', 'active',
      'profile_external', 1, 1, NULL
    );
  `);
  const crossOrganizationNotification = await database.batch([
    prepareNotificationInsert(database, {
      organizationId: "org_vcc",
      recipientProfileId: "profile_external",
      createdAt: 30_003,
      payload: {
        type: "event_schedule_changed",
        eventId: "event_private",
        title: "Must not cross organizations",
      },
    }),
  ]);
  assert.equal(
    crossOrganizationNotification[0].meta.changes,
    0,
  );

  await database.batch([
    prepareNotificationInsert(database, {
      organizationId: "org_vcc",
      recipientProfileId: "profile_owner",
      createdAt: 30_003,
      payload: {
        type: "event_assignment",
        eventId: "event_quiet",
        title: "Routine assignment",
        email: "private@example.com",
        token: "never-store-this",
      },
    }),
    prepareNotificationInsert(database, {
      organizationId: "org_vcc",
      recipientProfileId: "profile_owner",
      createdAt: 30_004,
      payload: {
        type: "event_schedule_changed",
        eventId: "event_important",
        title: "Important schedule change",
        email: "private@example.com",
        token: "never-store-this",
      },
    }),
  ]);
  const page = await listNotifications(database, owner);
  assert.equal(page.notifications.length, 1);
  assert.equal(page.notifications[0].type, "event_schedule_changed");
  const persistedPayloads = JSON.stringify(
    await database
      .prepare(`SELECT payload_json FROM notifications`)
      .all(),
  );
  assert.equal(persistedPayloads.includes("private@example.com"), false);
  assert.equal(persistedPayloads.includes("never-store-this"), false);
  await setNotificationReadState(
    database,
    owner,
    page.notifications[0].id,
    true,
    30_005,
  );
  assert.equal((await listNotifications(database, owner)).unreadCount, 0);
  assert.deepEqual(
    await markAllNotificationsRead(database, owner, 30_006),
    { markedRead: 0 },
  );

  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: "Private planning only.",
      name: "Future Club",
      planningNotes: "Discuss scope internally.",
      slug: "future-club",
    },
    30_010,
  );
  assert.equal(privateClub.publicationState, "private");
  assert.equal(privateClub.identityEditable, true);
  const updatedClub = await updateOrganizerClub(
    database,
    owner,
    privateClub.id,
    {
      name: "Future Club Lab",
      slug: "future-club-lab",
      description: "Private planning only.",
      planningNotes: "Coordinate a first idea.",
    },
    30_011,
  );
  assert.equal(updatedClub.name, "Future Club Lab");
  seedMember(database, {
    clubIds: [privateClub.id],
    email: "clubmember@example.com",
    membershipId: "membership_clubmember",
    profileId: "profile_clubmember",
    role: "organizer",
  });
  await assert.rejects(
    archivePrivateOrganizerClub(
      database,
      owner,
      privateClub.id,
      30_012,
    ),
    (error) =>
      error instanceof ClubArchiveBlockedError &&
      error.memberCount === 1,
  );
  database.exec(`
    UPDATE club_memberships
    SET status = 'revoked'
    WHERE profile_id = 'profile_clubmember';
  `);
  assert.deepEqual(
    await archivePrivateOrganizerClub(
      database,
      owner,
      privateClub.id,
      30_013,
    ),
    { archived: true },
  );
  assert.equal(
    (await listOrganizerClubs(database, owner)).some(
      (club) => club.id === privateClub.id,
    ),
    false,
  );

  const activity = await listActivityHistory(database, owner, {
    limit: 100,
  });
  assert.ok(activity.length >= 6);
  const serialized = JSON.stringify(activity);
  assert.equal(serialized.includes("metadata_json"), false);
  assert.equal(serialized.includes("owner@example.com"), false);
  assert.equal(serialized.includes("Discuss scope internally"), false);
});

test("a concurrent public-profile change rolls back a private club identity update without settings or audit residue", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");
  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: "Private identity before the race.",
      name: "Race-safe Club",
      planningNotes: "Original internal note.",
      slug: "race-safe-club",
    },
    40_000,
  );
  database.exec(`
    INSERT INTO event_lanes (
      id, organization_id, name, slug, description, sort_order,
      created_by_profile_id, created_at, updated_at, deleted_at
    ) VALUES (
      'lane_race', 'org_vcc', 'Race lane', 'race-lane', NULL, 1,
      'profile_owner', 40001, 40001, NULL
    );
  `);

  const settingKey = `organizer_club:${privateClub.id}`;
  const settingBefore = await database
    .prepare(
      `SELECT value_json, updated_at
       FROM site_settings
       WHERE organization_id = 'org_vcc'
         AND key = ?`,
    )
    .bind(settingKey)
    .first();
  const auditCountBefore = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM audit_logs
       WHERE organization_id = 'org_vcc'
         AND entity_type = 'club'
         AND entity_id = ?
         AND action = 'club.private_settings_updated'`,
    )
    .bind(privateClub.id)
    .first("count");

  let injected = false;
  const racingDatabase = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!injected) {
        injected = true;
        database.exec(`
          INSERT INTO club_public_profiles (
            club_id, organization_id, primary_event_lane_id,
            publication_status, is_featured, description,
            public_group_url, published_at, created_at, updated_at, deleted_at
          ) VALUES (
            '${privateClub.id}', 'org_vcc', 'lane_race',
            'draft', 0, NULL, NULL, NULL, 40002, 40002, NULL
          );
        `);
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    updateOrganizerClub(
      racingDatabase,
      owner,
      privateClub.id,
      {
        description: "Identity that must not commit.",
        name: "Leaked Club Name",
        planningNotes: "This note must roll back.",
        slug: "leaked-club-name",
      },
      40_003,
    ),
    (error) => error?.code === "conflict" && error.status === 409,
  );

  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT name, slug, description
           FROM clubs
           WHERE id = ?`,
        )
        .bind(privateClub.id)
        .first()),
    },
    {
      description: "Private identity before the race.",
      name: "Race-safe Club",
      slug: "race-safe-club",
    },
  );
  assert.deepEqual(
    await database
      .prepare(
        `SELECT value_json, updated_at
         FROM site_settings
         WHERE organization_id = 'org_vcc'
           AND key = ?`,
      )
      .bind(settingKey)
      .first(),
    settingBefore,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM audit_logs
         WHERE organization_id = 'org_vcc'
           AND entity_type = 'club'
           AND entity_id = ?
           AND action = 'club.private_settings_updated'`,
      )
      .bind(privateClub.id)
      .first("count"),
    auditCountBefore,
  );
});

test("club update and archive commits reject a concurrently suspended or demoted administrator", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");
  seedMember(database, {
    email: "admin@example.com",
    membershipId: "membership_admin",
    profileId: "profile_admin",
    role: "administrator",
  });
  const administrator = identity("admin@example.com", "Administrator");
  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: "Race-protected.",
      name: "Actor Race Club",
      planningNotes: "Original note.",
      slug: "actor-race-club",
    },
    40_100,
  );

  let updateRaced = false;
  const suspendedBeforeUpdateBatch = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!updateRaced) {
        updateRaced = true;
        database.exec(`
          UPDATE organization_memberships
          SET status = 'suspended'
          WHERE id = 'membership_admin'
        `);
      }
      return database.batch(statements);
    },
  };
  await assert.rejects(
    updateOrganizerClub(
      suspendedBeforeUpdateBatch,
      administrator,
      privateClub.id,
      {
        description: "Must not commit.",
        name: "Unauthorized rename",
        planningNotes: "Must not commit.",
        slug: "unauthorized-rename",
      },
      40_101,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.deepEqual(
    {
      ...(await database
        .prepare(
          `SELECT name, slug, description
           FROM clubs
           WHERE id = ?`,
        )
        .bind(privateClub.id)
        .first()),
    },
    {
      description: "Race-protected.",
      name: "Actor Race Club",
      slug: "actor-race-club",
    },
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'club.private_settings_updated'
           AND entity_id = ?`,
      )
      .bind(privateClub.id)
      .first("count"),
    0,
  );

  database.exec(`
    UPDATE organization_memberships
    SET role = 'administrator', status = 'active'
    WHERE id = 'membership_admin'
  `);
  let archiveRaced = false;
  const demotedBeforeArchiveBatch = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!archiveRaced) {
        archiveRaced = true;
        database.exec(`
          UPDATE organization_memberships
          SET role = 'organizer'
          WHERE id = 'membership_admin'
        `);
      }
      return database.batch(statements);
    },
  };
  await assert.rejects(
    archivePrivateOrganizerClub(
      demotedBeforeArchiveBatch,
      administrator,
      privateClub.id,
      40_102,
    ),
    (error) => error instanceof OrganizerAccessDeniedError,
  );
  assert.equal(
    await database
      .prepare("SELECT deleted_at FROM clubs WHERE id = ?")
      .bind(privateClub.id)
      .first("deleted_at"),
    null,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'club.archived_private'
           AND entity_id = ?`,
      )
      .bind(privateClub.id)
      .first("count"),
    0,
  );
});

test("private club archive reports every retained event, source, program, and invitation blocker", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");
  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: null,
      name: "Retained Records Club",
      planningNotes: null,
      slug: "retained-records-club",
    },
    40_200,
  );
  await database
    .prepare(
      `INSERT INTO organizer_events (
         id, organization_id, club_id, primary_organizer_profile_id,
         title, slug, planning_status, publication_status, schedule_shape,
         timezone, created_by_profile_id, updated_by_profile_id,
         created_at, updated_at, deleted_at
       ) VALUES (
         'soft_deleted_plan', 'org_vcc', ?, 'profile_owner',
         'Restorable deleted plan', 'restorable-deleted-plan',
         'idea', 'private', 'unscheduled', 'America/Vancouver',
         'profile_owner', 'profile_owner', 40201, 40201, 40202
       )`,
    )
    .bind(privateClub.id)
    .run();
  await database
    .prepare(
      `INSERT INTO events (
         id, organization_id, club_id, primary_organizer_profile_id,
         title, slug, status, visibility, time_kind,
         starts_at_utc, ends_at_utc, timezone, organizer_scope_json,
         created_by_profile_id, updated_by_profile_id,
         created_at, updated_at, deleted_at
       ) VALUES (
         'legacy_read_only_plan', 'org_vcc', ?, 'profile_owner',
         'Read-only legacy plan', 'read-only-legacy-plan',
         'draft', 'private', 'timed', 200000, 260000,
         'America/Vancouver', '["profile_owner"]',
         'profile_owner', 'profile_owner', 40201, 40201, NULL
       )`,
    )
    .bind(privateClub.id)
    .run();
  await database
    .prepare(
      `INSERT INTO programs (
         id, organization_id, club_id, name, slug,
         created_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (
         'retained_program', 'org_vcc', ?, 'Retained Program',
         'retained-program', 'profile_owner', 40201, 40201, NULL
       )`,
    )
    .bind(privateClub.id)
    .run();
  await database
    .prepare(
      `INSERT INTO invitations (
         id, organization_id, club_id, token_hash,
         target_normalized_email, intended_role, created_by_profile_id,
         expires_at, created_at, updated_at
       ) VALUES (
         'retained_invitation', 'org_vcc', ?,
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'pending@example.com', 'organizer', 'profile_owner',
         500000, 40201, 40201
       )`,
    )
    .bind(privateClub.id)
    .run();
  await database
    .prepare(
      `INSERT INTO sync_sources (
         id, organization_id, club_id, source_type, source_url, enabled,
         refresh_interval_minutes, created_by_profile_id,
         updated_by_profile_id, created_at, updated_at, deleted_at
       ) VALUES (
         'retained_source', 'org_vcc', ?, 'meetup_ics',
         'https://source.invalid/retained-calendar',
         0, 15, 'profile_owner', 'profile_owner', 40201, 40201, NULL
       )`,
    )
    .bind(privateClub.id)
    .run();

  await assert.rejects(
    archivePrivateOrganizerClub(
      database,
      owner,
      privateClub.id,
      40_203,
    ),
    (error) => {
      assert.equal(error instanceof ClubArchiveBlockedError, true);
      assert.equal(error.eventCount, 2);
      assert.equal(error.invitationCount, 1);
      assert.equal(error.memberCount, 0);
      assert.equal(error.programCount, 1);
      assert.equal(error.sourceCount, 1);
      assert.deepEqual(
        new Set(error.events.map((event) => event.source)),
        new Set(["manual", "legacy_read_only"]),
      );
      return true;
    },
  );

  await database
    .prepare(
      `INSERT INTO meetup_sync_generations (
         id, organization_id, sync_source_id, snapshot_hash,
         expected_item_count, processed_item_count, rejected_item_count,
         state, removed_count, created_at, updated_at, published_at
       ) VALUES (
         'retained_generation', 'org_vcc', 'retained_source',
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         0, 0, 0, 'published', 0, 40204, 40204, 40204
       )`,
    )
    .run();
  await database
    .prepare(
      `UPDATE sync_sources
       SET active_generation_id = 'retained_generation',
           deleted_at = 40205
       WHERE id = 'retained_source'`,
    )
    .run();
  const pointerProtected = await archivePrivateOrganizerClub(
    database,
    owner,
    privateClub.id,
    40_206,
  ).catch((error) => error);
  assert.equal(pointerProtected instanceof ClubArchiveBlockedError, true);
  assert.equal(pointerProtected.sourceCount, 1);
  assert.equal(
    await database
      .prepare("SELECT deleted_at FROM clubs WHERE id = ?")
      .bind(privateClub.id)
      .first("deleted_at"),
    null,
  );
});

test("an archive blocker added after preflight is caught by the committing guard", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");
  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: null,
      name: "Late Blocker Club",
      planningNotes: null,
      slug: "late-blocker-club",
    },
    40_300,
  );
  let raced = false;
  const racingDatabase = {
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      if (!raced) {
        raced = true;
        await database
          .prepare(
            `INSERT INTO organizer_events (
               id, organization_id, club_id, primary_organizer_profile_id,
               title, slug, planning_status, publication_status,
               schedule_shape, timezone, created_by_profile_id,
               updated_by_profile_id, created_at, updated_at, deleted_at
             ) VALUES (
               'late_soft_deleted_plan', 'org_vcc', ?, 'profile_owner',
               'Late restorable plan', 'late-restorable-plan',
               'idea', 'private', 'unscheduled', 'America/Vancouver',
               'profile_owner', 'profile_owner', 40301, 40301, 40302
             )`,
          )
          .bind(privateClub.id)
          .run();
      }
      return database.batch(statements);
    },
  };

  await assert.rejects(
    archivePrivateOrganizerClub(
      racingDatabase,
      owner,
      privateClub.id,
      40_303,
    ),
    (error) =>
      error instanceof ClubArchiveBlockedError &&
      error.eventCount === 1 &&
      error.events[0]?.eventId === "late_soft_deleted_plan",
  );
  assert.equal(
    await database
      .prepare("SELECT deleted_at FROM clubs WHERE id = ?")
      .bind(privateClub.id)
      .first("deleted_at"),
    null,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM audit_logs
         WHERE action = 'club.archived_private'
           AND entity_id = ?`,
      )
      .bind(privateClub.id)
      .first("count"),
    0,
  );
});

test("synchronized duplicate club archives commit one deletion and one audit", async (t) => {
  const database = await newDatabase();
  t.after(() => database.close());
  const owner = identity("owner@example.com", "Owner");
  const privateClub = await createPrivateOrganizerClub(
    database,
    owner,
    {
      description: null,
      name: "Archive Once Club",
      planningNotes: null,
      slug: "archive-once-club",
    },
    41_000,
  );

  const [firstDatabase, secondDatabase] = synchronizedBatchBindings(
    database,
    2,
  );
  const outcomes = await Promise.allSettled([
    archivePrivateOrganizerClub(
      firstDatabase,
      owner,
      privateClub.id,
      41_001,
    ),
    archivePrivateOrganizerClub(
      secondDatabase,
      owner,
      privateClub.id,
      41_001,
    ),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.reason?.code, "conflict");
  assert.equal(rejected.reason?.status, 409);
  assert.equal(
    await database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM audit_logs
         WHERE organization_id = 'org_vcc'
           AND entity_type = 'club'
           AND entity_id = ?
           AND action = 'club.archived_private'`,
      )
      .bind(privateClub.id)
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(`SELECT deleted_at FROM clubs WHERE id = ?`)
      .bind(privateClub.id)
      .first("deleted_at"),
    41_001,
  );
});

function synchronizedBatchBindings(database, count) {
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  return Array.from({ length: count }, () => ({
    prepare(sql) {
      return database.prepare(sql);
    },
    async batch(statements) {
      arrivals += 1;
      if (arrivals === count) release();
      await barrier;
      return database.batch(statements);
    },
  }));
}
