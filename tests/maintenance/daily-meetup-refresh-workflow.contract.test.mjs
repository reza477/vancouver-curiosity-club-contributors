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

test("daily form delivery runs off-hour while Meetup refresh requires manual dispatch", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.match(
    workflow,
    /^name:\s*Daily form delivery and manual Meetup refresh\s*$/mu,
  );
  assert.match(workflow, /^on:\s*$/mu);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/mu);
  assert.match(workflow, /^\s{2}schedule:\s*$/mu);
  assert.match(workflow, /^\s+- cron:\s*["']17 0 \* \* \*["']\s*$/mu);
  assert.match(
    workflow,
    /^\s+timezone:\s*["']?America\/Vancouver["']?\s*$/mu,
  );
  assert.match(workflow, /^permissions:\s*\r?\n\s+contents:\s*read\s*$/mu);
  assert.match(workflow, /timeout-minutes:\s*(?:[1-9]|1\d|20)\s*$/mu);
  assert.match(workflow, /^\s+group:\s*daily-meetup-refresh\s*$/mu);
  assert.match(workflow, /^\s+cancel-in-progress:\s*false\s*$/mu);
  const emailJob = workflow.indexOf("  form-email:");
  const meetupJob = workflow.indexOf("  refresh:");
  assert.ok(emailJob > 0 && meetupJob > emailJob);
  assert.doesNotMatch(
    workflow.slice(emailJob, meetupJob),
    /github\.event_name\s*==\s*['"]workflow_dispatch['"]/u,
    "scheduled runs must continue delivering queued organizer form emails",
  );
  assert.match(
    workflow.slice(meetupJob),
    /^\s+if:\s*\$\{\{\s*github\.event_name\s*==\s*['"]workflow_dispatch['"]\s*\}\}\s*$/mu,
    "Meetup synchronization must require an intentional manual dispatch",
  );
});

test("workflow signs the timestamp, UUID, route, and exact body without exposing the secret", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.equal(
    (
      workflow.match(
        /\$\{\{\s*secrets\.DAILY_MEETUP_REFRESH_SECRET\s*\}\}/gu,
      ) ?? []
    ).length,
    2,
    "each independent signed maintenance job needs one step-level secret binding",
  );
  assert.match(
    workflow,
    /^\s+DAILY_MEETUP_REFRESH_SECRET:\s*\$\{\{\s*secrets\.DAILY_MEETUP_REFRESH_SECRET\s*\}\}\s*$/mu,
  );
  assert.match(workflow, /randomUUID|\/proc\/sys\/kernel\/random\/uuid|uuidgen/iu);
  assert.match(workflow, /for invocation in \$\(seq 1 64\)/u);
  assert.match(
    workflow,
    /for invariant_repair_attempt in \$\(seq 1 "\$max_invariant_repair_attempts"\)/u,
  );
  const repairLoop = workflow.indexOf("for invariant_repair_attempt");
  assert.ok(
    workflow.indexOf("timestamp=", repairLoop) > repairLoop &&
      workflow.indexOf("request_id=", repairLoop) > repairLoop &&
      workflow.indexOf("signature=", repairLoop) > repairLoop,
    "every invariant-repair attempt must regenerate its timestamp, request ID, and signature",
  );
  assert.match(workflow, /date\s+-u\s+\+%s/u);
  assert.match(workflow, /body=(?:["']\{\}["']|\$'\{\}')/u);
  assert.match(workflow, /createHmac\s*\(\s*["']sha256["']/u);
  assert.match(
    workflow,
    /PATHNAME='\/api\/maintenance\/meetup\/refresh'/u,
  );
  assert.match(
    workflow,
    /PATHNAME='\/api\/maintenance\/public-snapshots\/capture'/u,
  );
  assert.match(workflow, /JSON\.stringify\(\[process\.env\.TIMESTAMP/u);
  assert.match(
    workflow,
    /timestamp[^\r\n]{0,360}request[_A-Za-z]*id[^\r\n]{0,360}pathname[^\r\n]{0,360}body/iu,
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

test("workflow retries only deliberate invariant-repair 503 responses and hard-fails other HTTP errors", () => {
  const workflow = source(WORKFLOW_PATH);
  assert.match(workflow, /set\s+-euo\s+pipefail/u);
  assert.match(workflow, /curl[\s\S]*--request\s+POST/iu);
  assert.match(workflow, /--connect-timeout\s+15/u);
  assert.match(workflow, /--max-time\s+90/u);
  assert.match(workflow, /--fail(?:-with-body)?/u);
  assert.match(workflow, /--dump-header\s+"\$header_file"/u);
  assert.match(workflow, /--write-out\s+'%\{http_code\}'/u);
  assert.match(workflow, /max_invariant_repair_attempts=16/u);
  assert.match(workflow, /max_invariant_retry_after_seconds=30/u);
  assert.match(
    workflow,
    /invariant_repair_detail='<p>The database safety checks were updated\. Please try again shortly so the fresh state can be verified\.<\/p>'/u,
  );
  assert.match(
    workflow,
    /\[ "\$curl_status" -ne 22 \] \|\|\s*\[ "\$http_status" != 503 \] \|\|\s*! grep --fixed-strings --quiet "\$invariant_repair_detail" "\$response_file"/u,
  );
  assert.match(
    workflow,
    /\[ "\$invariant_repair_attempt" -ge "\$max_invariant_repair_attempts" \][\s\S]{0,240}?exit 1/u,
  );
  assert.match(workflow, /sleep "\$retry_after"/u);
  assert.match(
    workflow,
    /The invariant-repair response had an invalid Retry-After header\.[\s\S]{0,120}?exit 1/u,
  );
  assert.doesNotMatch(
    workflow,
    /^\s+--retry(?:\s|=|-)/mu,
    "curl-level retries would reuse the signed timestamp and request ID",
  );
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

test("Retry-After parsing honors bounded delay-seconds and rejects missing or invalid values", (t) => {
  const workflow = source(WORKFLOW_PATH);
  const parser =
    /node - "\$header_file" "\$max_invariant_retry_after_seconds" <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/u.exec(
      workflow,
    );
  assert.ok(parser, "the deliberate-503 branch must parse Retry-After itself");

  const directory = mkdtempSync(join(tmpdir(), "vcc-retry-after-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const headerPath = join(directory, "headers.txt");
  const execute = (headers) => {
    writeFileSync(headerPath, headers, "utf8");
    return spawnSync(process.execPath, ["-", headerPath, "30"], {
      encoding: "utf8",
      input: parser[1],
    });
  };

  const honored = execute("HTTP/2 503\r\nRetry-After: 7\r\n\r\n");
  assert.equal(honored.status, 0, honored.stderr);
  assert.equal(honored.stdout, "7");

  const capped = execute("HTTP/2 503\r\nretry-after: 999999\r\n\r\n");
  assert.equal(capped.status, 0, capped.stderr);
  assert.equal(capped.stdout, "30");

  for (const headers of [
    "HTTP/2 503\r\n\r\n",
    "HTTP/2 503\r\nRetry-After: eventually\r\n\r\n",
  ]) {
    const rejected = execute(headers);
    assert.equal(rejected.status, 2, headers);
  }
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
