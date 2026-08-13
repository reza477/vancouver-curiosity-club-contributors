import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = process.cwd();

test("repository publishes a concise, safe, professional project surface", () => {
  const readme = source("README.md");
  const packageJson = JSON.parse(source("package.json"));
  const gitignore = source(".gitignore");
  const development = source("DEVELOPMENT.md");
  const codeowners = source(".github/CODEOWNERS");
  const issueConfig = source(".github/ISSUE_TEMPLATE/config.yml");

  assert.match(readme, /^# Vancouver Curiosity Club$/mu);
  assert.match(readme, /public\/og\.png/u);
  assert.match(readme, /## Product highlights/u);
  assert.match(readme, /## Local development/u);
  assert.match(readme, /## Quality checks/u);
  assert.match(readme, /## Project structure/u);
  assert.match(readme, /## Contributing and security/u);
  assert.match(readme, /DEVELOPMENT\.md/u);
  assert.match(
    readme,
    /https:\/\/vancouvercuriosityclub\.com/u,
  );
  assert.doesNotMatch(readme, /appg(?:dep|prj|ver)_/u);
  assert.doesNotMatch(readme, /Sites version \d+/u);
  assert.ok(readme.length < 12_000, "README should stay useful and scannable");

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.equal(
    packageJson.repository.url,
    "https://github.com/reza477/vancouver-curiosity-club.git",
  );
  assert.match(gitignore, /^\/_claude_snapshot\.tar\.gz$/mu);

  for (const path of [
    "LICENSE",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "DEVELOPMENT.md",
    "examples/README.md",
    ".editorconfig",
    ".gitattributes",
    ".nvmrc",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ]) {
    assert.ok(source(path).trim().length > 0, path);
  }

  assert.match(source("LICENSE"), /All rights reserved/u);
  assert.match(source("SECURITY.md"), /minimal private callback request/u);
  assert.match(source("SECURITY.md"), /Do not include\s+exploit details/u);
  assert.match(development, /## First 15 minutes/u);
  assert.match(development, /## Architecture at a glance/u);
  assert.match(development, /## Safe change workflow/u);
  assert.match(development, /## Production release boundary/u);
  assert.match(development, /12-15 minutes/u);
  assert.match(development, /does \*\*not\*\* deploy\s+production/u);
  assert.match(development, /db:apply:preview/u);
  assert.doesNotMatch(
    readme,
    /npm(?:\.cmd)? run db:apply:local/u,
    "README must migrate the Vite development database",
  );
  assert.match(readme, /normally `http:\/\/localhost:5173`/u);
  assert.match(readme, /dirty Git working tree/u);
  assert.match(development, /no reusable synthetic dev seed/u);
  assert.match(development, /Event data flow/u);
  assert.match(development, /0008.*0020/u);
  assert.match(source("examples/README.md"), /not production/u);
  assert.doesNotMatch(development, /appg(?:dep|prj|ver)_/u);
  assert.match(development, /private repository/u);
  assert.match(development, /visibility must remain\s+private/u);
  assert.match(development, /Sites project identifier/u);
  assert.match(readme, /Sites project identifier/u);
  assert.match(readme, /github\.com\/reza477\/vancouver-curiosity-club/u);
  assert.match(development, /github\.com\/reza477\/vancouver-curiosity-club\.git/u);
  assert.match(codeowners, /^\* @reza477$/mu);
  assert.match(issueConfig, /https:\/\/vancouvercuriosityclub\.com\/contact/u);
  assert.doesNotMatch(issueConfig, /security\/advisories/u);
  assert.match(packageJson.bugs.url, /github\.com\/reza477\/vancouver-curiosity-club\/issues/u);

  for (const ledger of [
    "BUILD_STATUS.md",
    "OWNER_INPUTS.md",
    "docs/known-limitations-phase8.md",
    "MASTER_BUILD_SPEC.md",
    "docs/owner-guide-phase8.md",
    "docs/organizer-guide-phase8.md",
    "docs/phase8-local-testing.md",
  ]) {
    assert.match(source(ledger), /Historical/u, ledger);
    assert.match(source(ledger), /DEVELOPMENT\.md/u, ledger);
  }
});

test("continuous integration and dependency maintenance cover the release gates", () => {
  const workflow = source(".github/workflows/ci.yml");
  const dependabot = source(".github/dependabot.yml");

  assert.match(workflow, /^permissions:\s*\r?\n\s+contents: read$/mu);
  assert.match(workflow, /actions\/checkout@v6/u);
  assert.match(workflow, /actions\/setup-node@v6/u);
  assert.match(workflow, /node-version-file: \.nvmrc/u);
  for (const command of [
    "npm ci",
    "npm audit --omit=dev",
    "npm run typecheck",
    "npm run lint",
    "npm run build",
    "npm test",
    "npm run test:rendered",
    "git diff --check",
  ]) {
    assert.match(workflow, new RegExp(escapeRegex(command), "u"), command);
  }

  assert.match(dependabot, /package-ecosystem: npm/u);
  assert.match(dependabot, /package-ecosystem: github-actions/u);
  assert.match(dependabot, /interval: weekly/u);
});

function source(path) {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
