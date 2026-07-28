import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  OrganizerAccessDeniedError,
  acceptInvitation,
  authorizeMembership,
  authorizeOrganizerAccess,
  bootstrapInitialOwner,
  createInvitation,
  generateInvitationToken,
  hashInvitationToken,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { ensureCmsAdoption } from "../../lib/server/organizer/cms-adoption.ts";
import { ensurePublicCatalog } from "../../lib/server/public/catalog.ts";
import { listUpcomingPublicEvents } from "../../lib/server/public/events.ts";
import { SqliteD1TestDatabase } from "./sqlite-d1.mjs";

function loadGeneratedMigrations() {
  const migrationDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrations.length > 0, "at least one generated migration exists");
  return migrations
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");
}

test("first-owner bootstrap creates and closes the confirmed organization atomically", async (t) => {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());
  const identity = trustedIdentityFromSites({
    email: "owner@example.com",
    displayName: "Reza",
  });

  const attempts = await Promise.all([
    bootstrapInitialOwner(database, identity, "owner@example.com", 10_000),
    bootstrapInitialOwner(database, identity, "owner@example.com", 10_000),
  ]);
  assert.deepEqual(attempts.sort(), [false, true]);

  const organization = await database
    .prepare(
      `SELECT id, name, slug, timezone, owner_bootstrap_closed_at,
              owner_bootstrap_claimed_by_profile_id, created_by_profile_id
       FROM organizations`,
    )
    .first();
  assert.equal(
    organization.name,
    "Vancouver Curiosity and Education Society",
  );
  assert.equal(
    organization.slug,
    "vancouver-curiosity-and-education-society",
  );
  assert.equal(organization.timezone, "America/Vancouver");
  assert.equal(organization.owner_bootstrap_closed_at, 10_000);
  assert.equal(
    organization.owner_bootstrap_claimed_by_profile_id,
    organization.created_by_profile_id,
  );

  const owner = await database
    .prepare(
      `SELECT membership.organization_id, membership.profile_id,
              membership.role, membership.status, profile.normalized_email
       FROM organization_memberships AS membership
       JOIN profiles AS profile ON profile.id = membership.profile_id
       WHERE membership.role = 'owner'`,
    )
    .first();
  assert.equal(owner.organization_id, organization.id);
  assert.equal(owner.profile_id, organization.owner_bootstrap_claimed_by_profile_id);
  assert.equal(owner.role, "owner");
  assert.equal(owner.status, "active");
  assert.equal(owner.normalized_email, "owner@example.com");
  assert.equal(
    await database
      .prepare(`SELECT count(*) AS count FROM organizations`)
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(`SELECT count(*) AS count FROM profiles`)
      .first("count"),
    1,
  );
  assert.equal(
    await database
      .prepare(`SELECT count(*) AS count FROM organization_memberships`)
      .first("count"),
    1,
  );
});

test("failed first-owner claims leave no partial organization or membership", async (t) => {
  const wrongIdentityDatabase = new SqliteD1TestDatabase(
    loadGeneratedMigrations(),
  );
  const suspendedProfileDatabase = new SqliteD1TestDatabase(
    loadGeneratedMigrations(),
  );
  t.after(() => {
    wrongIdentityDatabase.close();
    suspendedProfileDatabase.close();
  });

  const wrongIdentity = trustedIdentityFromSites({
    email: "intruder@example.com",
  });
  assert.equal(
    await bootstrapInitialOwner(
      wrongIdentityDatabase,
      wrongIdentity,
      "owner@example.com",
      10_000,
    ),
    false,
  );
  for (const table of [
    "organizations",
    "profiles",
    "organization_memberships",
  ]) {
    assert.equal(
      await wrongIdentityDatabase
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .first("count"),
      0,
    );
  }

  suspendedProfileDatabase.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      'profile_suspended', 'email:owner@example.com', 'owner@example.com',
      'Suspended identity', 'suspended', 1, 1
    );
  `);
  const ownerIdentity = trustedIdentityFromSites({
    email: "owner@example.com",
  });
  assert.equal(
    await bootstrapInitialOwner(
      suspendedProfileDatabase,
      ownerIdentity,
      "owner@example.com",
      10_000,
    ),
    false,
  );
  assert.equal(
    await suspendedProfileDatabase
      .prepare(`SELECT count(*) AS count FROM organizations`)
      .first("count"),
    0,
  );
  assert.equal(
    await suspendedProfileDatabase
      .prepare(`SELECT count(*) AS count FROM organization_memberships`)
      .first("count"),
    0,
  );
  assert.equal(
    await suspendedProfileDatabase
      .prepare(`SELECT count(*) AS count FROM profiles`)
      .first("count"),
    1,
  );
});

test("generated schema rejects cross-organization club authorization and invitations", async (t) => {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, created_at, updated_at
    ) VALUES
      ('org_a', 'Organization A', 'organization-a', 'America/Vancouver', 1, 1),
      ('org_b', 'Organization B', 'organization-b', 'America/Vancouver', 1, 1);
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES
      (
        'profile_owner_a', 'email:owner-a@example.com',
        'owner-a@example.com', 'Owner A', 'active', 1, 1
      ),
      (
        'profile_organizer_a', 'email:organizer-a@example.com',
        'organizer-a@example.com', 'Organizer A', 'active', 1, 1
      );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES
      (
        'membership_owner_a', 'org_a', 'profile_owner_a',
        'owner-a@example.com', 'owner', 'active', 'profile_owner_a', 1, 1
      ),
      (
        'membership_organizer_a', 'org_a', 'profile_organizer_a',
        'organizer-a@example.com', 'organizer', 'active',
        'profile_owner_a', 1, 1
      );
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES
      ('club_a', 'org_a', 'Club A', 'club-a', 'profile_owner_a', 1, 1),
      ('club_b', 'org_b', 'Club B', 'club-b', 'profile_owner_a', 1, 1);
    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id, profile_id,
      role, status, created_by_profile_id, created_at, updated_at
    ) VALUES (
      'malicious_cross_org_assignment', 'org_a', 'club_b',
      'membership_organizer_a', 'profile_organizer_a', 'organizer', 'active',
      'profile_owner_a', 1, 1
    );
  `);

  await assert.rejects(
    authorizeMembership(
      database,
      trustedIdentityFromSites({ email: "organizer-a@example.com" }),
      {
        allowedRoles: ["organizer"],
        organizationId: "org_a",
        clubId: "club_b",
      },
    ),
    OrganizerAccessDeniedError,
  );

  const ownerIdentity = trustedIdentityFromSites({
    email: "owner-a@example.com",
  });
  await assert.rejects(
    createInvitation(
      database,
      ownerIdentity,
      {
        targetEmail: "cross-org-create@example.com",
        intendedRole: "organizer",
        clubId: "club_b",
        expiresAtUtcMs: 90_000_000,
      },
      1,
    ),
    OrganizerAccessDeniedError,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM invitations
         WHERE target_normalized_email = 'cross-org-create@example.com'`,
      )
      .first("count"),
    0,
  );

  const maliciousToken = generateInvitationToken();
  const maliciousTokenHash = await hashInvitationToken(maliciousToken);
  await database
    .prepare(
      `INSERT INTO invitations (
         id, organization_id, club_id, token_hash, target_normalized_email,
         intended_role, created_by_profile_id, expires_at, created_at,
         updated_at
       ) VALUES (
         'invitation_cross_org', 'org_a', 'club_b', ?,
         'cross-org-accept@example.com', 'organizer', 'profile_owner_a',
         90000000, 1, 1
       )`,
    )
    .bind(maliciousTokenHash)
    .run();

  await assert.rejects(
    acceptInvitation(
      database,
      trustedIdentityFromSites({
        email: "cross-org-accept@example.com",
      }),
      maliciousToken,
      2,
    ),
    OrganizerAccessDeniedError,
  );
  const maliciousInvitation = await database
    .prepare(
      `SELECT used_at, used_by_profile_id
       FROM invitations
       WHERE id = 'invitation_cross_org'`,
    )
    .first();
  assert.equal(maliciousInvitation.used_at, null);
  assert.equal(maliciousInvitation.used_by_profile_id, null);
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM profiles
         WHERE normalized_email = 'cross-org-accept@example.com'`,
      )
      .first("count"),
    0,
  );
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM organization_memberships
         WHERE normalized_email = 'cross-org-accept@example.com'`,
      )
      .first("count"),
    0,
  );
});

test("auth and public projections execute against the generated Phase 1 schema", async (t) => {
  const database = new SqliteD1TestDatabase(loadGeneratedMigrations());
  t.after(() => database.close());
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      'org_vcc', 'Vancouver Curiosity Club', 'vancouver-curiosity-club',
      'America/Vancouver', 1, 1
    );
  `);

  const ownerIdentity = trustedIdentityFromSites({
    email: "owner@example.com",
    displayName: "Owner",
  });
  const ownerMembership = await authorizeOrganizerAccess(
    database,
    ownerIdentity,
    { initialOwnerEmail: "owner@example.com" },
  );
  assert.equal(ownerMembership.role, "owner");

  database.exec(`
    INSERT INTO clubs (
      id, organization_id, name, slug, created_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'club_books', 'org_vcc', 'Books', 'books',
      '${ownerMembership.profileId}', 2, 2
    );
  `);

  const now = 10_000;
  const invitation = await createInvitation(
    database,
    ownerIdentity,
    {
      targetEmail: "organizer@example.com",
      intendedRole: "organizer",
      clubId: "club_books",
      expiresAtUtcMs: now + 86_400_000,
    },
    now,
  );
  const organizerMembership = await acceptInvitation(
    database,
    trustedIdentityFromSites({
      email: "organizer@example.com",
      displayName: "Public Host",
    }),
    invitation.token,
    now + 1,
  );
  assert.equal(organizerMembership.role, "organizer");
  assert.equal(
    await database
      .prepare(
        `SELECT public_attribution_consent
         FROM profiles
         WHERE id = ?`,
      )
      .bind(organizerMembership.profileId)
      .first("public_attribution_consent"),
    0,
  );

  await ensurePublicCatalog(database, ownerIdentity, now + 2);
  await ensureCmsAdoption(database, ownerMembership, now + 3);
  const publicClubId = await database
    .prepare(
      `SELECT id
       FROM clubs
       WHERE organization_id = ?
         AND slug = 'vancouver-curiosity-club'
         AND deleted_at IS NULL`,
    )
    .bind(ownerMembership.organizationId)
    .first("id");
  assert.equal(typeof publicClubId, "string");

  database.exec(`
    INSERT INTO categories (
      id, organization_id, name, slug, color_token, created_at, updated_at
    ) VALUES (
      'category_ideas', 'org_vcc', 'Ideas', 'ideas', 'cobalt', 3, 3
    );
    INSERT INTO venues (
      id, organization_id, name, slug, timezone, public_location_name,
      public_address, private_address, private_directions, is_public,
      created_by_profile_id, updated_by_profile_id, created_at, updated_at
    ) VALUES (
      'venue_reading', 'org_vcc', 'Reading Room', 'reading-room',
      'America/Vancouver', 'Reading Room', '123 Public Street',
      'PRIVATE_ADDRESS', 'PRIVATE_DIRECTIONS', 1,
      '${ownerMembership.profileId}', '${ownerMembership.profileId}', 3, 3
    );
    INSERT INTO events (
      id, organization_id, club_id, category_id, venue_id,
      primary_organizer_profile_id, title, slug, summary, description,
      status, visibility, time_kind, starts_at_utc, ends_at_utc, timezone,
      organizer_scope_json, private_notes, private_meeting_details,
      published_at, created_by_profile_id, updated_by_profile_id,
      created_at, updated_at
    ) VALUES (
      'event_public', 'org_vcc', '${publicClubId}', 'category_ideas',
      'venue_reading', '${organizerMembership.profileId}',
      'Ideas After Dark', 'ideas-after-dark', 'A public summary.',
      'A public description.', 'confirmed', 'public', 'timed',
      2000000, 3000000, 'America/Vancouver',
      '["${organizerMembership.profileId}"]',
      'PRIVATE_NOTE', 'PRIVATE_MEETING', 100,
      '${ownerMembership.profileId}', '${ownerMembership.profileId}', 4, 4
    );
    INSERT INTO event_organizers (
      id, organization_id, event_id, profile_id, role, is_publicly_listed,
      created_by_profile_id, created_at
    ) VALUES (
      'event_organizer_public', 'org_vcc', 'event_public',
      '${organizerMembership.profileId}', 'primary', 1,
      '${ownerMembership.profileId}', 4
    );
  `);

  const publicEventsWithoutConsent = await listUpcomingPublicEvents(database, {
    organizationId: "org_vcc",
    fromUtcMs: 1,
    todayDate: "1970-01-01",
  });
  assert.equal(publicEventsWithoutConsent.length, 1);
  assert.deepEqual(publicEventsWithoutConsent[0].organizers, []);

  await database
    .prepare(
      `UPDATE profiles
       SET public_attribution_consent = 1
       WHERE id = ?`,
    )
    .bind(organizerMembership.profileId)
    .run();
  const publicEvents = await listUpcomingPublicEvents(database, {
    organizationId: "org_vcc",
    fromUtcMs: 1,
    todayDate: "1970-01-01",
  });
  assert.equal(publicEvents.length, 1);
  assert.deepEqual(
    publicEvents[0].organizers,
    [],
    "unbacked canonical consent must not bypass the Phase 6 attribution receipt",
  );
  const serialized = JSON.stringify(publicEvents);
  assert.equal(serialized.includes("PRIVATE_NOTE"), false);
  assert.equal(serialized.includes("PRIVATE_MEETING"), false);
  assert.equal(serialized.includes("organizer@example.com"), false);
});
