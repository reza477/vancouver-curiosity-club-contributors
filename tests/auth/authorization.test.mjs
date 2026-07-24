import assert from "node:assert/strict";
import test from "node:test";
import {
  OrganizerAccessDeniedError,
  acceptInvitation,
  authorizeMembership,
  authorizeOrganizerAccess,
  bootstrapInitialOwner,
  createInvitation,
  revokeInvitation,
  trustedIdentityFromSites,
} from "../../lib/server/auth/index.ts";
import { SqliteD1TestDatabase } from "./sqlite-d1.mjs";

const AUTH_SCHEMA = `
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    siwc_subject TEXT NOT NULL UNIQUE,
    normalized_email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    public_attribution_consent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL,
    owner_bootstrap_closed_at INTEGER,
    owner_bootstrap_claimed_by_profile_id TEXT,
    created_by_profile_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE TABLE organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    normalized_email TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','administrator','organizer')),
    status TEXT NOT NULL,
    created_by_profile_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE(organization_id, profile_id),
    UNIQUE(organization_id, normalized_email)
  );
  CREATE TABLE clubs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    deleted_at INTEGER
  );
  CREATE TABLE club_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    club_id TEXT NOT NULL REFERENCES clubs(id),
    organization_membership_id TEXT NOT NULL
      REFERENCES organization_memberships(id),
    profile_id TEXT NOT NULL REFERENCES profiles(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by_profile_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    UNIQUE(club_id, profile_id)
  );
  CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id),
    club_id TEXT REFERENCES clubs(id),
    token_hash TEXT NOT NULL UNIQUE,
    target_normalized_email TEXT NOT NULL,
    intended_role TEXT NOT NULL,
    created_by_profile_id TEXT NOT NULL REFERENCES profiles(id),
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    used_at INTEGER,
    used_by_profile_id TEXT REFERENCES profiles(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

function createDatabase() {
  const database = new SqliteD1TestDatabase(AUTH_SCHEMA);
  database.exec(`
    INSERT INTO organizations (
      id, name, slug, timezone, created_at, updated_at
    ) VALUES (
      'org_vcc', 'Vancouver Curiosity Club', 'vancouver-curiosity-club',
      'America/Vancouver', 1, 1
    );
    INSERT INTO clubs (id, organization_id) VALUES
      ('club_assigned', 'org_vcc'),
      ('club_other', 'org_vcc'),
      ('club_books', 'org_vcc');
  `);
  return database;
}

function seedMember(database, {
  email,
  membershipId,
  profileId,
  role,
  status = "active",
}) {
  database.exec(`
    INSERT INTO profiles (
      id, siwc_subject, normalized_email, display_name, status,
      created_at, updated_at
    ) VALUES (
      '${profileId}', 'email:${email}', '${email}', 'Test person', 'active',
      1, 1
    );
    INSERT INTO organization_memberships (
      id, organization_id, profile_id, normalized_email, role, status,
      created_by_profile_id, created_at, updated_at
    ) VALUES (
      '${membershipId}', 'org_vcc', '${profileId}', '${email}', '${role}',
      '${status}', '${profileId}', 1, 1
    );
  `);
}

test("normalizes the trusted server identity without accepting authorization claims", () => {
  const identity = trustedIdentityFromSites({
    email: "  Reza@Example.COM ",
    displayName: "Reza",
    role: "owner",
    organizationId: "forged",
  });

  assert.deepEqual(identity, {
    email: "reza@example.com",
    displayName: "Reza",
    source: "sites-siwc",
  });
  assert.equal("role" in identity, false);
  assert.equal("organizationId" in identity, false);
});

test("denies an authenticated but uninvited identity", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const identity = trustedIdentityFromSites({
    email: "visitor@example.com",
    displayName: "Visitor",
  });

  await assert.rejects(
    authorizeOrganizerAccess(database, identity),
    OrganizerAccessDeniedError,
  );
});

test("revalidates active membership, role, and Organizer club assignment", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "organizer@example.com",
    membershipId: "membership_organizer",
    profileId: "profile_organizer",
    role: "organizer",
  });
  database.exec(`
    INSERT INTO club_memberships (
      id, organization_id, club_id, organization_membership_id, profile_id,
      role, status, created_by_profile_id, created_at, updated_at
    ) VALUES (
      'club_membership_1', 'org_vcc', 'club_assigned',
      'membership_organizer', 'profile_organizer', 'organizer', 'active',
      'profile_organizer', 1, 1
    );
  `);
  const identity = trustedIdentityFromSites({
    email: "organizer@example.com",
  });

  const allowed = await authorizeMembership(database, identity, {
    allowedRoles: ["organizer"],
    clubId: "club_assigned",
    organizationId: "org_vcc",
  });
  assert.equal(allowed.role, "organizer");

  await assert.rejects(
    authorizeMembership(database, identity, {
      allowedRoles: ["organizer"],
      clubId: "club_other",
      organizationId: "org_vcc",
    }),
    OrganizerAccessDeniedError,
  );

  database.exec(`
    UPDATE organization_memberships
    SET status = 'suspended'
    WHERE id = 'membership_organizer';
  `);
  await assert.rejects(
    authorizeMembership(database, identity),
    OrganizerAccessDeniedError,
  );
});

test("allows organization-wide roles to pass a club-scoped check", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "admin@example.com",
    membershipId: "membership_admin",
    profileId: "profile_admin",
    role: "administrator",
  });
  const identity = trustedIdentityFromSites({ email: "admin@example.com" });

  const membership = await authorizeMembership(database, identity, {
    clubId: "club_any",
  });
  assert.equal(membership.role, "administrator");
});

test("bootstraps exactly one matching Owner and closes the path atomically", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const identity = trustedIdentityFromSites({
    email: "REZA@example.com",
    displayName: "Reza",
  });

  const attempts = await Promise.all([
    bootstrapInitialOwner(database, identity, "reza@example.com", 10_000),
    bootstrapInitialOwner(database, identity, "reza@example.com", 10_000),
  ]);
  assert.deepEqual(attempts.sort(), [false, true]);

  const ownerCount = await database
    .prepare(
      `SELECT count(*) AS count
       FROM organization_memberships
       WHERE role = 'owner' AND deleted_at IS NULL`,
    )
    .first("count");
  assert.equal(ownerCount, 1);

  const organization = await database
    .prepare(
      `SELECT owner_bootstrap_closed_at, owner_bootstrap_claimed_by_profile_id
       FROM organizations WHERE id = 'org_vcc'`,
    )
    .first();
  assert.equal(organization.owner_bootstrap_closed_at, 10_000);
  assert.equal(
    typeof organization.owner_bootstrap_claimed_by_profile_id,
    "string",
  );

  const intruder = trustedIdentityFromSites({ email: "other@example.com" });
  assert.equal(
    await bootstrapInitialOwner(
      database,
      intruder,
      "other@example.com",
      20_000,
    ),
    false,
  );
});

test("stores only an invitation hash and atomically accepts a matching SIWC identity", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "owner@example.com",
    membershipId: "membership_owner",
    profileId: "profile_owner",
    role: "owner",
  });
  const owner = trustedIdentityFromSites({
    email: "owner@example.com",
    displayName: "Owner",
  });
  const now = 1_000_000;
  const invitation = await createInvitation(
    database,
    owner,
    {
      targetEmail: "  New.Organizer@Example.COM ",
      intendedRole: "organizer",
      clubId: "club_books",
      expiresAtUtcMs: now + 86_400_000,
      organizationId: "forged_org",
      creatorProfileId: "forged_creator",
    },
    now,
  );

  assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(Buffer.from(invitation.token, "base64url").byteLength, 32);
  assert.match(
    invitation.copyablePath,
    /^\/accept-invitation\?token=/u,
  );

  const stored = await database
    .prepare(`SELECT * FROM invitations WHERE id = ?`)
    .bind(invitation.invitationId)
    .first();
  assert.equal(stored.target_normalized_email, "new.organizer@example.com");
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(stored.token_hash, invitation.token);
  assert.equal(JSON.stringify(stored).includes(invitation.token), false);
  assert.equal(stored.organization_id, "org_vcc");
  assert.equal(stored.created_by_profile_id, "profile_owner");

  const wrongIdentity = trustedIdentityFromSites({
    email: "someone.else@example.com",
  });
  await assert.rejects(
    acceptInvitation(database, wrongIdentity, invitation.token, now + 1),
    OrganizerAccessDeniedError,
  );
  assert.equal(
    await database
      .prepare(`SELECT used_at FROM invitations WHERE id = ?`)
      .bind(invitation.invitationId)
      .first("used_at"),
    null,
  );

  const invitedIdentity = trustedIdentityFromSites({
    email: "new.organizer@example.com",
    displayName: "New Organizer",
  });
  const accepted = await acceptInvitation(
    database,
    invitedIdentity,
    invitation.token,
    now + 2,
  );
  assert.equal(accepted.role, "organizer");
  assert.equal(accepted.organizationId, "org_vcc");
  assert.equal(
    await database
      .prepare(
        `SELECT count(*) AS count
         FROM club_memberships
         WHERE profile_id = ? AND club_id = 'club_books' AND status = 'active'`,
      )
      .bind(accepted.profileId)
      .first("count"),
    1,
  );

  await assert.rejects(
    acceptInvitation(database, invitedIdentity, invitation.token, now + 3),
    OrganizerAccessDeniedError,
  );
});

test("revalidates the actor before invitation changes and supports revocation", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  seedMember(database, {
    email: "owner@example.com",
    membershipId: "membership_owner",
    profileId: "profile_owner",
    role: "owner",
  });
  seedMember(database, {
    email: "organizer@example.com",
    membershipId: "membership_organizer",
    profileId: "profile_organizer",
    role: "organizer",
  });
  const organizer = trustedIdentityFromSites({
    email: "organizer@example.com",
  });

  await assert.rejects(
    createInvitation(database, organizer, {
      targetEmail: "target@example.com",
      intendedRole: "administrator",
      expiresAtUtcMs: 90_000_000,
      organizationId: "org_vcc",
      role: "owner",
    }),
    OrganizerAccessDeniedError,
  );

  const owner = trustedIdentityFromSites({ email: "owner@example.com" });
  const invitation = await createInvitation(
    database,
    owner,
    {
      targetEmail: "admin@example.com",
      intendedRole: "administrator",
      expiresAtUtcMs: 90_000_000,
    },
    1,
  );
  assert.equal(
    await revokeInvitation(database, owner, invitation.invitationId, 2),
    true,
  );
  await assert.rejects(
    acceptInvitation(
      database,
      trustedIdentityFromSites({ email: "admin@example.com" }),
      invitation.token,
      3,
    ),
    OrganizerAccessDeniedError,
  );
});
