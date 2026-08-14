import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = process.cwd();
const WORKFLOW_PATH =
  ".github/workflows/daily-meetup-refresh.yml";

test("daily Meetup refresh runs off-hour in Vancouver and can also be dispatched manually", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.match(workflow, /^name:\s*Daily Meetup refresh\s*$/mu);
  assert.match(workflow, /^on:\s*$/mu);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/mu);
  assert.match(workflow, /^\s{2}schedule:\s*$/mu);
  assert.match(workflow, /^\s+- cron:\s*["']17 4 \* \* \*["']\s*$/mu);
  assert.match(
    workflow,
    /^\s+timezone:\s*["']?America\/Vancouver["']?\s*$/mu,
  );
  assert.match(workflow, /^permissions:\s*\r?\n\s+contents:\s*read\s*$/mu);
  assert.match(workflow, /timeout-minutes:\s*(?:[1-9]|1\d|20)\s*$/mu);
  assert.match(workflow, /^\s+group:\s*daily-meetup-refresh\s*$/mu);
  assert.match(workflow, /^\s+cancel-in-progress:\s*false\s*$/mu);
});

test("workflow signs the timestamp, UUID, and exact empty body without exposing the secret", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.equal(
    (
      workflow.match(
        /\$\{\{\s*secrets\.DAILY_MEETUP_REFRESH_SECRET\s*\}\}/gu,
      ) ?? []
    ).length,
    1,
    "the GitHub secret should enter only through one step-level environment binding",
  );
  assert.match(
    workflow,
    /^\s+DAILY_MEETUP_REFRESH_SECRET:\s*\$\{\{\s*secrets\.DAILY_MEETUP_REFRESH_SECRET\s*\}\}\s*$/mu,
  );
  assert.match(workflow, /randomUUID|\/proc\/sys\/kernel\/random\/uuid|uuidgen/iu);
  assert.match(workflow, /for invocation in \$\(seq 1 64\)/u);
  assert.ok(
    workflow.indexOf("request_id=") > workflow.indexOf("for invocation"),
    "every bounded invocation must generate a fresh replay-protected request ID",
  );
  assert.match(workflow, /date\s+-u\s+\+%s/u);
  assert.match(workflow, /body=(?:["']\{\}["']|\$'\{\}')/u);
  assert.match(workflow, /createHmac\s*\(\s*["']sha256["']/u);
  assert.match(
    workflow,
    /timestamp[^\r\n]{0,240}request[_A-Za-z]*id[^\r\n]{0,240}body/iu,
  );
  assert.match(workflow, /x-maintenance-timestamp/iu);
  assert.match(workflow, /x-maintenance-request-id/iu);
  assert.match(workflow, /x-maintenance-signature/iu);
  assert.match(workflow, /sha256=/iu);
  assert.doesNotMatch(workflow, /set\s+-x|curl\s+[^\r\n]*-[^\r\n]*v\b/iu);
  assert.doesNotMatch(
    workflow,
    /(?:echo|printf|console\.log)[^\r\n]*(?:DAILY_MEETUP_REFRESH_SECRET|process\.env[^\r\n]*SECRET)/iu,
  );
  assert.doesNotMatch(workflow, /INITIAL_OWNER_EMAIL|cookie:|oai-authenticated-user/iu);
});

test("workflow treats any HTTP or reporting failure as a failed run", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.match(workflow, /set\s+-euo\s+pipefail/u);
  assert.match(workflow, /curl[\s\S]*--request\s+POST/iu);
  assert.match(workflow, /--connect-timeout\s+15/u);
  assert.match(workflow, /--max-time\s+90/u);
  assert.match(workflow, /--fail(?:-with-body)?/u);
  assert.match(workflow, /vars\.PUBLIC_SITE_URL/iu);
  assert.match(workflow, /PUBLIC_SITE_URL[^\r\n]*vancouvercuriosityclub\.com/iu);
  assert.match(
    workflow,
    /refresh_url=[^\r\n]*public_site_origin[^\r\n]*api\/maintenance\/meetup\/refresh/iu,
  );
  assert.match(workflow, /PUBLIC_SITE_URL must be one exact HTTPS origin/iu);
  assert.match(workflow, /"\$refresh_url"/u);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/iu);
  assert.doesNotMatch(workflow, /\|\|\s*true/u);
  assert.match(workflow, /status/iu);
  assert.match(workflow, /counts/iu);
  for (const aggregate of [
    "total_created",
    "total_updated",
    "total_cancelled",
    "total_removed",
    "total_rejected",
  ]) {
    assert.match(workflow, new RegExp(aggregate, "u"));
  }
  assert.match(workflow, /## Daily Meetup refresh succeeded/u);
  assert.match(workflow, /## Daily Meetup refresh failed/u);
  assert.match(workflow, /Home snapshot events/u);
  assert.match(workflow, /Durable Events datasets/u);
  assert.match(workflow, /Materialized event details/u);
  assert.match(
    workflow,
    /eventDetailCount:\s*number\([\s\S]*?materializations\?\.eventDetailCount/u,
    "the workflow must normalize the detail count before reporting success",
  );
  assert.match(workflow, /Created before failure/u);
  assert.match(workflow, /unsafe report shape/iu);
  assert.match(workflow, /exceeded its 64-invocation safety limit/iu);
});

test("aggregate count extraction terminates with a newline for Bash read under errexit", (t) => {
  const workflow = source(WORKFLOW_PATH);
  const extraction =
    /read -r pass_created pass_updated pass_cancelled pass_removed pass_rejected < <\(\s*node -e '([^']+)' "\$report_file"\s*\)/u.exec(
      workflow,
    );
  assert.ok(extraction, "the bounded loop must extract each safe count report");

  const directory = mkdtempSync(join(tmpdir(), "vcc-daily-counts-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const reportPath = join(directory, "report.json");
  writeFileSync(
    reportPath,
    JSON.stringify({
      counts: {
        cancelled: 3,
        created: 1,
        rejected: 5,
        removed: 4,
        updated: 2,
      },
    }),
    "utf8",
  );

  const executed = spawnSync(
    process.execPath,
    ["-e", extraction[1], reportPath],
    { encoding: "utf8" },
  );
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(
    executed.stdout,
    "1 2 3 4 5\n",
    "Bash read returns nonzero at EOF when the producer omits its terminating newline",
  );
});

test("ordinary public request modules have no Meetup synchronization path", () => {
  for (const path of [
    "app/page.tsx",
    "app/events/page.tsx",
    "app/events/[slug]/page.tsx",
    "app/calendar/route.ts",
    "lib/server/database/request-maintenance.ts",
    "lib/server/public/request-cache.ts",
  ]) {
    const publicSource = source(path);
    assert.doesNotMatch(
      publicSource,
      /refreshMeetupCalendarSource|fetchMeetupCalendar|fetchMeetupGroupEvents|runDailyMeetupRefresh|\/api\/maintenance\/meetup\/refresh/u,
      `${path} must read saved public data without synchronizing Meetup`,
    );
  }
});

function source(path) {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}
