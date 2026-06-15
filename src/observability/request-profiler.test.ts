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

const ENV_KEYS = ["VERYFRONT_ENABLE_PERF_PROFILING", "VERYFRONT_ENABLE_SERVER_TIMING"] as const;

function clearProfilerEnv(): void {
  for (const key of ENV_KEYS) Deno.env.delete(key);
}

describe("request profiler", () => {
  afterEach(() => {
    clearProfilerEnv();
    resetRequestProfiles();
  });

  it("keeps normal HTML requests unprofiled by default", () => {
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
