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
      return new Response("ok", {
        headers: { "server-timing": "app;dur=12" },
        status: 200,
      });
    },
    routes: ["/", "/events", "/clubs"],
    sampleCount: 20,
    timeoutMs: 1_000,
    waveCount: 3,
  });

  assert.equal(calls, 83, "3 warmups + 20 samples + 3 waves of 20");
  assert.equal(summary.samples.count, 20);
  assert.equal(summary.samples.failed, 0);
  assert.equal(summary.samples.serverTimingMissing, 0);
  assert.equal(summary.samples.serverTimingInvalid, 0);
  assert.equal(summary.samples.appP95Ms, 12);
  assert.equal(summary.warmup.count, 3);
  assert.equal(summary.warmup.failed, 0);
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
    { durationMs: 50, kind: "service_state", ok: false, status: 200 },
  ]);
  assert.equal(summary.failed, 4);
  assert.equal(summary.serverErrors, 1);
  assert.equal(summary.serviceStates, 1);
  assert.equal(summary.timedOut, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.p50Ms, 10);
});

test("public benchmark rejects missing or malformed Server-Timing evidence", async () => {
  await assert.rejects(
    benchmarkPublicRoutes({
      baseUrl: "https://club.example",
      concurrency: 1,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      routes: ["/"],
      sampleCount: 1,
      timeoutMs: 1_000,
      waveCount: 1,
    }),
    /missing valid Server-Timing evidence/u,
  );

  await assert.rejects(
    benchmarkPublicRoutes({
      baseUrl: "https://club.example",
      concurrency: 1,
      fetchImpl: async () =>
        new Response("ok", {
          headers: { "server-timing": "database;dur=12" },
          status: 200,
        }),
      routes: ["/"],
      sampleCount: 1,
      timeoutMs: 1_000,
      waveCount: 1,
    }),
    /missing valid Server-Timing evidence/u,
  );
});

test("public benchmark rejects 4xx routes and warmup-only failures", async () => {
  await assert.rejects(
    benchmarkPublicRoutes({
      baseUrl: "https://club.example",
      concurrency: 1,
      fetchImpl: async () =>
        new Response("missing", {
          headers: { "server-timing": "app;dur=1" },
          status: 404,
        }),
      routes: ["/events/missing"],
      sampleCount: 1,
      timeoutMs: 1_000,
      waveCount: 1,
    }),
    /Public benchmark failed/u,
  );

  let calls = 0;
  await assert.rejects(
    benchmarkPublicRoutes({
      baseUrl: "https://club.example",
      concurrency: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response(calls === 1 ? "failed" : "ok", {
          headers: { "server-timing": "app;dur=1" },
          status: calls === 1 ? 502 : 200,
        });
      },
      routes: ["/"],
      sampleCount: 1,
      timeoutMs: 1_000,
      waveCount: 1,
    }),
    /Public benchmark failed/u,
  );
});

test("public benchmark rejects a visitor-visible editorial fallback at HTTP 200", async () => {
  await assert.rejects(
    benchmarkPublicRoutes({
      baseUrl: "https://club.example",
      concurrency: 1,
      fetchImpl: async () =>
        new Response(
          '<main><h1 id="service-title">About could not be prepared.</h1></main>',
          { headers: { "server-timing": "app;dur=1" }, status: 200 },
        ),
      routes: ["/about"],
      sampleCount: 1,
      timeoutMs: 1_000,
      waveCount: 1,
    }),
    /Public benchmark failed/u,
  );
});
