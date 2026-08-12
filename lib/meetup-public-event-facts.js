const FACT_KEYS = Object.freeze([
  "agePolicyText",
  "arrivalInstructions",
  "availabilityState",
  "capacity",
  "costText",
  "publicFloor",
  "publicRoom",
  "waitlistAvailable",
]);

const UNSAFE_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const FORBIDDEN_FACT_PATTERN =
  /(?:https?:\/\/|\bwww\.|\b(?:mailto|tel|sms|javascript|data):|\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b(?:passcode|password|access\s+code)\b|\b(?:token|key|pwd)=|\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b)/iu;

/**
 * Extract only bounded, public, explicit logistics facts from a normalized
 * Meetup description. Ambiguous or conflicting source wording fails closed to
 * null; the sync never infers price, age policy, or current availability.
 *
 * @param {unknown} input
 * @param {{ hasPublicVenue?: boolean }} [options]
 * @returns {Readonly<{
 *   agePolicyText: string | null;
 *   arrivalInstructions: string | null;
 *   availabilityState: "open" | "full" | "waitlist" | null;
 *   capacity: number | null;
 *   costText: string | null;
 *   publicFloor: string | null;
 *   publicRoom: string | null;
 *   waitlistAvailable: boolean | null;
 * }>}
 */
export function extractMeetupPublicEventFacts(input, options = {}) {
  const description = typeof input === "string" ? input.normalize("NFKC") : "";
  const hasPublicVenue = options.hasPublicVenue === true;
  if (
    description.length < 1 ||
    description.length > 20_000 ||
    UNSAFE_CONTROL_PATTERN.test(description)
  ) {
    return emptyFacts();
  }

  const publicFloor = hasPublicVenue
    ? uniqueTextMatches(
        description,
        /\b((?:(?:Level|Floor)\s*:?[ \t]*(?:\d{1,3}[A-Za-z]?|ground|main|upper|lower|mezzanine)|\d{1,3}(?:st|nd|rd|th)[ \t]+floor))\b/giu,
        1,
        40,
      )
    : null;
  const publicRoom = hasPublicVenue
    ? uniqueTextMatches(
        description,
        /\bRoom\s*:?[ \t]*([A-Za-z]?\d{1,5}(?:[ \t]+(?:North|South|East|West))?)\b/giu,
        1,
        80,
        (value) => `Room ${value.replace(/\s+/gu, " ").trim()}`,
      )
    : null;
  const capacity = uniqueIntegerMatches(
    description,
    /\b(?:Capacity|Cap)\s*:\s*(\d{1,5})\b/giu,
    1,
    100_000,
  );
  const costText = uniqueLabeledText(
    description,
    /\b(?:Cost|Price|Admission)\s*:\s*([^\n]{1,120}?)(?=\s+(?:Age(?:s| policy| requirement)?|Capacity|Cap|Room|Level|Floor|Waitlist|Availability|Arrival(?: instructions)?|Check-in)\s*:|[.!?](?:\s|$)|$)/giu,
    120,
  );
  const agePolicyText = uniqueLabeledText(
    description,
    /\b(?:Age|Ages|Age policy|Age requirement)\s*:\s*([^\n]{1,120}?)(?=\s+(?:Cost|Price|Admission|Capacity|Cap|Room|Level|Floor|Waitlist|Availability|Arrival(?: instructions)?|Check-in)\s*:|[.!?](?:\s|$)|$)/giu,
    120,
  );
  const availabilityState = uniqueAvailabilityState(description);
  const waitlistAvailable = uniqueWaitlistAvailability(description);
  const arrivalInstructions = uniqueArrivalInstructions(description);

  return Object.freeze({
    agePolicyText,
    arrivalInstructions,
    availabilityState,
    capacity,
    costText,
    publicFloor,
    publicRoom,
    waitlistAvailable,
  });
}

/**
 * Validate optional generated-manifest facts against the same extraction
 * policy used by the automatic importer. Older curated rows may omit all fact
 * keys; a partially present or divergent set is rejected.
 *
 * @param {unknown} candidate
 * @param {ReturnType<typeof extractMeetupPublicEventFacts>} expected
 * @returns {ReturnType<typeof extractMeetupPublicEventFacts>}
 */
export function validateMeetupPublicEventFactsCandidate(candidate, expected) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Invalid curated Meetup public event facts.");
  }
  const record = /** @type {Record<string, unknown>} */ (candidate);
  const presentKeys = FACT_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
  if (presentKeys.length === 0) return expected;
  if (presentKeys.length !== FACT_KEYS.length) {
    throw new Error("Incomplete curated Meetup public event facts.");
  }
  for (const key of FACT_KEYS) {
    if (record[key] !== expected[key]) {
      throw new Error(`Invalid curated Meetup public event fact ${key}.`);
    }
  }
  return expected;
}

function emptyFacts() {
  return Object.freeze({
    agePolicyText: null,
    arrivalInstructions: null,
    availabilityState: null,
    capacity: null,
    costText: null,
    publicFloor: null,
    publicRoom: null,
    waitlistAvailable: null,
  });
}

function uniqueTextMatches(
  input,
  pattern,
  captureIndex,
  maxLength,
  normalize = normalizeFactText,
) {
  const values = [];
  for (const match of input.matchAll(pattern)) {
    const value = normalize(match[captureIndex] ?? "");
    if (isSafeFactText(value, maxLength)) values.push(value);
  }
  return uniqueValue(values);
}

function uniqueIntegerMatches(input, pattern, min, max) {
  const values = [];
  for (const match of input.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value >= min && value <= max) {
      values.push(value);
    }
  }
  return uniqueValue(values);
}

function uniqueLabeledText(input, pattern, maxLength) {
  return uniqueTextMatches(input, pattern, 1, maxLength);
}

function uniqueAvailabilityState(input) {
  const values = [];
  const pattern =
    /\bAvailability\s*:\s*(open|available|spots available|full|sold out|waitlist(?: only)?)\b/giu;
  for (const match of input.matchAll(pattern)) {
    const value = match[1].toLowerCase();
    values.push(
      value === "full" || value === "sold out"
        ? "full"
        : value.startsWith("waitlist")
          ? "waitlist"
          : "open",
    );
  }
  return uniqueValue(values);
}

function uniqueWaitlistAvailability(input) {
  const values = [];
  for (const match of input.matchAll(
    /\bWaitlist\s*:\s*(available|open|yes|enabled|not available|unavailable|closed|no|none)\b/giu,
  )) {
    values.push(!/^(?:not available|unavailable|closed|no|none)$/iu.test(match[1]));
  }
  if (/\+\s*waitlist\b/iu.test(input)) values.push(true);
  return uniqueValue(values);
}

function uniqueArrivalInstructions(input) {
  const values = [];
  const labeledPattern =
    /\b(?:Arrival(?: instructions)?|Check-in|Meeting point|Where to meet)\s*:\s*([^\n]{1,240}?)(?=\s+(?:Cost|Price|Admission|Age(?:s| policy| requirement)?|Capacity|Cap|Room|Level|Floor|Waitlist|Availability)\s*:|[.!?](?:\s|$)|$)/giu;
  for (const match of input.matchAll(labeledPattern)) {
    const value = normalizeFactText(match[1] ?? "");
    if (isSafeFactText(value, 240)) values.push(value);
  }
  for (const match of input.matchAll(/\b(Please arrive [^\n.!?]{1,220}[.!?])/giu)) {
    const value = normalizeFactText(match[1] ?? "");
    if (isSafeFactText(value, 240)) values.push(value);
  }
  return uniqueValue(values);
}

function normalizeFactText(input) {
  return input.replace(/\s+/gu, " ").trim().replace(/[,:;]+$/u, "").trim();
}

function isSafeFactText(value, maxLength) {
  return (
    value.length >= 1 &&
    value.length <= maxLength &&
    !UNSAFE_CONTROL_PATTERN.test(value) &&
    !FORBIDDEN_FACT_PATTERN.test(value)
  );
}

function uniqueValue(values) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}
