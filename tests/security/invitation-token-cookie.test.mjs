import assert from "node:assert/strict";
import test from "node:test";
import {
  clearInvitationTokenCookie,
  invitationTokenCookie,
  isInvitationToken,
  readInvitationTokenCookie,
} from "../../lib/server/organizer/invitation-token-cookie.ts";

const TOKEN = "A".repeat(43);

test("invitation token cookies are short lived, HttpOnly, and path scoped", () => {
  const production = invitationTokenCookie(TOKEN, false);
  assert.match(production, /^__Secure-vcc_invitation=/u);
  assert.match(production, /; HttpOnly/u);
  assert.match(production, /; SameSite=Lax/u);
  assert.match(production, /; Path=\/accept-invitation/u);
  assert.match(production, /; Max-Age=600/u);
  assert.match(production, /; Secure/u);
  assert.equal(
    readInvitationTokenCookie(production, false),
    TOKEN,
  );

  const local = invitationTokenCookie(TOKEN, true);
  assert.match(local, /^vcc_invitation_local=/u);
  assert.doesNotMatch(local, /; Secure/u);
  assert.equal(readInvitationTokenCookie(local, true), TOKEN);
});

test("malformed invitation values are never accepted as cookie tokens", () => {
  assert.equal(isInvitationToken("too-short"), false);
  assert.equal(isInvitationToken(`${"A".repeat(42)}!`), false);
  assert.equal(
    readInvitationTokenCookie(
      "__Secure-vcc_invitation=not-a-token; other=value",
      false,
    ),
    null,
  );
  assert.throws(
    () => invitationTokenCookie("not-a-token", false),
    /could not be validated/u,
  );
});

test("terminal invitation responses use an exact matching removal cookie", () => {
  const production = clearInvitationTokenCookie(false);
  assert.equal(
    production,
    "__Secure-vcc_invitation=; HttpOnly; SameSite=Lax; Path=/accept-invitation; Max-Age=0; Secure",
  );
  const local = clearInvitationTokenCookie(true);
  assert.equal(
    local,
    "vcc_invitation_local=; HttpOnly; SameSite=Lax; Path=/accept-invitation; Max-Age=0",
  );
});
