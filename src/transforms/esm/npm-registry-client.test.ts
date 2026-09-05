import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
  refreshEnvironmentConfig,
} from "../../config/environment-config.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setClockForTest,
  _setDependencyResolutionPosterForTest,
  isDependencyPinningEnabled,
  isExactSemver,
  PLATFORM_RESOLUTION_MAX_CONCURRENCY,
  PLATFORM_RESOLUTION_MAX_PENDING,
  schedulePlatformDependencyResolution,
  scheduleUndeclaredDependencyResolution,
} from "./npm-registry-client.ts";

const MAIN_SCHEDULE = { target: { kind: "main" as const } };

describe("npm-registry-client dependency contracts", () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
  });

  afterEach(async () => {
    await _pendingResolutions();
    _clearNpmVersionCache();
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
  });

  it("reads the dependency-pinning feature flag", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    assertEquals(isDependencyPinningEnabled(), false);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    assertEquals(isDependencyPinningEnabled(), true);
  });

  it("recognizes exact SemVer without normalizing API-preserved bytes", () => {
    assertEquals(isExactSemver("1.2.3"), true);
    assertEquals(isExactSemver("v1.2.3+build.7"), true);
    assertEquals(isExactSemver("1.2.3-alpha-beta.1"), true);
    assertEquals(isExactSemver("1.2.3-RC.0+001"), true);
    assertEquals(isExactSemver("^1.2.3"), false);
    assertEquals(isExactSemver("~1.2"), false);
    assertEquals(isExactSemver(">=1 <2"), false);
    assertEquals(isExactSemver("1.2"), false);
    assertEquals(isExactSemver("01.2.3"), false);
    assertEquals(isExactSemver("1.02.3"), false);
    assertEquals(isExactSemver("1.2.03"), false);
    assertEquals(isExactSemver("1.0.0-01"), false);
    assertEquals(isExactSemver("1.0.0-alpha.01"), false);
  });

  it("deduplicates and forwards a scoped package raw range", async () => {
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.test");
    setEnv("VERYFRONT_API_TOKEN", "test-token");
    refreshEnvironmentConfig();

    let fetchCalls = 0;
    let requestUrl = "";
    let requestBody = "";

    try {
      await withMockFetch((input, init) => {
        fetchCalls++;
        requestUrl = String(input);
        requestBody = String(observeFetchRequestInit(init).body ?? "");
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        schedulePlatformDependencyResolution(
          "project-ref",
          "@scope/pkg",
          "^1.2.3",
          MAIN_SCHEDULE,
        );
        schedulePlatformDependencyResolution(
          "project-ref",
          "@scope/pkg",
          "^1.2.3",
          MAIN_SCHEDULE,
        );
        await _pendingResolutions();
      });

      assertEquals(fetchCalls, 1);
      assertEquals(
        requestUrl,
        "https://api.example.test/projects/project-ref/dependencies/resolve",
      );
      assertEquals(JSON.parse(requestBody), {
        specifiers: ["@scope/pkg@^1.2.3"],
        expected_declarations: { "@scope/pkg": "^1.2.3" },
      });
    } finally {
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }
  });

  it("uses request-scoped authorization when the runtime has no API token", async () => {
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.test");
    setEnv("VERYFRONT_API_TOKEN", "");
    refreshEnvironmentConfig();

    let authorization = "";

    try {
      await withMockFetch((_input, init) => {
        authorization = new Headers(observeFetchRequestInit(init).headers).get("authorization") ??
          "";
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        schedulePlatformDependencyResolution(
          "project-ref",
          "zod",
          "^3",
          {
            target: { kind: "main" },
            authToken: "request-scoped-token",
          },
        );
        await _pendingResolutions();
      });

      assertEquals(authorization, "Bearer request-scoped-token");
    } finally {
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }
  });

  it("authenticates the write-back with a host-private stored login token", async () => {
    // A stored `veryfront login` token is registered host-privately instead of
    // being exported, so the environment snapshot never carries it. The
    // write-back must still authenticate instead of silently skipping.
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.test");
    setEnv("VERYFRONT_API_TOKEN", "");
    refreshEnvironmentConfig();
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let authorization = "";

    try {
      await withMockFetch((_input, init) => {
        authorization = new Headers(observeFetchRequestInit(init).headers).get("authorization") ??
          "";
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        schedulePlatformDependencyResolution(
          "host-token-project",
          "zod",
          "^3",
          MAIN_SCHEDULE,
        );
        await _pendingResolutions();
      });

      assertEquals(authorization, "Bearer stored-login-token");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }
  });

  it("sends the host-private stored token only to a host-owned API origin", async () => {
    // A project-scoped environment can steer the snapshot's `apiBaseUrl`
    // through `VERYFRONT_API_BASE_URL` while authentication comes only from a
    // stored `veryfront login`. The write-back must not pair the developer's
    // host-private credential with that project-chosen destination: with the
    // host token, the endpoint resolves from the host environment or the
    // default API base.
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalApiUrl = getHostEnv("VERYFRONT_API_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "");
    setEnv("VERYFRONT_API_URL", "");
    setEnv("VERYFRONT_API_TOKEN", "");
    refreshEnvironmentConfig();
    _setEnvironmentConfigForTesting({ apiBaseUrl: "https://attacker.example" });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let requestUrl = "";
    let authorization = "";

    try {
      await withMockFetch((input, init) => {
        requestUrl = String(input);
        authorization = new Headers(observeFetchRequestInit(init).headers).get("authorization") ??
          "";
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        for (const authToken of [undefined, "stored-login-token"]) {
          const projectId = authToken ? "origin-bound-scoped" : "origin-bound-project";
          schedulePlatformDependencyResolution(
            projectId,
            "zod",
            "^3",
            { ...MAIN_SCHEDULE, authToken },
          );
          await _pendingResolutions();
          assertEquals(
            requestUrl,
            `https://api.veryfront.com/projects/${projectId}/dependencies/resolve`,
          );
        }
      });

      assertEquals(authorization, "Bearer stored-login-token");
      assertEquals(
        requestUrl,
        "https://api.veryfront.com/projects/origin-bound-scoped/dependencies/resolve",
      );
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
      _resetEnvironmentConfig();
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_URL", originalApiUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }
  });

  it("resolves the host-owned API base without a mutable String.prototype hook", async () => {
    // The host-owned base is derived from `VERYFRONT_API_URL` by rewriting the
    // GraphQL path. Project code served in this process can replace
    // `String.prototype.replace` before the write-back runs; if that hook were
    // reached it would choose the destination the host-private credential is
    // sent to. The derivation must use captured intrinsics instead.
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalApiUrl = getHostEnv("VERYFRONT_API_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "");
    setEnv("VERYFRONT_API_URL", "https://api.host.test/graphql");
    setEnv("VERYFRONT_API_TOKEN", "");
    refreshEnvironmentConfig();
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    const originalReplace = Object.getOwnPropertyDescriptor(String.prototype, "replace")!;
    let hookCalls = 0;
    Object.defineProperty(String.prototype, "replace", {
      configurable: true,
      writable: true,
      value: function (this: unknown): string {
        hookCalls += 1;
        return "https://attacker.example";
      },
    });

    let requestUrl = "";
    let authorization = "";

    try {
      await withMockFetch((input, init) => {
        requestUrl = String(input);
        authorization = new Headers(observeFetchRequestInit(init).headers).get("authorization") ??
          "";
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        schedulePlatformDependencyResolution(
          "intrinsic-base-project",
          "zod",
          "^3",
          MAIN_SCHEDULE,
        );
        await _pendingResolutions();
      });
    } finally {
      Object.defineProperty(String.prototype, "replace", originalReplace);
      deleteHostSecret("VERYFRONT_API_TOKEN");
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_URL", originalApiUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }

    // The credential went to the host-derived origin, and the poisoned hook was
    // never consulted for it.
    assertEquals(authorization, "Bearer stored-login-token");
    assertEquals(
      requestUrl,
      "https://api.host.test/api/projects/intrinsic-base-project/dependencies/resolve",
    );
    assertEquals(hookCalls, 0);
  });

  it("posts branch and caller-observed declarations, including absence", async () => {
    const originalBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL");
    const originalToken = getHostEnv("VERYFRONT_API_TOKEN");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.test");
    setEnv("VERYFRONT_API_TOKEN", "test-token");
    refreshEnvironmentConfig();

    let requestBody = "";

    const branchSchedule = {
      target: { kind: "branch" as const, branch: "feature-a" },
    };
    try {
      await withMockFetch((_input, init) => {
        requestBody = String(observeFetchRequestInit(init).body ?? "");
        return Promise.resolve(new Response("{}", { status: 200 }));
      }, async () => {
        schedulePlatformDependencyResolution(
          "project-ref",
          "zod",
          "next",
          branchSchedule,
        );
        scheduleUndeclaredDependencyResolution(
          "project-ref",
          "lodash",
          branchSchedule,
        );
        await _pendingResolutions();
      });

      assertEquals(JSON.parse(requestBody), {
        specifiers: ["zod@next", "lodash"],
        branch: "feature-a",
        expected_declarations: {
          zod: "next",
          lodash: null,
        },
      });
    } finally {
      setEnv("VERYFRONT_API_BASE_URL", originalBaseUrl ?? "");
      setEnv("VERYFRONT_API_TOKEN", originalToken ?? "");
      refreshEnvironmentConfig();
    }
  });

  it("coalesces ranges and undeclared bare names in one project batch", async () => {
    const requests: Array<{ projectId: string; specifiers: string[] }> = [];
    _setDependencyResolutionPosterForTest((projectId, specifiers) => {
      requests.push({ projectId, specifiers });
      return Promise.resolve();
    });

    schedulePlatformDependencyResolution("project-ref", "zod", "^3", MAIN_SCHEDULE);
    schedulePlatformDependencyResolution(
      "project-ref",
      "date-fns",
      "~4.0.0",
      MAIN_SCHEDULE,
    );
    scheduleUndeclaredDependencyResolution("project-ref", "lodash", MAIN_SCHEDULE);
    await _pendingResolutions();

    assertEquals(requests, [{
      projectId: "project-ref",
      specifiers: ["zod@^3", "date-fns@~4.0.0", "lodash"],
    }]);
  });

  it("keeps only the newest queued declaration for one package", async () => {
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    schedulePlatformDependencyResolution("project-ref", "zod", "^3", MAIN_SCHEDULE);
    schedulePlatformDependencyResolution("project-ref", "zod", "^4", MAIN_SCHEDULE);
    await _pendingResolutions();

    assertEquals(requests, [["zod@^4"]]);
  });

  it("isolates main and branch queues for the same project and package", async () => {
    const requests: Array<{ target: string; specifiers: string[] }> = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers, target) => {
      requests.push({
        target: target.kind === "main" ? "main" : `branch:${target.branch}`,
        specifiers,
      });
      return Promise.resolve();
    });

    schedulePlatformDependencyResolution(
      "project-ref",
      "zod",
      "^4",
      MAIN_SCHEDULE,
    );
    schedulePlatformDependencyResolution(
      "project-ref",
      "zod",
      "^3",
      { target: { kind: "branch", branch: "feature" } },
    );
    await _pendingResolutions();

    assertEquals(requests, [
      { target: "main", specifiers: ["zod@^4"] },
      { target: "branch:feature", specifiers: ["zod@^3"] },
    ]);
  });

  it("does not enqueue a write without an explicit canonical target", async () => {
    let posts = 0;
    _setDependencyResolutionPosterForTest(() => {
      posts++;
      return Promise.resolve();
    });

    schedulePlatformDependencyResolution("project-ref", "zod", "^4");
    schedulePlatformDependencyResolution(
      "project-ref",
      "zod",
      "^4",
      { target: { kind: "branch", branch: "" } },
    );
    schedulePlatformDependencyResolution(
      "project-ref",
      "zod",
      "^4",
      { target: { kind: "branch", branch: " feature" } },
    );
    schedulePlatformDependencyResolution(
      "project-ref",
      "zod",
      "^4",
      { target: { kind: "branch", branch: "feature " } },
    );
    await _pendingResolutions();

    assertEquals(posts, 0);
  });

  it("splits large project batches into bounded requests", async () => {
    const requests: string[][] = [];
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return Promise.resolve();
    });

    for (let i = 0; i < 205; i++) {
      scheduleUndeclaredDependencyResolution(
        "project-ref",
        `package-${i}`,
        MAIN_SCHEDULE,
      );
    }
    await _pendingResolutions();

    assertEquals(requests.map((request) => request.length), [100, 100, 5]);
  });

  it("fails closed when the global pending backlog reaches its bound", async () => {
    let now = 0;
    let postedSpecifiers = 0;
    _setClockForTest(() => now);
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      postedSpecifiers += specifiers.length;
      return Promise.resolve();
    });

    for (let i = 0; i < PLATFORM_RESOLUTION_MAX_PENDING + 17; i++) {
      scheduleUndeclaredDependencyResolution(
        "project-ref",
        `package-${i}`,
        MAIN_SCHEDULE,
      );
    }
    await _pendingResolutions();

    assertEquals(postedSpecifiers, PLATFORM_RESOLUTION_MAX_PENDING);

    now = 60_000;
    scheduleUndeclaredDependencyResolution(
      "project-ref",
      "package-after-ttl",
      MAIN_SCHEDULE,
    );
    await _pendingResolutions();
    assertEquals(postedSpecifiers, PLATFORM_RESOLUTION_MAX_PENDING + 1);
  });

  it("settles rejected platform writes without abandoning the remaining batches", async () => {
    let now = 0;
    const requests: string[][] = [];
    _setClockForTest(() => now);
    _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
      requests.push(specifiers);
      return requests.length === 1
        ? Promise.reject(new Error("platform unavailable"))
        : Promise.resolve();
    });

    // One more than PLATFORM_RESOLUTION_BATCH_SIZE, so the rejected first batch
    // is followed by a second batch that must still be posted.
    for (let i = 0; i < 101; i++) {
      scheduleUndeclaredDependencyResolution(
        "project-ref",
        `package-${i}`,
        MAIN_SCHEDULE,
      );
    }
    await _pendingResolutions();

    assertEquals(requests.length, 2, "a failed batch must not abandon the remaining batches");
    assertEquals(
      requests[1]?.length,
      1,
      "the batch following a failed one carries its single remaining specifier",
    );

    now = 60_000;
    scheduleUndeclaredDependencyResolution(
      "project-ref",
      "package-0",
      MAIN_SCHEDULE,
    );
    await _pendingResolutions();

    assertEquals(
      requests.length,
      3,
      "a failed batch releases its pending-attempt slots instead of leaking them",
    );
    assertEquals(
      requests[2],
      ["package-0"],
      "a specifier from the failed batch can be retried after the dedupe TTL",
    );
  });

  it("allows a retry after the dedupe TTL", async () => {
    let now = 0;
    let attempts = 0;
    _setClockForTest(() => now);
    _setDependencyResolutionPosterForTest(() => {
      attempts++;
      return Promise.resolve();
    });

    scheduleUndeclaredDependencyResolution("project-ref", "zod", MAIN_SCHEDULE);
    await _pendingResolutions();
    scheduleUndeclaredDependencyResolution("project-ref", "zod", MAIN_SCHEDULE);
    await _pendingResolutions();
    assertEquals(attempts, 1);

    now = 60_000;
    scheduleUndeclaredDependencyResolution("project-ref", "zod", MAIN_SCHEDULE);
    await _pendingResolutions();
    assertEquals(attempts, 2);
  });

  it("bounds platform write concurrency across projects without barging", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    _setDependencyResolutionPosterForTest(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
    });

    const total = PLATFORM_RESOLUTION_MAX_CONCURRENCY * 3;
    for (let i = 0; i < total; i++) {
      scheduleUndeclaredDependencyResolution(
        `project-${i}`,
        `package-${i}`,
        MAIN_SCHEDULE,
      );
    }

    while (releases.length < PLATFORM_RESOLUTION_MAX_CONCURRENCY) {
      await Promise.resolve();
    }
    assertEquals(maxActive, PLATFORM_RESOLUTION_MAX_CONCURRENCY);

    // Release every started request, including later waves that begin after a
    // limiter permit is handed off. Checking only `active` can observe the
    // handoff microtask between waves and exit with queued requests unreleased.
    for (let released = 0; released < total; released++) {
      while (releases.length === 0) {
        await Promise.resolve();
      }
      releases.shift()!();
      await Promise.resolve();
    }
    await _pendingResolutions();
    assertEquals(maxActive, PLATFORM_RESOLUTION_MAX_CONCURRENCY);
  });
});
