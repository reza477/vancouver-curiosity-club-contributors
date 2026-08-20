import { validationIssue } from "./index";

// Both JavaScript and SQLite/D1 normalize this exact set to one ASCII space
// before phrase matching. It covers ASCII whitespace and common punctuation,
// NBSP/narrow-NBSP, common Unicode spaces and punctuation, and the
// hyphen/nonbreaking-hyphen/en/em-dash family.
const PROTECTED_LEGAL_SEPARATOR_CODE_POINTS = Object.freeze([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0021, 0x0022,
  0x0023, 0x0024, 0x0025, 0x0026, 0x0027, 0x0028, 0x0029, 0x002a,
  0x002b, 0x002c, 0x002d, 0x002e, 0x002f, 0x003a, 0x003b, 0x003c,
  0x003d, 0x003e, 0x003f, 0x0040, 0x005b, 0x005c, 0x005d, 0x005e,
  0x005f, 0x0060, 0x007b, 0x007c, 0x007d, 0x007e, 0x00a0, 0x00ad,
  0x00b7, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2010, 0x2011, 0x2012,
  0x2013, 0x2014, 0x2015, 0x2016, 0x2017, 0x2018, 0x2019, 0x201a,
  0x201b, 0x201c, 0x201d, 0x201e, 0x201f, 0x2020, 0x2021, 0x2022,
  0x2023, 0x2024, 0x2025, 0x2026, 0x2027, 0x2028, 0x2029, 0x202f,
  0x2030, 0x2031, 0x2032, 0x2033, 0x2034, 0x2035, 0x2036, 0x2037,
  0x2038, 0x2039, 0x203a, 0x203b, 0x203c, 0x203d, 0x203e, 0x2041,
  0x2042, 0x2043, 0x2044, 0x2045, 0x2046, 0x2047, 0x2048, 0x2049,
  0x204a, 0x204b, 0x204c, 0x204d, 0x204e, 0x204f, 0x2050, 0x2051,
  0x2052, 0x2053, 0x2054, 0x2055, 0x2056, 0x2057, 0x2058, 0x2059,
  0x205a, 0x205b, 0x205c, 0x205d, 0x205e, 0x205f, 0x2212, 0x3000,
  0xfe58, 0xfe63, 0xff0d,
] as const);

// Format controls can be inserted inside a protected phrase without changing
// how it appears. Remove them instead of creating a new word boundary. The
// compact comparison below also catches a control used in place of a boundary.
const PROTECTED_LEGAL_IGNORABLE_CODE_POINTS = Object.freeze([
  0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b,
  0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069,
  0xfeff,
] as const);

const PROTECTED_LEGAL_SEPARATOR_PATTERN = new RegExp(
  `[${PROTECTED_LEGAL_SEPARATOR_CODE_POINTS.map(
    (codePoint) => `\\u{${codePoint.toString(16)}}`,
  ).join("")}]+`,
  "gu",
);

const PROTECTED_LEGAL_IGNORABLE_PATTERN = new RegExp(
  `[${PROTECTED_LEGAL_IGNORABLE_CODE_POINTS.map(
    (codePoint) => `\\u{${codePoint.toString(16)}}`,
  ).join("")}]+`,
  "gu",
);

// This is the sole phrase allowlist for both enforcement layers.
const PROTECTED_LEGAL_PHRASES = Object.freeze([
  "nonprofit",
  "non profit",
  "not for profit",
  "we are a charity",
  "we re a charity",
  "our organization is a charity",
  "our organisation is a charity",
  "this organization is a charity",
  "this organisation is a charity",
  "charitable organization",
  "charitable organisation",
  "registered charity",
  "registered as a charity",
  "registered charitable",
  "registered society",
  "bc society",
  "british columbia society",
  "registered nonprofit",
  "registered non profit",
  "incorporated society",
  "incorporated under the societies act",
  "societies act",
  "incorporated association",
  "incorporated nonprofit",
  "incorporated non profit",
  "incorporation society",
  "incorporation association",
  "incorporation nonprofit",
  "incorporation non profit",
  "incorporation number",
  "incorporation status",
  "society registration",
  "society number",
  "society status",
  "legal form",
  "legal status",
  "charity number",
  "charity status",
  "tax deductible",
  "tax deductibility",
  "tax exempt",
  "tax exemption",
  "tax receipt",
  "donation receipt",
  "official receipt for gift",
  "official receipt for gifts",
  "official receipts for gift",
  "official receipts for gifts",
  "issue donation receipt",
  "cra registration",
  "cra charity",
  "registered with cra",
  "registered with the cra",
  "cra registered",
  "not a registered charity",
  "not registered as a charity",
  "not registered with cra",
  "not registered with the cra",
  "we are not a charity",
  "we are not a registered charity",
  "not tax deductible",
  "not tax exempt",
  "cannot issue tax receipt",
  "can not issue tax receipt",
  "do not issue tax receipt",
  "does not issue tax receipt",
  "cannot issue donation receipt",
  "can not issue donation receipt",
  "do not issue donation receipt",
  "does not issue donation receipt",
  "no tax receipt",
  "no donation receipt",
  "government funded",
  "government funding",
  "government supported",
  "government grant",
  "funded by government",
  "funded by the government",
  "provincially registered",
  "registration number",
] as const);

// Public prose must not become an alternate legal-status channel merely by
// rewording a known phrase. These deliberately broad semantic families cover
// status, registration, charity, tax-benefit, donation-receipt, and government
// support claims. Structured, Owner-confirmed legal projection remains the
// only public path for those facts.
const PROTECTED_LEGAL_FAMILIES = Object.freeze([
  Object.freeze([Object.freeze(["charity", "charitable"])]),
  Object.freeze([Object.freeze(["cra"])]),
  Object.freeze([
    Object.freeze(["nonprofit", "non profit", "not for profit"]),
  ]),
  Object.freeze([
    Object.freeze(["donate", "donation", "donations"]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "qualify",
      "qualified",
      "receipt",
      "receipts",
      "tax",
    ]),
  ]),
  Object.freeze([
    Object.freeze([
      "contribution",
      "contributions",
      "gift",
      "gifts",
    ]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "qualify",
      "qualified",
      "receipt",
      "receipts",
      "tax",
    ]),
  ]),
  Object.freeze([
    Object.freeze(["tax"]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "exempt",
      "exemption",
      "receipt",
      "receipts",
    ]),
  ]),
  Object.freeze([
    Object.freeze(["societies", "society"]),
    Object.freeze([
      "act",
      "incorporated",
      "incorporation",
      "number",
      "registered",
      "registration",
      "status",
    ]),
  ]),
  Object.freeze([
    Object.freeze(["incorporated", "incorporation"]),
    Object.freeze(["bc", "british columbia"]),
  ]),
  Object.freeze([
    Object.freeze(["registered", "registration"]),
    Object.freeze(["bc", "british columbia"]),
    Object.freeze(["act", "law", "statute"]),
  ]),
  Object.freeze([
    Object.freeze(["government"]),
    Object.freeze(["funded", "funding", "grant", "supported"]),
  ]),
  Object.freeze([
    Object.freeze(["city", "municipal", "municipality", "public"]),
    Object.freeze(["funded", "funding", "grant", "supported"]),
  ]),
] as const);

const POSITIVE_CHARITY_STATUS_CLAIM_FAMILIES = Object.freeze([
  Object.freeze([Object.freeze(["charity", "charitable"])]),
  Object.freeze([Object.freeze(["cra"])]),
] as const);

const CHARITY_BENEFIT_CLAIM_FAMILIES = Object.freeze([
  Object.freeze([
    Object.freeze(["donate", "donation", "donations"]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "qualify",
      "qualified",
      "receipt",
      "receipts",
      "tax",
    ]),
  ]),
  Object.freeze([
    Object.freeze(["tax"]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "exempt",
      "exemption",
      "receipt",
      "receipts",
    ]),
  ]),
  Object.freeze([
    Object.freeze([
      "contribution",
      "contributions",
      "gift",
      "gifts",
    ]),
    Object.freeze([
      "deduct",
      "deductible",
      "deduction",
      "qualify",
      "qualified",
      "receipt",
      "receipts",
      "tax",
    ]),
  ]),
] as const);

const PROVINCIAL_STATUS_CLAIM_FAMILIES = Object.freeze([
  Object.freeze([
    Object.freeze(["societies", "society"]),
    Object.freeze([
      "act",
      "incorporated",
      "incorporation",
      "number",
      "registered",
      "registration",
      "status",
    ]),
  ]),
  Object.freeze([
    Object.freeze(["incorporated", "incorporation"]),
    Object.freeze(["bc", "british columbia"]),
  ]),
  Object.freeze([
    Object.freeze(["registered", "registration"]),
    Object.freeze(["bc", "british columbia"]),
    Object.freeze(["act", "law", "statute"]),
  ]),
] as const);

const POSITIVE_CHARITY_STATUS_CLAIM_PHRASES = Object.freeze([
  "we are a charity",
  "we re a charity",
  "our organization is a charity",
  "our organisation is a charity",
  "this organization is a charity",
  "this organisation is a charity",
  "charitable organization",
  "charitable organisation",
  "registered charity",
  "registered as a charity",
  "registered charitable",
  "charity number",
  "charity status",
  "cra registration",
  "cra charity",
  "registered with cra",
  "registered with the cra",
  "cra registered",
] as const);

const NEGATIVE_CHARITY_STATUS_CLAIM_PHRASES = Object.freeze([
  "not a registered charity",
  "not registered as a charity",
  "not registered with cra",
  "not registered with the cra",
  "not recognized as a charity",
  "not recognised as a charity",
  "we are not a charity",
  "we are not a registered charity",
] as const);

const CHARITY_BENEFIT_CLAIM_PHRASES = Object.freeze([
  "tax deductible",
  "tax deductibility",
  "tax exempt",
  "tax exemption",
  "tax receipt",
  "donation receipt",
  "official receipt for gift",
  "official receipt for gifts",
  "official receipts for gift",
  "official receipts for gifts",
  "issue donation receipt",
  "can issue donation receipt",
] as const);

const NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES = Object.freeze([
  "not tax deductible",
  "not tax exempt",
  "cannot issue tax receipt",
  "can not issue tax receipt",
  "do not issue tax receipt",
  "does not issue tax receipt",
  "cannot issue donation receipt",
  "can not issue donation receipt",
  "do not issue donation receipt",
  "does not issue donation receipt",
  "no tax receipt",
  "no donation receipt",
  "gifts do not qualify for deductions",
  "gifts do not qualify for a deduction",
  "contributions do not qualify for deductions",
  "contributions do not qualify for a deduction",
  "no official receipts for gifts",
  "cannot provide official receipts for donations",
  "can not provide official receipts for donations",
  "cannot provide official receipts for gifts",
  "can not provide official receipts for gifts",
] as const);

const PROVINCIAL_STATUS_CLAIM_PHRASES = Object.freeze([
  "nonprofit",
  "non profit",
  "not for profit",
  "registered society",
  "bc society",
  "british columbia society",
  "incorporated under the societies act",
  "societies act",
  "registered nonprofit",
  "registered non profit",
  "incorporated society",
  "incorporated association",
  "incorporated nonprofit",
  "incorporated non profit",
  "incorporation society",
  "incorporation association",
  "incorporation nonprofit",
  "incorporation non profit",
  "incorporation number",
  "incorporation status",
  "society registration",
  "society number",
  "society status",
  "provincially registered",
  "provincial registration",
  "registration number",
  "registered under british columbia law",
  "registered under bc law",
] as const);

export function normalizeProtectedLegalClaimText(value: string): string {
  return value
    .toLowerCase()
    .replace(PROTECTED_LEGAL_IGNORABLE_PATTERN, "")
    .replace(PROTECTED_LEGAL_SEPARATOR_PATTERN, " ")
    .trim();
}

export function containsProtectedLegalClaim(value: string): boolean {
  return (
    containsClaimPhrase(value, PROTECTED_LEGAL_PHRASES) ||
    containsClaimFamily(value, PROTECTED_LEGAL_FAMILIES)
  );
}

export function containsCharityStatusClaim(value: string): boolean {
  return (
    containsPositiveCharityStatusClaim(value) ||
    containsNegativeCharityStatusClaim(value) ||
    containsCharityBenefitClaim(value)
  );
}

export function containsPositiveCharityStatusClaim(
  value: string,
): boolean {
  return (
    !containsNegativeCharityStatusClaim(value) &&
    (
      containsClaimPhrase(value, POSITIVE_CHARITY_STATUS_CLAIM_PHRASES) ||
      containsClaimFamily(
        value,
        POSITIVE_CHARITY_STATUS_CLAIM_FAMILIES,
      )
    )
  );
}

export function containsNegativeCharityStatusClaim(
  value: string,
): boolean {
  return containsClaimPhrase(
    value,
    NEGATIVE_CHARITY_STATUS_CLAIM_PHRASES,
  );
}

export function containsCharityBenefitClaim(value: string): boolean {
  return (
    containsPositiveCharityBenefitClaim(value) ||
    containsNegativeCharityBenefitClaim(value)
  );
}

export function containsPositiveCharityBenefitClaim(
  value: string,
): boolean {
  return (
    !containsNegativeCharityBenefitClaim(value) &&
    (
      containsClaimPhrase(value, CHARITY_BENEFIT_CLAIM_PHRASES) ||
      containsClaimFamily(value, CHARITY_BENEFIT_CLAIM_FAMILIES)
    )
  );
}

export function containsNegativeCharityBenefitClaim(
  value: string,
): boolean {
  return containsClaimPhrase(
    value,
    NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES,
  );
}

export function containsProvincialStatusClaim(value: string): boolean {
  return (
    containsClaimPhrase(value, PROVINCIAL_STATUS_CLAIM_PHRASES) ||
    containsClaimFamily(value, PROVINCIAL_STATUS_CLAIM_FAMILIES)
  );
}

/**
 * Builds a static SQL predicate for trusted, source-authored SQL expressions.
 * Callers must never pass user-controlled SQL. The returned predicate uses the
 * exact separator and phrase lists above. Recursive replacement collapses any
 * bounded run of repeated separators without relying on SQLite regex support.
 */
export function protectedLegalClaimSql(
  expressions: readonly string[],
): string {
  return semanticClaimSql(
    expressions,
    PROTECTED_LEGAL_PHRASES,
    PROTECTED_LEGAL_FAMILIES,
  );
}

export function charityStatusClaimSql(
  expressions: readonly string[],
): string {
  return semanticClaimSql(
    expressions,
    [
      ...POSITIVE_CHARITY_STATUS_CLAIM_PHRASES,
      ...NEGATIVE_CHARITY_STATUS_CLAIM_PHRASES,
      ...CHARITY_BENEFIT_CLAIM_PHRASES,
      ...NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES,
    ],
    [
      ...POSITIVE_CHARITY_STATUS_CLAIM_FAMILIES,
      ...CHARITY_BENEFIT_CLAIM_FAMILIES,
    ],
  );
}

export function positiveCharityStatusClaimSql(
  expressions: readonly string[],
): string {
  return `(NOT (${negativeCharityStatusClaimSql(expressions)})
    AND (
      ${protectedClaimSql(
        expressions,
        POSITIVE_CHARITY_STATUS_CLAIM_PHRASES,
      )}
      OR ${protectedFamilySql(
        expressions,
        POSITIVE_CHARITY_STATUS_CLAIM_FAMILIES,
      )}
    ))`;
}

export function negativeCharityStatusClaimSql(
  expressions: readonly string[],
): string {
  return protectedClaimSql(
    expressions,
    NEGATIVE_CHARITY_STATUS_CLAIM_PHRASES,
  );
}

export function charityBenefitClaimSql(
  expressions: readonly string[],
): string {
  return semanticClaimSql(
    expressions,
    [
      ...CHARITY_BENEFIT_CLAIM_PHRASES,
      ...NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES,
    ],
    CHARITY_BENEFIT_CLAIM_FAMILIES,
  );
}

export function positiveCharityBenefitClaimSql(
  expressions: readonly string[],
): string {
  return `(NOT (${negativeCharityBenefitClaimSql(expressions)})
    AND (
      ${protectedClaimSql(
        expressions,
        CHARITY_BENEFIT_CLAIM_PHRASES,
      )}
      OR ${protectedFamilySql(
        expressions,
        CHARITY_BENEFIT_CLAIM_FAMILIES,
      )}
    ))`;
}

export function negativeCharityBenefitClaimSql(
  expressions: readonly string[],
): string {
  return protectedClaimSql(
    expressions,
    NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES,
  );
}

export function provincialStatusClaimSql(
  expressions: readonly string[],
): string {
  return semanticClaimSql(
    expressions,
    PROVINCIAL_STATUS_CLAIM_PHRASES,
    PROVINCIAL_STATUS_CLAIM_FAMILIES,
  );
}

/**
 * Evaluates every structured-legal classifier over one normalized value
 * stream. `predicateSql` is trusted, source-authored SQL and may reference:
 *
 * - legal_flags.protected_claim
 * - legal_flags.positive_charity_status
 * - legal_flags.negative_charity_status
 * - legal_flags.positive_charity_benefit
 * - legal_flags.negative_charity_benefit
 * - legal_flags.provincial_status
 *
 * The shared stream keeps legal confirmation guards below D1's expression
 * depth without weakening the JavaScript/SQLite phrase-family parity.
 */
export function classifiedLegalClaimSql(
  expressions: readonly string[],
  predicateSql: string,
): string {
  if (expressions.length === 0) return "0";
  const values = expressions
    .map((expression) => `COALESCE(${expression}, '')`)
    .join(", ");
  const flag = (
    name: string,
    predicate: string,
  ) => `max(CASE WHEN ${predicate} THEN 1 ELSE 0 END) AS ${name}`;
  return `EXISTS (
    WITH RECURSIVE
    ${protectedNormalizedSqlCtes(values)},
    raw_legal_claim_flags AS (
      SELECT
        ${flag(
          "protected_claim",
          semanticMatchOnNormalizedSql(
            "normalized.value",
            PROTECTED_LEGAL_PHRASES,
            PROTECTED_LEGAL_FAMILIES,
          ),
        )},
        ${flag(
          "positive_charity_status_raw",
          semanticMatchOnNormalizedSql(
            "normalized.value",
            POSITIVE_CHARITY_STATUS_CLAIM_PHRASES,
            POSITIVE_CHARITY_STATUS_CLAIM_FAMILIES,
          ),
        )},
        ${flag(
          "negative_charity_status",
          phraseMatchOnNormalizedSql(
            "normalized.value",
            NEGATIVE_CHARITY_STATUS_CLAIM_PHRASES,
          ),
        )},
        ${flag(
          "positive_charity_benefit_raw",
          semanticMatchOnNormalizedSql(
            "normalized.value",
            CHARITY_BENEFIT_CLAIM_PHRASES,
            CHARITY_BENEFIT_CLAIM_FAMILIES,
          ),
        )},
        ${flag(
          "negative_charity_benefit",
          phraseMatchOnNormalizedSql(
            "normalized.value",
            NEGATIVE_CHARITY_BENEFIT_CLAIM_PHRASES,
          ),
        )},
        ${flag(
          "provincial_status",
          semanticMatchOnNormalizedSql(
            "normalized.value",
            PROVINCIAL_STATUS_CLAIM_PHRASES,
            PROVINCIAL_STATUS_CLAIM_FAMILIES,
          ),
        )}
      FROM protected_normalized AS normalized
      WHERE instr(normalized.value, '  ') = 0
    ),
    legal_claim_flags AS (
      SELECT
        protected_claim,
        CASE
          WHEN negative_charity_status = 0
           AND positive_charity_status_raw = 1
          THEN 1 ELSE 0
        END AS positive_charity_status,
        negative_charity_status,
        CASE
          WHEN negative_charity_benefit = 0
           AND positive_charity_benefit_raw = 1
          THEN 1 ELSE 0
        END AS positive_charity_benefit,
        negative_charity_benefit,
        provincial_status
      FROM raw_legal_claim_flags
    )
    SELECT 1
    FROM legal_claim_flags AS legal_flags
    WHERE (${predicateSql})
  )`;
}

function containsClaimPhrase(
  value: string,
  phrases: readonly string[],
): boolean {
  const normalized = normalizeProtectedLegalClaimText(value);
  const compact = normalized.replaceAll(" ", "");
  return phrases.some(
    (phrase) =>
      normalized.includes(phrase) ||
      compact.includes(phrase.replaceAll(" ", "")),
  );
}

function containsClaimFamily(
  value: string,
  families: readonly (readonly (readonly string[])[])[],
): boolean {
  const normalized = normalizeProtectedLegalClaimText(value);
  return families.some((family) =>
    family.every((alternatives) =>
      alternatives.some((needle) =>
        normalizedContainsNeedle(normalized, needle),
      ),
    ),
  );
}

function normalizedContainsNeedle(
  normalized: string,
  needle: string,
): boolean {
  if (!needle.includes(" ") && needle.length <= 3) {
    const padded = ` ${normalized} `;
    return (
      padded.includes(` ${needle} `) ||
      padded.includes(` ${[...needle].join(" ")} `)
    );
  }
  return (
    normalized.includes(needle) ||
    normalized.replaceAll(" ", "").includes(needle.replaceAll(" ", ""))
  );
}

function protectedClaimSql(
  expressions: readonly string[],
  phrases: readonly string[],
): string {
  if (expressions.length === 0) return "0";
  const values = expressions
    .map((expression) => `COALESCE(${expression}, '')`)
    .join(", ");
  return `EXISTS (
    WITH RECURSIVE
    ${protectedNormalizedSqlCtes(values)}
    SELECT 1
    FROM protected_normalized AS normalized
    WHERE instr(normalized.value, '  ') = 0
      AND EXISTS (
        SELECT 1
        FROM json_each(
          '${sqlJsonArrayLiteral(phrases)}'
        ) AS protected_phrase
        WHERE instr(
                normalized.value,
                CAST(protected_phrase.value AS TEXT)
              ) > 0
           OR instr(
                replace(normalized.value, ' ', ''),
                replace(
                  CAST(protected_phrase.value AS TEXT),
                  ' ',
                  ''
                )
              ) > 0
      )
  )`;
}

function protectedFamilySql(
  expressions: readonly string[],
  families: readonly (readonly (readonly string[])[])[],
): string {
  if (expressions.length === 0) return "0";
  const values = expressions
    .map((expression) => `COALESCE(${expression}, '')`)
    .join(", ");
  return `EXISTS (
    WITH RECURSIVE
    ${protectedNormalizedSqlCtes(values)}
    SELECT 1
    FROM protected_normalized AS normalized
    WHERE instr(normalized.value, '  ') = 0
      AND ${protectedFamilyMatchSql("normalized.value", families)}
  )`;
}

/**
 * Checks phrase and semantic-family matches over one normalized value stream.
 * Keeping both match modes inside the same CTE is important for D1: composing
 * two independently normalized EXISTS expressions can exceed SQLite's
 * expression-depth limit when this predicate is embedded in a publication
 * guard that already has several exact-revision joins.
 */
function semanticClaimSql(
  expressions: readonly string[],
  phrases: readonly string[],
  families: readonly (readonly (readonly string[])[])[],
): string {
  if (expressions.length === 0) return "0";
  const values = expressions
    .map((expression) => `COALESCE(${expression}, '')`)
    .join(", ");
  return `EXISTS (
    WITH RECURSIVE
    ${protectedNormalizedSqlCtes(values)}
    SELECT 1
    FROM protected_normalized AS normalized
    WHERE instr(normalized.value, '  ') = 0
      AND (
        EXISTS (
          SELECT 1
          FROM json_each(
            '${sqlJsonArrayLiteral(phrases)}'
          ) AS protected_phrase
          WHERE instr(
                  normalized.value,
                  CAST(protected_phrase.value AS TEXT)
                ) > 0
             OR instr(
                  replace(normalized.value, ' ', ''),
                  replace(
                    CAST(protected_phrase.value AS TEXT),
                    ' ',
                    ''
                  )
                ) > 0
        )
        OR ${protectedFamilyMatchSql("normalized.value", families)}
      )
  )`;
}

function semanticMatchOnNormalizedSql(
  normalizedExpression: string,
  phrases: readonly string[],
  families: readonly (readonly (readonly string[])[])[],
): string {
  return `(
    ${phraseMatchOnNormalizedSql(normalizedExpression, phrases)}
    OR ${protectedFamilyMatchSql(normalizedExpression, families)}
  )`;
}

function phraseMatchOnNormalizedSql(
  normalizedExpression: string,
  phrases: readonly string[],
): string {
  return `EXISTS (
    SELECT 1
    FROM json_each(
      '${sqlJsonArrayLiteral(phrases)}'
    ) AS protected_phrase
    WHERE instr(
            ${normalizedExpression},
            CAST(protected_phrase.value AS TEXT)
          ) > 0
       OR instr(
            replace(${normalizedExpression}, ' ', ''),
            replace(CAST(protected_phrase.value AS TEXT), ' ', '')
          ) > 0
  )`;
}

/**
 * A family matches when every required alternative-group has at least one
 * matching needle. Express that as one flat joined relation and a grouped
 * cardinality check. The former nested NOT EXISTS / NOT EXISTS / EXISTS shape
 * consumed almost the full SQLite expression-depth budget before a caller
 * added any authorization or projection predicates.
 */
function protectedFamilyMatchSql(
  normalizedExpression: string,
  families: readonly (readonly (readonly string[])[])[],
): string {
  return `EXISTS (
    SELECT 1
    FROM json_each(
      '${sqlJsonArrayLiteral(families)}'
    ) AS protected_family
    JOIN json_each(protected_family.value) AS required_group
    JOIN json_each(required_group.value) AS protected_needle
    WHERE ${protectedNeedleMatchSql(
      normalizedExpression,
      "protected_needle.value",
    )}
    GROUP BY protected_family.key
    HAVING count(DISTINCT required_group.key) =
           json_array_length(protected_family.value)
  )`;
}

function protectedNeedleMatchSql(
  normalizedExpression: string,
  needleExpression: string,
): string {
  const needle = `CAST(${needleExpression} AS TEXT)`;
  return `CASE
    WHEN instr(${needle}, ' ') = 0
     AND length(${needle}) <= 3
    THEN (
      instr(
        ' ' || ${normalizedExpression} || ' ',
        ' ' || ${needle} || ' '
      ) > 0
      OR instr(
        ' ' || ${normalizedExpression} || ' ',
        ' ' || CASE length(${needle})
          WHEN 1 THEN ${needle}
          WHEN 2 THEN
            substr(${needle}, 1, 1) || ' ' ||
            substr(${needle}, 2, 1)
          ELSE
            substr(${needle}, 1, 1) || ' ' ||
            substr(${needle}, 2, 1) || ' ' ||
            substr(${needle}, 3, 1)
        END || ' '
      ) > 0
    )
    ELSE (
      instr(${normalizedExpression}, ${needle}) > 0
      OR instr(
        replace(${normalizedExpression}, ' ', ''),
        replace(${needle}, ' ', '')
      ) > 0
    )
  END`;
}

function sqlJsonArrayLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll("'", "''");
}

const PROTECTED_LEGAL_SQL_REPLACEMENT_CODE_POINTS = Object.freeze([
  ...PROTECTED_LEGAL_IGNORABLE_CODE_POINTS,
  ...PROTECTED_LEGAL_SEPARATOR_CODE_POINTS,
]);
const PROTECTED_LEGAL_SQL_REPLACEMENT_JSON = JSON.stringify(
  PROTECTED_LEGAL_SQL_REPLACEMENT_CODE_POINTS,
);

/**
 * SQLite caps expression-tree depth at 100, so the earlier static chain of
 * roughly two hundred nested replace() calls could not execute in D1. Walk
 * the same ordered code-point list as shallow recursive rows instead. The
 * recursion is bounded by the compile-time list plus logarithmic whitespace
 * collapsing and preserves the JavaScript normalizer's exact semantics.
 */
function protectedNormalizedSqlCtes(valuesSql: string): string {
  return `protected_source(field_key, value) AS (
      SELECT CAST(protected_field.key AS INTEGER),
             lower(CAST(protected_field.value AS TEXT))
      FROM json_each(json_array(${valuesSql})) AS protected_field
    ),
    protected_replaced(field_key, replacement_index, value) AS (
      SELECT field_key, 0, value
      FROM protected_source
      UNION ALL
      SELECT
        field_key,
        replacement_index + 1,
        replace(
          value,
          char(CAST(json_extract(
            '${PROTECTED_LEGAL_SQL_REPLACEMENT_JSON}',
            '$[' || replacement_index || ']'
          ) AS INTEGER)),
          CASE
            WHEN replacement_index <
                 ${PROTECTED_LEGAL_IGNORABLE_CODE_POINTS.length}
            THEN ''
            ELSE ' '
          END
        )
      FROM protected_replaced
      WHERE replacement_index <
            ${PROTECTED_LEGAL_SQL_REPLACEMENT_CODE_POINTS.length}
    ),
    protected_normalized(field_key, value) AS (
      SELECT field_key, trim(value)
      FROM protected_replaced
      WHERE replacement_index =
            ${PROTECTED_LEGAL_SQL_REPLACEMENT_CODE_POINTS.length}
      UNION ALL
      SELECT field_key, replace(value, '  ', ' ')
      FROM protected_normalized
      WHERE instr(value, '  ') > 0
    )`;
}

export function assertNoProtectedLegalClaim(
  value: string,
  path: string,
): string {
  if (containsProtectedLegalClaim(value)) {
    throw validationIssue(
      path,
      "protected_legal_claim",
      "Legal or charity claims must use the confirmed legal-status workflow.",
    );
  }
  return value;
}
