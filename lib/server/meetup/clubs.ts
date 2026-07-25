import {
  authorizeMembership,
  type AuthorizedMembership,
  type D1DatabaseLike,
  type TrustedServerIdentity,
} from "../auth";
import {
  parseFiniteInteger,
  parseIdentifier,
  validationIssue,
} from "../../validation";
import {
  PUBLIC_CATALOG_CLUBS,
} from "../public/catalog-definitions";
import { ensurePublicCatalog } from "../public/catalog";
import { MeetupSyncError } from "./errors";

type MeetupProgramDefinition = Readonly<{
  clubSlug: string;
  meetupGroupSlug: string;
  name: string;
}>;

const MEETUP_PROGRAMS: readonly MeetupProgramDefinition[] = Object.freeze(
  PUBLIC_CATALOG_CLUBS.flatMap((club) =>
    club.meetupGroupSlug
      ? [
          Object.freeze({
            clubSlug: club.slug,
            meetupGroupSlug: club.meetupGroupSlug,
            name: club.name,
          }),
        ]
      : [],
  ),
);

export type MeetupProgramClub = Readonly<{
  id: string;
  name: string;
}>;

/**
 * Idempotently resolves the owner-approved Meetup program catalog for the
 * actor's organization. IDs are durable database identities; connection order
 * and feed contents never choose or create a destination club.
 */
export async function ensureMeetupProgramClubs(
  database: D1DatabaseLike,
  identity: TrustedServerIdentity,
  nowUtcMs = Date.now(),
): Promise<readonly MeetupProgramClub[]> {
  const actor = await authorizeMembership(database, identity, {
    allowedRoles: ["owner", "administrator"],
  });
  const now = parseFiniteInteger(nowUtcMs, {
    path: "nowUtcMs",
    minimum: 0,
  });

  await ensurePublicCatalog(database, identity, now);

  const result = await database
    .prepare(
      `SELECT id, name, slug
       FROM clubs
       WHERE organization_id = ?
         AND slug IN (?, ?, ?)
         AND deleted_at IS NULL`,
    )
    .bind(
      actor.organizationId,
      ...MEETUP_PROGRAMS.map((program) => program.clubSlug),
    )
    .all<Record<string, unknown>>();
  const rowsBySlug = new Map(
    (result.results ?? []).flatMap((row) => {
      const id = readString(row.id);
      const name = readString(row.name);
      const slug = readString(row.slug);
      return id && name && slug ? [[slug, { id, name }] as const] : [];
    }),
  );
  const resolved = MEETUP_PROGRAMS.map((program) => {
    const club = rowsBySlug.get(program.clubSlug);
    if (!club || club.name !== program.name) {
      throw new MeetupSyncError("internal_error");
    }
    return Object.freeze(club);
  });
  return Object.freeze(resolved);
}

/**
 * Confirms that a selected club is one of the exact organization-scoped
 * program records and that the pasted official feed belongs to that program.
 */
export async function assertMeetupProgramClubMapping(
  database: Pick<D1DatabaseLike, "prepare">,
  actor: AuthorizedMembership,
  input: Readonly<{
    clubId: unknown;
    meetupGroupSlug: unknown;
  }>,
): Promise<string> {
  const clubId = parseIdentifier(input.clubId, "clubId");
  const meetupGroupSlug = parseIdentifier(
    input.meetupGroupSlug,
    "meetupGroupSlug",
  );
  const club = await database
    .prepare(
      `SELECT id, slug
       FROM clubs
       WHERE id = ?
         AND organization_id = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(clubId, actor.organizationId)
    .first<Record<string, unknown>>();
  const clubSlug = readString(club?.slug);
  const program = MEETUP_PROGRAMS.find(
    (candidate) => candidate.clubSlug === clubSlug,
  );
  if (!program || program.meetupGroupSlug !== meetupGroupSlug) {
    throw validationIssue(
      "clubId",
      "meetup_program_mismatch",
      "The selected program does not match the official Meetup group.",
    );
  }
  return clubId;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
