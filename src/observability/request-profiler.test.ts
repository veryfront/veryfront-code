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

  it("returns detached records and normalizes explicit phase durations", async () => {
    const returned = await runWithRequestProfiling(
      {
        category: "html",
        method: "GET",
        pathname: "/profiled",
      },
      async () => {
        markRequestProfilePhase("invalid", -5);
        markRequestProfilePhase("invalid", Number.POSITIVE_INFINITY);
        return finalizeRequestProfiling(200);
      },
    );
    assertExists(returned);
    returned.pathname = "/mutated";
    returned.phases.invalid = 99;

    const firstSnapshot = snapshotRequestProfiles();
    assertEquals(firstSnapshot.records[0]?.pathname, "/profiled");
    assertEquals(firstSnapshot.records[0]?.phases.invalid, 0);

    const firstRecord = firstSnapshot.records[0];
    assertExists(firstRecord);
    firstRecord.pathname = "/snapshot-mutated";
    firstRecord.phases.invalid = 100;

    const secondSnapshot = snapshotRequestProfiles();
    assertEquals(secondSnapshot.records[0]?.pathname, "/profiled");
    assertEquals(secondSnapshot.records[0]?.phases.invalid, 0);
  });

  it("saturates accumulated phase durations at a finite safe bound", async () => {
    const record = await runWithRequestProfiling(
      {
        category: "html",
        method: "GET",
        pathname: "/profiled",
      },
      async () => {
        markRequestProfilePhase("overflow", Number.MAX_SAFE_INTEGER);
        markRequestProfilePhase("overflow", Number.MAX_SAFE_INTEGER);
        return finalizeRequestProfiling(200);
      },
    );

    assertExists(record);
    assertEquals(record.phases.overflow, Number.MAX_SAFE_INTEGER);
    assert(Number.isFinite(record.totalMs));
    assert(record.totalMs <= Number.MAX_SAFE_INTEGER);
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
});
