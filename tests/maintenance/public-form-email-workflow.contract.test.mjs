import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/daily-meetup-refresh.yml",
  "utf8",
);
const runner = readFileSync(
  "scripts/run-form-email-maintenance.mjs",
  "utf8",
);
const viteConfig = readFileSync("vite.config.ts", "utf8");

test("daily maintenance runs organizer email delivery independently of Meetup", () => {
  const emailJob = workflow.indexOf("  form-email:");
  const meetupJob = workflow.indexOf("  refresh:");
  assert.ok(emailJob > 0 && meetupJob > emailJob);
  assert.match(workflow, /Deliver queued organizer form emails/u);
  assert.match(workflow, /actions\/checkout@v6/u);
  assert.match(workflow, /node scripts\/run-form-email-maintenance\.mjs/u);
  assert.doesNotMatch(
    workflow.slice(emailJob, meetupJob),
    /needs:\s*refresh|continue-on-error:\s*true/iu,
  );
});

test("email maintenance signs an exact bounded request and hard-fails delivery errors", () => {
  assert.match(runner, /\/api\/maintenance\/forms\/email/u);
  assert.match(runner, /const body = "\{\}"/u);
  assert.match(runner, /createHmac\("sha256", secret\)/u);
  assert.match(runner, /JSON\.stringify\(\[[\s\S]*?PATHNAME[\s\S]*?body/u);
  assert.match(runner, /randomUUID\(\)/u);
  assert.match(runner, /redirect: "error"/u);
  assert.match(runner, /AbortSignal\.timeout\(90_000\)/u);
  assert.match(runner, /MAX_INVARIANT_REPAIR_ATTEMPTS = 16/u);
  assert.match(runner, /MAX_DELIVERY_INVOCATIONS = 32/u);
  assert.match(runner, /MAX_RETRY_AFTER_SECONDS = 30/u);
  assert.match(runner, /response\.status !== 503/u);
  assert.match(runner, /report\.status === "continue"/u);
  assert.match(runner, /totals\.blocked \+ totals\.retried/u);
  assert.match(runner, /exceeded its \$\{MAX_DELIVERY_INVOCATIONS\}-invocation safety limit/u);
  assert.doesNotMatch(
    runner,
    /set\s+-x|continue-on-error|dotenv|--env-file|readFile[^\n]*\.env/iu,
  );
});

test("production routes third-party email API calls through the public network", () => {
  assert.match(
    viteConfig,
    /compatibility_flags:\s*\["nodejs_compat",\s*"global_fetch_strictly_public"\]/u,
    "Resend is a public Worker endpoint, so the production Worker must use public fetch routing",
  );
});
