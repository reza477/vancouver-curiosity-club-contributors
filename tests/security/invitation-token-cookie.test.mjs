import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import test from "node:test";
import { SafeApplicationError } from "../../lib/validation/server-observability.ts";
import {
  clearInvitationTokenCookie,
  invitationTokenCookie,
  isInvitationToken,
  readInvitationTokenCookie,
} from "../../lib/server/organizer/invitation-token-cookie.ts";

const TOKEN = "A".repeat(43);
const ROUTE_HEADERS = {};
const ROUTE_DATABASE = {
  batch() {
    throw new Error("The invitation route mock must not access D1.");
  },
  prepare() {
    throw new Error("The invitation route mock must not access D1.");
  },
};
const ROUTE_ENVIRONMENT = {
  DB: ROUTE_DATABASE,
};
let invitationAttempt = async () => ({ role: "organizer" });

globalThis.__VCC_PHASE8_INVITATION_ROUTE_ENV__ = ROUTE_ENVIRONMENT;
globalThis.__VCC_PHASE8_INVITATION_ROUTE_HEADERS__ = ROUTE_HEADERS;
globalThis.__VCC_PHASE8_INVITATION_ATTEMPT__ = (...arguments_) =>
  invitationAttempt(...arguments_);

nodeModule.registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export const env = globalThis.__VCC_PHASE8_INVITATION_ROUTE_ENV__;",
        ),
      };
    }
    if (specifier === "next/headers") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function headers() { return new Headers(globalThis.__VCC_PHASE8_INVITATION_ROUTE_HEADERS__); }",
        ),
      };
    }
    if (specifier === "next/navigation") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export function redirect() { throw new Error('unexpected redirect'); }",
        ),
      };
    }
    if (specifier === "@/lib/server/organizer/invitations") {
      return {
        shortCircuit: true,
        url: dataModule(
          "export async function acceptOrganizerInvitation(...args) { return globalThis.__VCC_PHASE8_INVITATION_ATTEMPT__(...args); }",
        ),
      };
    }
    if (specifier === "server-only") {
      return { shortCircuit: true, url: dataModule("export {};") };
    }
    return nextResolve(specifier, context);
  },
});

const invitationConsumeRoute = await import(
  "../../app/accept-invitation/consume/route.ts?phase8-cookie-lifecycle"
);

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

test("invitation bearer cookies survive unauthenticated, cross-site, and rate-limited attempts", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "app",
      "accept-invitation",
      "consume",
      "route.ts",
    ),
    "utf8",
  );
  assert.match(source, /let reachedTokenAttempt = false/u);
  assert.match(
    source,
    /await readOrganizerMutationBody\(request,\s*64\);\s*reachedTokenAttempt = true;/u,
  );
  assert.match(
    source,
    /reachedTokenAttempt\s*&&\s*error instanceof SafeApplicationError/u,
  );
  assert.match(source, /error\.status !== 429/u);
});

test("invitation consume route clears the bearer only after a terminal same-origin token attempt", async (t) => {
  const productionCookie = invitationTokenCookie(TOKEN, false);
  const removalCookie = clearInvitationTokenCookie(false);
  const setIdentity = (authenticated) => {
    for (const key of Object.keys(ROUTE_HEADERS)) delete ROUTE_HEADERS[key];
    if (authenticated) {
      ROUTE_HEADERS["oai-authenticated-user-email"] =
        "invitee@phase8.invalid";
      ROUTE_HEADERS["oai-authenticated-user-full-name"] =
        "Phase%208%20Invitee";
      ROUTE_HEADERS[
        "oai-authenticated-user-full-name-encoding"
      ] = "percent-encoded-utf-8";
    }
  };

  await t.test("cross-origin request retains the valid pending bearer", async () => {
    setIdentity(true);
    let calls = 0;
    invitationAttempt = async () => {
      calls += 1;
      return { role: "organizer" };
    };
    const response = await invitationConsumeRoute.POST(
      invitationRequest(productionCookie, "https://attacker.invalid"),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(calls, 0);
  });

  await t.test("unauthenticated same-origin request retains the bearer", async () => {
    setIdentity(false);
    let calls = 0;
    invitationAttempt = async () => {
      calls += 1;
      return { role: "organizer" };
    };
    const response = await invitationConsumeRoute.POST(
      invitationRequest(productionCookie),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(calls, 0);
  });

  await t.test("authenticated rate limit retains the bearer", async () => {
    setIdentity(true);
    invitationAttempt = async () => {
      throw new SafeApplicationError(
        "rate_limited",
        429,
        "Try again later.",
      );
    };
    const response = await invitationConsumeRoute.POST(
      invitationRequest(productionCookie),
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  await t.test("successful acceptance clears the exact bearer cookie", async () => {
    setIdentity(true);
    invitationAttempt = async () => ({ role: "organizer" });
    const response = await invitationConsumeRoute.POST(
      invitationRequest(productionCookie),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), removalCookie);
  });

  await t.test("terminal invalid or used token clears the exact bearer cookie", async () => {
    setIdentity(true);
    invitationAttempt = async () => {
      throw new SafeApplicationError(
        "authorization_denied",
        403,
        "This invitation is not available.",
      );
    };
    const response = await invitationConsumeRoute.POST(
      invitationRequest(productionCookie),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), removalCookie);
  });
});

function invitationRequest(cookie, origin = "https://vcc.example") {
  return new Request(
    "https://vcc.example/accept-invitation/consume",
    {
      body: "{}",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site":
          origin === "https://vcc.example" ? "same-origin" : "cross-site",
      },
      method: "POST",
    },
  );
}

function dataModule(sourceText) {
  return `data:text/javascript,${encodeURIComponent(sourceText)}`;
}
