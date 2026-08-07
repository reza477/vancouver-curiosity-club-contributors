import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readSourceRevision } from "../../build/source-revision.ts";

test("a clean build reports the exact full Git HEAD revision", async (t) => {
  const repository = await temporaryRepository(t);
  const head = git(repository, "rev-parse", "HEAD").trim().toLowerCase();

  assert.match(head, /^[0-9a-f]{40}$/u);
  assert.equal(
    readSourceRevision({ cwd: repository, requireClean: true }),
    head,
  );
});

test("a tracked source change cannot claim the clean HEAD revision", async (t) => {
  const repository = await temporaryRepository(t);
  const head = git(repository, "rev-parse", "HEAD").trim().toLowerCase();
  await writeFile(
    path.join(repository, "event-source.json"),
    '{"event":"changed after commit"}\n',
    "utf8",
  );

  assert.throws(
    () => readSourceRevision({ cwd: repository, requireClean: true }),
    /clean|dirty|uncommitted|working tree/iu,
  );
  assert.equal(git(repository, "rev-parse", "HEAD").trim().toLowerCase(), head);
});

test("an untracked source file cannot claim the clean HEAD revision", async (t) => {
  const repository = await temporaryRepository(t);
  const head = git(repository, "rev-parse", "HEAD").trim().toLowerCase();
  await writeFile(
    path.join(repository, "untracked-event.json"),
    '{"event":"not represented by HEAD"}\n',
    "utf8",
  );

  assert.throws(
    () => readSourceRevision({ cwd: repository, requireClean: true }),
    /clean|dirty|uncommitted|working tree/iu,
  );
  assert.equal(git(repository, "rev-parse", "HEAD").trim().toLowerCase(), head);
});

async function temporaryRepository(t) {
  const repository = await mkdtemp(path.join(tmpdir(), "vcc-source-revision-"));
  t.after(() => rm(repository, { force: true, recursive: true }));

  git(repository, "init", "--quiet");
  git(repository, "config", "user.email", "source-revision-test@example.com");
  git(repository, "config", "user.name", "Source Revision Test");
  await writeFile(
    path.join(repository, "event-source.json"),
    '{"event":"committed"}\n',
    "utf8",
  );
  git(repository, "add", "event-source.json");
  git(repository, "commit", "--quiet", "-m", "Seed committed source");
  assert.equal(git(repository, "status", "--porcelain"), "");

  return repository;
}

function git(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
