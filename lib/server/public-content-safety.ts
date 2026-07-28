import { validationIssue } from "../validation";
import type { D1DatabaseLike } from "./auth";

/**
 * Actionable application-layer preflight for the transaction-time database
 * guard. Historical membership rows are included intentionally.
 */
export async function assertNoHistoricalOrganizerEmail(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  fields: readonly (string | null | undefined)[],
  path = "publicContent",
): Promise<void> {
  if (
    await containsHistoricalOrganizerEmail(
      database,
      organizationId,
      fields,
    )
  ) {
    throw validationIssue(
      path,
      "private_identity_email",
      "Public content cannot include a current or historical organizer sign-in email.",
    );
  }
}

export async function containsHistoricalOrganizerEmail(
  database: Pick<D1DatabaseLike, "prepare">,
  organizationId: string,
  fields: readonly (string | null | undefined)[],
): Promise<boolean> {
  const values = fields.filter(
    (value): value is string =>
      typeof value === "string" && value.length > 0,
  );
  if (values.length === 0) return false;
  const exposed = await database
    .prepare(
      `SELECT 1 AS exposed
       FROM organization_memberships AS membership
       LEFT JOIN profiles AS profile
         ON profile.id = membership.profile_id
       JOIN json_each(?) AS public_field
       WHERE membership.organization_id = ?
         AND (
           (
             length(trim(membership.normalized_email)) > 0
             AND instr(
               lower(CAST(public_field.value AS TEXT)),
               lower(membership.normalized_email)
             ) > 0
           )
           OR (
             length(trim(COALESCE(profile.normalized_email, ''))) > 0
             AND instr(
               lower(CAST(public_field.value AS TEXT)),
               lower(profile.normalized_email)
             ) > 0
           )
         )
       LIMIT 1`,
    )
    .bind(JSON.stringify(values), organizationId)
    .first<{ exposed?: number }>();
  return exposed?.exposed === 1;
}
