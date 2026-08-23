import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_ROUTES = Object.freeze([
  "/",
  "/events",
  "/clubs",
  "/about",
  "/contact",
]);
const DEFAULT_SAMPLES = 20;
const DEFAULT_WAVES = 3;
const DEFAULT_CONCURRENCY = 20;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function benchmarkPublicRoutes(options) {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const routes = parseRoutes(options.routes ?? DEFAULT_ROUTES);
  const sampleCount = positiveInteger(
    options.sampleCount ?? DEFAULT_SAMPLES,
    "sampleCount",
  );
  const waveCount = positiveInteger(
    options.waveCount ?? DEFAULT_WAVES,
    "waveCount",
  );
  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    "concurrency",
  );
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
    60_000,
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const route of routes) {
    await timedGet(fetchImpl, new URL(route, baseUrl), timeoutMs);
  }

  const sequential = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const route = routes[index % routes.length];
    sequential.push(
      await timedGet(fetchImpl, new URL(route, baseUrl), timeoutMs),
    );
  }

  const waves = [];
  for (let wave = 0; wave < waveCount; wave += 1) {
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => {
        const route = routes[(wave * concurrency + index) % routes.length];
        return timedGet(fetchImpl, new URL(route, baseUrl), timeoutMs);
      }),
    );
    waves.push(summarizeResults(results));
  }

  const summary = Object.freeze({
    baseUrl: baseUrl.origin,
    concurrency,
    generatedAt: new Date().toISOString(),
    routes,
    samples: summarizeResults(sequential),
    waves,
  });
  assertAcceptance(summary);
  return summary;
}

export function summarizeResults(results) {
  const durations = results
    .filter((result) => result.ok)
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);
  return Object.freeze({
    cancelled: results.filter((result) => result.kind === "cancelled").length,
    count: results.length,
    failed: results.filter((result) => !result.ok).length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    serverErrors: results.filter(
      (result) => result.kind === "response" && result.status >= 500,
    ).length,
    serviceStates: results.filter(
      (result) => result.kind === "service_state",
    ).length,
    timedOut: results.filter((result) => result.kind === "timeout").length,
  });
}

function assertAcceptance(summary) {
  const all = [summary.samples, ...summary.waves];
  if (all.some((result) => result.failed > 0)) {
    throw new Error(
      `Public benchmark failed: ${JSON.stringify(summary, null, 2)}`,
    );
  }
  if (summary.samples.p95Ms >= 2_000 || summary.samples.p99Ms >= 3_000) {
    throw new Error(
      `Warm latency exceeded the release budget: ${JSON.stringify(summary.samples)}`,
    );
  }
}

async function timedGet(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "vcc-public-route-benchmark/1.0",
      },
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    const serviceState = response.status < 500 && isUnavailablePage(body);
    return Object.freeze({
      durationMs: performance.now() - startedAt,
      kind: serviceState ? "service_state" : "response",
      ok: response.status < 500 && !serviceState,
      status: response.status,
      url: url.pathname,
    });
  } catch {
    const timedOut = controller.signal.aborted;
    return Object.freeze({
      durationMs: performance.now() - startedAt,
      kind: timedOut ? "timeout" : "cancelled",
      ok: false,
      status: 0,
      url: url.pathname,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isUnavailablePage(body) {
  return (
    body.includes("could not be prepared.") ||
    body.includes("The public site is not available yet.")
  );
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return Number(sorted[index].toFixed(3));
}

function parseBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Pass --base-url with an HTTPS or localhost origin.");
  }
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The benchmark origin must use HTTPS or localhost HTTP.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function parseRoutes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one public route is required.");
  }
  return Object.freeze(
    values.map((value) => {
      if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
        throw new Error("Benchmark routes must be root-relative paths.");
      }
      const url = new URL(value, "https://benchmark.invalid");
      if (url.origin !== "https://benchmark.invalid") {
        throw new Error("Benchmark routes must stay on the configured origin.");
      }
      return `${url.pathname}${url.search}`;
    }),
  );
}

function positiveInteger(value, field, maximum = 1_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {};
  const routes = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === "--base-url") options.baseUrl = value;
    else if (token === "--samples") options.sampleCount = Number(value);
    else if (token === "--waves") options.waveCount = Number(value);
    else if (token === "--concurrency") options.concurrency = Number(value);
    else if (token === "--timeout-ms") options.timeoutMs = Number(value);
    else if (token === "--route") routes.push(value);
    else throw new Error(`Unknown benchmark option: ${token}`);
    index += 1;
  }
  if (routes.length > 0) options.routes = routes;
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  benchmarkPublicRoutes(parseArguments(process.argv.slice(2)))
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
