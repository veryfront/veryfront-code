import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildServerTimingHeader,
  finalizeRequestProfiling,
  isRequestProfilingEnabled,
  markRequestProfilePhase,
  profilePhase,
  resetRequestProfiles,
  runWithRequestProfiling,
  snapshotRequestProfiles,
  updateRequestProfileContext,
  withServerTimingHeader,
} from "./request-profiler.ts";

const ENV_KEYS = [
  "VERYFRONT_ENABLE_PERF_PROFILING",
  "VERYFRONT_ENABLE_SERVER_TIMING",
  "VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING",
] as const;

function clearProfilerEnv(): void {
  for (const key of ENV_KEYS) Deno.env.delete(key);
}

describe("request profiler", () => {
  afterEach(() => {
    clearProfilerEnv();
    resetRequestProfiles();
  });

  it("profiles normal HTML requests by default for slow-completion diagnostics", () => {
    assertEquals(isRequestProfilingEnabled("/"), true);
    assertEquals(snapshotRequestProfiles().enabled, true);
  });

  it("can disable default slow-completion profiling", () => {
    Deno.env.set("VERYFRONT_DISABLE_SLOW_REQUEST_PROFILING", "1");

    assertEquals(isRequestProfilingEnabled("/"), false);
    assertEquals(snapshotRequestProfiles().enabled, false);
  });

  it("profiles HTML requests when Server-Timing diagnostics are enabled", async () => {
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");

    assertEquals(isRequestProfilingEnabled("/"), true);

    const result = await runWithRequestProfiling(
      {
        category: "html",
        method: "GET",
        pathname: "/",
      },
      async () => {
        updateRequestProfileContext({ projectSlug: "site", requestMode: "production" });
        await profilePhase("runtime.resolve_project", () => Promise.resolve());
        markRequestProfilePhase("render.cache_hit");
        return finalizeRequestProfiling(200);
      },
    );

    assertExists(result);
    assertEquals(result.projectSlug, "site");
    assertEquals(result.requestMode, "production");
    assertEquals(result.status, 200);
    assert("runtime.resolve_project" in result.phases);
    assertEquals(result.phases["render.cache_hit"], 0);
  });

  it("profiles page-data requests when Server-Timing diagnostics are enabled", () => {
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");

    assertEquals(isRequestProfilingEnabled("/_veryfront/page-data/blog.json"), true);
  });

  it("formats a Server-Timing header from total and phase durations", () => {
    const header = buildServerTimingHeader({
      sequence: 1,
      category: "html",
      method: "GET",
      pathname: "/",
      status: 200,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.010Z",
      totalMs: 12.345,
      phases: {
        "runtime.resolve project": 3.456,
        "handler.execute": 8,
      },
    });

    assertEquals(
      header,
      "total;dur=12.35, runtime.resolve_project;dur=3.46, handler.execute;dur=8.00",
    );
  });

  it("adds Server-Timing only when the diagnostic flag is enabled", () => {
    const record = {
      sequence: 1,
      category: "html",
      method: "GET",
      pathname: "/",
      status: 200,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.010Z",
      totalMs: 10,
      phases: {},
    };

    const withoutFlag = withServerTimingHeader(new Response("ok"), record);
    assertEquals(withoutFlag.headers.get("Server-Timing"), null);

    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    const withFlag = withServerTimingHeader(new Response("ok"), record);
    assertEquals(withFlag.headers.get("Server-Timing"), "total;dur=10.00");
  });

  it("bounds phase cardinality and invalid durations", async () => {
    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        for (let index = 0; index < 100; index++) {
          markRequestProfilePhase(`phase.${index}.${"x".repeat(100)}`, Number.NaN);
        }
        return finalizeRequestProfiling(200);
      },
    );

    assertExists(record);
    assertEquals(Object.keys(record.phases).length, 50);
    assertEquals(Object.keys(record.phases).every((name) => name.length <= 64), true);
    assertEquals(Object.values(record.phases).every((duration) => duration === 0), true);
  });

  it("does not expose mutable profile records", async () => {
    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/original" },
      async () => {
        markRequestProfilePhase("render", 1);
        return finalizeRequestProfiling(200);
      },
    );
    assertExists(record);
    record.pathname = "/changed";
    record.phases.render = 999;

    const snapshot = snapshotRequestProfiles();
    assertEquals(snapshot.records[0]?.pathname, "/original");
    assertEquals(snapshot.records[0]?.phases.render, 1);

    const first = snapshot.records[0];
    assertExists(first);
    first.phases.render = 500;
    assertEquals(snapshotRequestProfiles().records[0]?.phases.render, 1);
  });

  it("normalizes untrusted profile metadata", async () => {
    const record = await runWithRequestProfiling(
      {
        category: `html\n${"x".repeat(100)}`,
        method: "CUSTOM-METHOD",
        pathname: `/page?token=secret-value#fragment`,
        projectSlug: `project\n${"x".repeat(200)}`,
      },
      async () => finalizeRequestProfiling(999),
    );

    assertExists(record);
    assertEquals(record.category.includes("\n"), false);
    assertEquals(record.category.length <= 64, true);
    assertEquals(record.method, "OTHER");
    assertEquals(record.pathname, "/page");
    assertEquals(record.projectSlug?.includes("\n"), false);
    assertEquals(record.status, undefined);
  });

  it("finalizes each request profile at most once", async () => {
    const results = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => [finalizeRequestProfiling(200), finalizeRequestProfiling(500)],
    );

    assertExists(results[0]);
    assertEquals(results[1], null);
    assertEquals(snapshotRequestProfiles().records.length, 1);
  });

  it("formats only finite non-negative Server-Timing durations", () => {
    const header = buildServerTimingHeader({
      sequence: 1,
      category: "html",
      method: "GET",
      pathname: "/",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.010Z",
      totalMs: Number.POSITIVE_INFINITY,
      phases: { invalid: Number.NaN, negative: -5 },
    });

    assertEquals(header, "total;dur=0.00, invalid;dur=0.00, negative;dur=0.00");
  });
});
