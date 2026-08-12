type PublicProgramIdentity = Readonly<{
  name: string;
  parentClub: Readonly<{
    name: string;
    slug: string;
  }>;
  slug: string;
}>;

/**
 * Starter adoption keeps one Program-shaped compatibility record for a Club.
 * When both public identities are exactly the same, the Club is the canonical
 * public destination and the child record must not create a duplicate page.
 */
export function isCompatibilityProgramAlias(
  program: PublicProgramIdentity,
): boolean {
  return (
    program.slug === program.parentClub.slug &&
    program.name === program.parentClub.name
  );
}
