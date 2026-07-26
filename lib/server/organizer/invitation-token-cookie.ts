const PRODUCTION_COOKIE_NAME = "__Secure-vcc_invitation";
const LOCAL_COOKIE_NAME = "vcc_invitation_local";
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

export function isInvitationToken(value: unknown): value is string {
  return (
    typeof value === "string" && INVITATION_TOKEN_PATTERN.test(value)
  );
}

export function invitationCookieName(isLocal: boolean): string {
  return isLocal ? LOCAL_COOKIE_NAME : PRODUCTION_COOKIE_NAME;
}

export function invitationTokenCookie(
  token: string,
  isLocal: boolean,
): string {
  if (!isInvitationToken(token)) {
    throw new TypeError("The invitation token could not be validated.");
  }
  return [
    `${invitationCookieName(isLocal)}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/accept-invitation",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    ...(isLocal ? [] : ["Secure"]),
  ].join("; ");
}

export function clearInvitationTokenCookie(isLocal: boolean): string {
  return [
    `${invitationCookieName(isLocal)}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/accept-invitation",
    "Max-Age=0",
    ...(isLocal ? [] : ["Secure"]),
  ].join("; ");
}

export function readInvitationTokenCookie(
  cookieHeader: string | null,
  isLocal: boolean,
): string | null {
  if (!cookieHeader) return null;
  const expectedName = invitationCookieName(isLocal);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== expectedName) continue;
    const value = part.slice(separator + 1).trim();
    return isInvitationToken(value) ? value : null;
  }
  return null;
}
