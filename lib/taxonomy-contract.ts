export const TAXONOMY_NAME_MAX = 120;
export const TAXONOMY_SLUG_MAX = 160;
export const TAXONOMY_DESCRIPTION_MAX = 1_000;
export const TAXONOMY_COLOR_TOKEN_MAX = 64;
export const TAXONOMY_SORT_ORDER_MAX = 100_000;
export const TAXONOMY_MAX_ITEMS = 100;

export const TAXONOMY_SLUG_PATTERN_SOURCE =
  "[a-z0-9]+(?:-[a-z0-9]+)*";
export const TAXONOMY_COLOR_TOKEN_PATTERN_SOURCE =
  "[a-z][a-z0-9-]*";

const TAXONOMY_SLUG_PATTERN = new RegExp(
  `^(?:${TAXONOMY_SLUG_PATTERN_SOURCE})$`,
  "u",
);
const TAXONOMY_COLOR_TOKEN_PATTERN = new RegExp(
  `^(?:${TAXONOMY_COLOR_TOKEN_PATTERN_SOURCE})$`,
  "u",
);

export function isTaxonomySlug(value: string): boolean {
  return (
    value.length <= TAXONOMY_SLUG_MAX &&
    TAXONOMY_SLUG_PATTERN.test(value)
  );
}

export function isTaxonomyColorToken(value: string): boolean {
  return (
    value.length <= TAXONOMY_COLOR_TOKEN_MAX &&
    TAXONOMY_COLOR_TOKEN_PATTERN.test(value)
  );
}

export function deriveTaxonomySlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-")
    .slice(0, TAXONOMY_SLUG_MAX)
    .replace(/-+$/gu, "");
}
