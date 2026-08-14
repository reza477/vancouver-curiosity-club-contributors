import assert from "node:assert/strict";
import test from "node:test";
import {
  benchmarkPublicRoutes,
  summarizeResults,
} from "../../scripts/bench-public-routes.mjs";

test("public benchmark reports warm percentiles and three concurrent waves", async () => {
  let calls = 0;
  const summary = await benchmarkPublicRoutes({
    baseUrl: "https://club.example",
    concurrency: 20,
    fetchImpl: async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    },
    routes: ["/", "/events", "/clubs"],
    sampleCount: 20,
    timeoutMs: 1_000,
    waveCount: 3,
  });

  assert.equal(calls, 83, "3 warmups + 20 samples + 3 waves of 20");
  assert.equal(summary.samples.count, 20);
  assert.equal(summary.samples.failed, 0);
  assert.equal(summary.waves.length, 3);
  assert.deepEqual(
    summary.waves.map((wave) => wave.count),
    [20, 20, 20],
  );
});

test("public benchmark distinguishes 5xx, timeout, and cancellation", () => {
  const summary = summarizeResults([
    { durationMs: 10, kind: "response", ok: true, status: 200 },
    { durationMs: 20, kind: "response", ok: false, status: 503 },
    { durationMs: 30, kind: "timeout", ok: false, status: 0 },
    { durationMs: 40, kind: "cancelled", ok: false, status: 0 },
  ]);
  assert.equal(summary.failed, 3);
  assert.equal(summary.serverErrors, 1);
  assert.equal(summary.timedOut, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.p50Ms, 10);
});
