import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing";
import { FakeTime } from "#std/testing/time";
import { NETWORK_ERROR } from "#veryfront/errors";
import {
  type AgentServiceRegistrationLogger,
  createAgentServiceRegistrationLifecycle,
  heartbeatRetrySchedule,
  resolveAgentServiceRegistrationInput,
} from "./registration.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const serviceResponse = {
  service: {
    id: "22222222-2222-4222-a222-222222222222",
    service_name: "docs-agent",
    service_key: "docs-agent:generated",
    scope_kind: "project",
    scope_key: "11111111-1111-4111-a111-111111111111",
    project_id: "11111111-1111-4111-a111-111111111111",
    agent_id: "support",
    base_url: "https://agent.example.com",
    invoke_url: "https://agent.example.com/api/runs",
    status: "active",
    capabilities: null,
    metadata: null,
    version: "0.1.0",
    runtime: "node",
    region: "iad",
    last_heartbeat_at: "2026-05-13T00:00:00.000Z",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
  },
};

function globalAgentServiceConfig(podIdentity: {
  POD_NAME?: string;
  POD_UID?: string;
  POD_IP?: string;
}) {
  return {
    VERYFRONT_API_URL: "https://api.example.com",
    VERYFRONT_API_TOKEN: "token-1",
    VERYFRONT_PROJECT_ID: undefined,
    VERYFRONT_AGENT_SERVICE_URL: "https://veryfront-agent.veryfront-staging.svc.cluster.local",
    VERYFRONT_AGENT_SERVICE_KEY: undefined,
    VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled" as const,
    VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
    VERYFRONT_AGENT_SERVICE_REGION: "iad",
    ...podIdentity,
  };
}

describe("agent/agent-service-registration", () => {
  it("resolves auto registration only when token and public service URL are present", async () => {
    const input = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: "token-1",
        VERYFRONT_PROJECT_ID: "11111111-1111-4111-a111-111111111111",
        VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: "iad",
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: "0.1.0",
      runtime: "node",
    });

    assertEquals(input?.apiUrl, "https://api.example.com");
    assertEquals(input?.authToken, "token-1");
    assertEquals(input?.scopeKind, "project");
    assertEquals(input?.projectId, "11111111-1111-4111-a111-111111111111");
    assertEquals(input?.baseUrl, "https://agent.example.com");
    assertEquals(input?.invokeUrl, "https://agent.example.com/api/runs");
    assertEquals(input?.region, "iad");
    assertEquals(input?.version, "0.1.0");
    assertEquals(input?.runtime, "node");
    assertEquals(input?.serviceKey.startsWith("docs-agent:"), true);
  });

  it("derives distinct default service keys for Kubernetes replicas behind the same service URL", async () => {
    const firstReplica = await resolveAgentServiceRegistrationInput({
      config: globalAgentServiceConfig({
        POD_NAME: "veryfront-agent-7dd7b6f4d8-a1b2c",
        POD_UID: "11111111-1111-4111-a111-111111111111",
        POD_IP: "10.192.4.10",
      }),
      serviceName: "veryfront-agent",
      agentId: "veryfront",
      version: "0.1.0",
      runtime: "node",
    });
    const secondReplica = await resolveAgentServiceRegistrationInput({
      config: globalAgentServiceConfig({
        POD_NAME: "veryfront-agent-7dd7b6f4d8-d4e5f",
        POD_UID: "22222222-2222-4222-a222-222222222222",
        POD_IP: "10.192.4.11",
      }),
      serviceName: "veryfront-agent",
      agentId: "veryfront",
      version: "0.1.0",
      runtime: "node",
    });

    const firstReplicaRestarted = await resolveAgentServiceRegistrationInput({
      config: globalAgentServiceConfig({
        POD_NAME: "veryfront-agent-7dd7b6f4d8-a1b2c",
        POD_UID: "11111111-1111-4111-a111-111111111111",
        POD_IP: "10.192.4.10",
      }),
      serviceName: "veryfront-agent",
      agentId: "veryfront",
      version: "0.1.0",
      runtime: "node",
    });
    const firstReplicaRescheduled = await resolveAgentServiceRegistrationInput({
      config: globalAgentServiceConfig({
        POD_NAME: "veryfront-agent-7dd7b6f4d8-a1b2c",
        POD_UID: "11111111-1111-4111-a111-111111111111",
        POD_IP: "10.192.4.99",
      }),
      serviceName: "veryfront-agent",
      agentId: "veryfront",
      version: "0.1.0",
      runtime: "node",
    });

    assertEquals(firstReplica?.baseUrl, secondReplica?.baseUrl);
    assertEquals(firstReplica?.serviceKey.startsWith("veryfront-agent:"), true);
    assertEquals(secondReplica?.serviceKey.startsWith("veryfront-agent:"), true);
    assertEquals(firstReplica?.serviceKey !== secondReplica?.serviceKey, true);
    assertEquals(
      firstReplicaRestarted?.serviceKey,
      firstReplica?.serviceKey,
      "the same pod must keep its service key across restarts",
    );
    assertEquals(
      firstReplicaRescheduled?.serviceKey,
      firstReplica?.serviceKey,
      "POD_UID takes precedence, so a changed pod IP must not mint a new service key",
    );
  });

  it("skips auto registration when the token or public URL is missing", async () => {
    const withoutToken = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: undefined,
        VERYFRONT_PROJECT_ID: undefined,
        VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: undefined,
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: undefined,
      runtime: "node",
    });
    const withoutUrl = await resolveAgentServiceRegistrationInput({
      config: {
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_API_TOKEN: "token-1",
        VERYFRONT_PROJECT_ID: undefined,
        VERYFRONT_AGENT_SERVICE_URL: undefined,
        VERYFRONT_AGENT_SERVICE_KEY: undefined,
        VERYFRONT_AGENT_SERVICE_REGISTRATION: "auto",
        VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
        VERYFRONT_AGENT_SERVICE_REGION: undefined,
      },
      serviceName: "docs-agent",
      agentId: "support",
      version: undefined,
      runtime: "node",
    });

    assertEquals(withoutToken, null);
    assertEquals(withoutUrl, null);
  });

  it("fails explicit registration when required connection settings are missing", async () => {
    await assertRejects(
      () =>
        resolveAgentServiceRegistrationInput({
          config: {
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_API_TOKEN: undefined,
            VERYFRONT_PROJECT_ID: undefined,
            VERYFRONT_AGENT_SERVICE_URL: undefined,
            VERYFRONT_AGENT_SERVICE_KEY: undefined,
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
            VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
            VERYFRONT_AGENT_SERVICE_REGION: undefined,
          },
          serviceName: "docs-agent",
          agentId: "support",
          version: undefined,
          runtime: "node",
        }),
      Error,
      "VERYFRONT_API_TOKEN is required",
    );

    await assertRejects(
      () =>
        resolveAgentServiceRegistrationInput({
          config: {
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_API_TOKEN: "token-1",
            VERYFRONT_PROJECT_ID: undefined,
            VERYFRONT_AGENT_SERVICE_URL: undefined,
            VERYFRONT_AGENT_SERVICE_KEY: undefined,
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
            VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: 30_000,
            VERYFRONT_AGENT_SERVICE_REGION: undefined,
          },
          serviceName: "docs-agent",
          agentId: "support",
          version: undefined,
          runtime: "node",
        }),
      Error,
      "VERYFRONT_AGENT_SERVICE_URL is required when VERYFRONT_AGENT_SERVICE_REGISTRATION=enabled",
      "explicit registration must fail loudly when the service URL is missing",
    );
  });

  it("registers the push service and heartbeats with bearer auth", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      calls.push({ url: input.toString(), init });
      return Promise.resolve(jsonResponse(serviceResponse));
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      serviceName: "docs-agent",
      serviceKey: "docs-agent:test",
      scopeKind: "project",
      projectId: "11111111-1111-4111-a111-111111111111",
      agentId: "support",
      baseUrl: "https://agent.example.com",
      invokeUrl: "https://agent.example.com/api/runs",
      version: "0.1.0",
      runtime: "node",
      region: "iad",
      heartbeatIntervalMs: 60_000,
      fetch,
    });

    await lifecycle.heartbeat();
    lifecycle.stop();

    assertEquals(calls.length, 2);
    assertEquals(calls[0]?.url, "https://api.example.com/agent-runtimes/push-services");
    assertEquals(
      calls[1]?.url,
      "https://api.example.com/agent-runtimes/push-services/22222222-2222-4222-a222-222222222222/heartbeat",
    );
    assertEquals(
      new Headers(calls[0]?.init?.headers).get("Authorization"),
      "Bearer token-1",
      "registration must carry bearer auth",
    );
    assertEquals(calls[0]?.init?.method, "POST", "registration must be a POST");
    assertEquals(
      new Headers(calls[1]?.init?.headers).get("Authorization"),
      "Bearer token-1",
      "heartbeats must carry bearer auth",
    );
    assertEquals(calls[1]?.init?.method, "POST", "the heartbeat must be a POST");
    assertEquals(JSON.parse(String(calls[0]?.init?.body)), {
      service_name: "docs-agent",
      service_key: "docs-agent:test",
      scope_kind: "project",
      project_id: "11111111-1111-4111-a111-111111111111",
      agent_id: "support",
      base_url: "https://agent.example.com",
      invoke_url: "https://agent.example.com/api/runs",
      version: "0.1.0",
      runtime: "node",
      region: "iad",
    });
  });
});

type LogEntry = { message: string; metadata?: Record<string, unknown> };

function recordingLogger() {
  const warnings: LogEntry[] = [];
  const errors: LogEntry[] = [];
  return {
    warnings,
    errors,
    logger: {
      info: () => {},
      warn: (message: string, metadata?: Record<string, unknown>) =>
        void warnings.push({ message, metadata }),
      error: (message: string, metadata?: Record<string, unknown>) =>
        void errors.push({ message, metadata }),
    },
  };
}

/**
 * Answers registration with 200 and each heartbeat with the next scripted
 * status, repeating the last one once the script runs out.
 */
function scriptedHeartbeatFetch(
  statuses: readonly number[],
  options: {
    heartbeatResponse?: (input: RequestInfo | URL, attempt: number) => Response;
    registrationResponse?: (attempt: number) => Response;
  } = {},
) {
  let heartbeatAttempts = 0;
  let registrationAttempts = 0;
  const fetch: typeof globalThis.fetch = (input) => {
    if (!input.toString().endsWith("/heartbeat")) {
      registrationAttempts++;
      return Promise.resolve(
        options.registrationResponse?.(registrationAttempts) ?? jsonResponse(serviceResponse),
      );
    }
    const heartbeatResponse = options.heartbeatResponse?.(input, heartbeatAttempts + 1);
    const status = statuses[Math.min(heartbeatAttempts, statuses.length - 1)] ?? 200;
    heartbeatAttempts++;
    return Promise.resolve(
      heartbeatResponse ??
        (status === 200 ? jsonResponse(serviceResponse) : jsonResponse({ error: "boom" }, status)),
    );
  };
  return {
    fetch,
    heartbeatAttempts: () => heartbeatAttempts,
    registrationAttempts: () => registrationAttempts,
  };
}

function lifecycleOptions(
  fetch: typeof globalThis.fetch,
  overrides: { heartbeatIntervalMs?: number; logger?: AgentServiceRegistrationLogger } = {},
) {
  return {
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    serviceName: "docs-agent",
    serviceKey: "docs-agent:test",
    scopeKind: "project" as const,
    projectId: "11111111-1111-4111-a111-111111111111",
    agentId: "support",
    baseUrl: "https://agent.example.com",
    invokeUrl: "https://agent.example.com/api/runs",
    version: "0.1.0",
    runtime: "node",
    region: "iad",
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 60_000,
    fetch,
    logger: overrides.logger,
  };
}

function abortAwareDelayedJsonResponse(
  body: unknown,
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(jsonResponse(body));
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

describe("agent/agent-service-registration heartbeat retry", () => {
  it("retries a transient 500 so a one-second blip never counts as a failure", async () => {
    const script = scriptedHeartbeatFetch([500, 200]);
    const log = recordingLogger();
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(script.fetch, { logger: log.logger }),
    );

    // Resolving is what keeps consecutiveFailures at zero: the lifecycle only
    // increments it in the rejection handler of this same call.
    await lifecycle.heartbeat();
    lifecycle.stop();

    assertEquals(
      script.heartbeatAttempts(),
      2,
      "the 500 must be retried once and the retry must be the 200",
    );
    assertEquals(log.errors.length, 0, "a recovered blip must not escalate");
    assertEquals(
      log.warnings.map((entry) => entry.message),
      ["Agent service heartbeat retrying after transient failure"],
      "the only log for a recovered blip is the retry notice",
    );
  });

  it("fails a client error immediately without retrying", async () => {
    for (const status of [400, 401, 404]) {
      const script = scriptedHeartbeatFetch([status]);
      const log = recordingLogger();
      const lifecycle = await createAgentServiceRegistrationLifecycle(
        lifecycleOptions(script.fetch, { logger: log.logger }),
      );

      await assertRejects(() => lifecycle.heartbeat(), Error, `HTTP ${status}`);
      lifecycle.stop();

      assertEquals(
        script.heartbeatAttempts(),
        1,
        `HTTP ${status} must fail on the first attempt, with no retry`,
      );
      assertEquals(log.warnings.length, 0, `HTTP ${status} must not log a retry notice`);
    }
  });

  it("keeps one tick's backoff waits inside the heartbeat interval", () => {
    // Arithmetic only. Backoff is the sole part of a tick this schedule bounds;
    // the no-overlap property is enforced by the in-flight guard and covered by
    // the concurrency test below.
    for (const intervalMs of [40, 1_000, 30_000, 300_000]) {
      const schedule = heartbeatRetrySchedule(intervalMs);
      const totalDelayMs = schedule.delaysMs.reduce((sum, delayMs) => sum + delayMs, 0);

      assert(schedule.maxAttempts >= 2, "a transient failure must get at least one retry");
      assertEquals(
        schedule.delaysMs.length,
        schedule.maxAttempts - 1,
        "every attempt except the last must be followed by a backoff",
      );
      assert(
        totalDelayMs < intervalMs,
        `backoff of ${totalDelayMs}ms must stay inside a ${intervalMs}ms interval`,
      );
      assert(
        totalDelayMs > 0,
        `backoff for a ${intervalMs}ms interval must not collapse to zero`,
      );
    }

    assertEquals(
      heartbeatRetrySchedule(30_000).delaysMs,
      [250, 500],
      "a full-size interval gets the documented doubling backoff from the 250ms base",
    );
  });

  it("never runs two heartbeat ticks at once, even when attempts outlast the interval", async () => {
    // A tick here needs 3 attempts x 120ms plus backoff, so it always outlives
    // the 200ms interval. Without a guard the next tick starts on top of it.
    const intervalMs = 200;
    const attemptLatencyMs = 120;
    let inFlight = 0;
    let maxConcurrent = 0;
    let heartbeatRequests = 0;

    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      return new Promise((resolve) => {
        // Raw timer on purpose: this is the double's simulated latency, and it
        // has to stay on the same unscaled clock as the lifecycle's setInterval.
        setTimeout(() => {
          inFlight--;
          resolve(jsonResponse({ error: "boom" }, 500));
        }, attemptLatencyMs);
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs }),
    );

    // Enough requests that several interval ticks have had to make a decision.
    await waitFor(() => heartbeatRequests >= 6, {
      timeout: 10_000,
      interval: 10,
      message: "the heartbeat never issued enough requests to observe overlap",
    });
    lifecycle.stop();
    await waitFor(() => inFlight === 0, {
      timeout: 10_000,
      interval: 10,
      message: "in-flight heartbeat requests never settled after stop()",
    });

    assertEquals(
      maxConcurrent,
      1,
      `a tick must never start while one is still running (saw ${maxConcurrent} concurrent ` +
        `across ${heartbeatRequests} requests)`,
    );
  });

  it("shares a scheduled in-flight heartbeat with direct callers", async () => {
    using time = new FakeTime();
    const intervalMs = 100;
    let heartbeatRequests = 0;
    const activeSignals = new Set<AbortSignal>();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      assert(signal, "heartbeat requests must carry an abort signal");
      activeSignals.add(signal);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          activeSignals.delete(signal);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs }),
    );

    await time.tickAsync(intervalMs);
    assertEquals(heartbeatRequests, 1, "the scheduled heartbeat must be in flight");

    const firstDirectCaller = lifecycle.heartbeat();
    const secondDirectCaller = lifecycle.heartbeat();
    assertStrictEquals(
      firstDirectCaller,
      secondDirectCaller,
      "overlapping direct callers must receive the shared in-flight promise",
    );
    await time.tickAsync(0);
    assertEquals(
      heartbeatRequests,
      1,
      "direct callers must await the scheduled heartbeat instead of starting another request",
    );
    assertEquals(activeSignals.size, 1, "only one heartbeat request may be active");

    lifecycle.stop();
    await time.tickAsync(0);
    await Promise.all([firstDirectCaller, secondDirectCaller]);
    assertEquals(activeSignals.size, 0, "stop() must abort the shared heartbeat request");
  });

  it("still escalates when slow failures force ticks to be skipped", async () => {
    // Each tick needs 3 attempts x 80ms, so it outlives the 100ms interval and
    // the beats in between are skipped. A skipped beat is neither a success nor
    // a failure: if it reset the counter, escalation could never be reached.
    const intervalMs = 100;
    const attemptLatencyMs = 80;
    let inFlight = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      inFlight++;
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight--;
          resolve(jsonResponse({ error: "boom" }, 500));
        }, attemptLatencyMs);
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    await waitFor(() => log.errors.length > 0, {
      timeout: 10_000,
      interval: 10,
      message: "skipped beats stopped the failure counter from ever escalating",
    });
    lifecycle.stop();
    await waitFor(() => inFlight === 0, {
      timeout: 10_000,
      interval: 10,
      message: "in-flight heartbeat requests never settled after stop()",
    });

    const skips = log.warnings.filter((entry) =>
      entry.message === "Agent service heartbeat tick skipped, previous tick still running"
    );
    assert(
      skips.length > 0,
      "this test is only meaningful if beats were actually skipped; none were",
    );
    assertEquals(
      log.errors[0]?.metadata?.consecutiveFailures,
      3,
      "a skipped beat must not reset or advance the counter, so 3 failed ticks still escalate",
    );
  });

  it("times out a permanently hung heartbeat and escalates with fake time", async () => {
    using time = new FakeTime();
    const intervalMs = 20;
    let heartbeatRequests = 0;
    const activeSignals = new Set<AbortSignal>();
    let maxConcurrent = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      assert(signal, "heartbeat requests must carry an abort signal");
      activeSignals.add(signal);
      maxConcurrent = Math.max(maxConcurrent, activeSignals.size);
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          activeSignals.delete(signal);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    await time.tickAsync(intervalMs);
    for (let step = 0; step < 20 && log.errors.length === 0; step++) {
      await time.tickAsync(5_010);
      await time.tickAsync(0);
    }
    assertEquals(heartbeatRequests, 9, "three failed ticks must exhaust three attempts each");
    assertEquals(
      log.errors[0]?.metadata?.consecutiveFailures,
      3,
      "a timeout must count as one failed tick after its retries are exhausted",
    );
    assertEquals(maxConcurrent, 1, "timeouts must preserve the in-flight guard");

    await time.tickAsync(intervalMs);
    assertEquals(activeSignals.size, 1, "the next heartbeat must be in flight before teardown");
    lifecycle.stop();
    await time.tickAsync(0);
    assertEquals(activeSignals.size, 0, "stop() must abort the hung heartbeat request");
  });

  it("floors a short heartbeat attempt timeout at five seconds", async () => {
    using time = new FakeTime();
    let aborts = 0;
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      assert(signal, "heartbeat requests must carry an abort signal");
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborts++;
          reject(signal.reason);
        }, { once: true });
      });
    };
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: 100 }),
    );
    const pending = lifecycle.heartbeat().catch(() => undefined);
    await time.tickAsync(0);

    await time.tickAsync(4_999);
    assertEquals(aborts, 0, "a short interval must not abort before the five-second floor");
    await time.tickAsync(1);
    assertEquals(aborts, 1, "the first attempt must abort at the five-second floor");

    lifecycle.stop();
    await time.tickAsync(0);
    await pending;
  });

  it("keeps a configured heartbeat attempt timeout above five seconds", async () => {
    using time = new FakeTime();
    let aborts = 0;
    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      assert(signal, "heartbeat requests must carry an abort signal");
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborts++;
          reject(signal.reason);
        }, { once: true });
      });
    };
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: 30_000 }),
    );
    const pending = lifecycle.heartbeat().catch(() => undefined);
    await time.tickAsync(0);

    await time.tickAsync(29_999);
    assertEquals(aborts, 0, "a higher configured interval must remain the attempt timeout");
    await time.tickAsync(1);
    assertEquals(aborts, 1, "the first attempt must abort at the configured higher interval");

    lifecycle.stop();
    await time.tickAsync(0);
    await pending;
  });

  it("lets a known-valid slow heartbeat finish with a short configured interval", async () => {
    // The control plane has been seen answering in about 2.7s while degraded.
    // A short heartbeat interval must not turn that known-valid latency into a
    // persistent-failure escalation.
    const intervalMs = 100;
    const slowLatencyMs = 3_000;
    let completedHeartbeats = 0;
    let inFlight = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      inFlight++;
      return abortAwareDelayedJsonResponse(serviceResponse, slowLatencyMs, signal).then(
        (response) => {
          completedHeartbeats++;
          inFlight--;
          return response;
        },
        (error) => {
          inFlight--;
          throw error;
        },
      );
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    try {
      await waitFor(() => completedHeartbeats > 0 || log.errors.length > 0, {
        timeout: 10_000,
        interval: 10,
        message: "the slow heartbeat neither completed nor escalated",
      });
      assertEquals(completedHeartbeats, 1, "a known-valid slow heartbeat must complete");
      assertEquals(
        log.warnings.filter((entry) =>
          entry.message === "Agent service heartbeat tick skipped, previous tick still running"
        ).length,
        1,
        "one slow successful heartbeat must log at most one skip warning",
      );
      assertEquals(
        log.warnings.filter((entry) => entry.message.includes("retrying")).length,
        0,
        "a slow success must not be retried",
      );
      assertEquals(log.errors.length, 0, "a slow success must not escalate");
    } finally {
      lifecycle.stop();
      await waitFor(() => inFlight === 0, {
        timeout: 1_000,
        interval: 10,
        message: "stop() did not abort the slow heartbeat request",
      });
    }
  });

  it("lets a slow-but-successful heartbeat finish at the production interval", async () => {
    // A heartbeat has been seen answering in about 2.7s while the control plane
    // was degraded. That is slow, not dead, and the deadline must not convert it
    // into a failure. The test above guards the same property against a deadline
    // set as a fraction of the interval; this one guards it against a deadline
    // pinned to a fixed number of milliseconds, which a short test interval
    // would never catch. Pinning the production interval is the point: 30s is
    // the default in src/agent/service/config.ts.
    const intervalMs = 30_000;
    const slowLatencyMs = 3_000;
    let heartbeatRequests = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      const requestInit: RequestInit | undefined = init;
      const signal = requestInit?.signal;
      return abortAwareDelayedJsonResponse(serviceResponse, slowLatencyMs, signal);
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    // Driven directly rather than through the interval: this is about the
    // deadline on one attempt, not about scheduling. Nothing here asserts on
    // escalation, because escalation is counted in the interval tick and a 30s
    // interval never fires inside this test. The short-interval test above
    // covers that.
    await lifecycle.heartbeat();
    lifecycle.stop();

    assertEquals(
      heartbeatRequests,
      1,
      "a slow success must be answered on the first attempt, with no retry",
    );
    assertEquals(log.warnings.length, 0, "a slow success must not log a retry notice");
  });

  it("retries a heartbeat whose response body read fails after the headers arrive", async () => {
    // A body read can fail after the headers land: the deadline fires while
    // the JSON is still arriving, or the connection resets mid-body. That
    // error surfaces from the read rather than from the fetch call, so it used
    // to escape the transport-error wrapper and be classified as permanent.
    // It is as transient as a failed connect and gets the same retries.
    let heartbeatRequests = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      const response = jsonResponse(serviceResponse);
      // Headers delivered, body read fails. A raw DOMException on purpose:
      // that is what an aborted or reset body read throws, and being a
      // non-Veryfront error is exactly what used to make it look permanent.
      response.json = () =>
        Promise.reject(new DOMException("The signal has been aborted", "AbortError"));
      return Promise.resolve(response);
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { logger: log.logger }),
    );

    await assertRejects(() => lifecycle.heartbeat(), Error);
    lifecycle.stop();

    assertEquals(
      heartbeatRequests,
      3,
      "a failed body read must use the full three-attempt retry policy",
    );
    assertEquals(
      log.warnings.map((entry) => entry.message),
      [
        "Agent service heartbeat retrying after transient failure",
        "Agent service heartbeat retrying after transient failure",
      ],
      "each retry of a failed body read must log its retry notice",
    );
  });

  it("fails a heartbeat whose body does not match the schema, without retrying", async () => {
    // A body that arrived intact but does not parse is a permanent protocol
    // mismatch. Retrying it spends all three attempts of every tick on a
    // response that will never parse, and buys nothing: escalation still waits
    // for three failed ticks either way. This is the counterpart to the test
    // above, which pins that a body read that *fails* is retried. The two
    // together are what keep the transport wrapper off the schema parse.
    let heartbeatRequests = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      // HTTP 200, valid JSON, wrong shape.
      return Promise.resolve(jsonResponse({ nope: true } as never));
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { logger: log.logger }),
    );

    await assertRejects(() => lifecycle.heartbeat(), Error);
    lifecycle.stop();

    assertEquals(
      heartbeatRequests,
      1,
      "a body that fails the schema must fail on the first attempt, with no retry",
    );
    assertEquals(
      log.warnings.length,
      0,
      `a permanent schema mismatch must not log a retry notice, saw ` +
        `${log.warnings.map((entry) => entry.message).join(", ")}`,
    );
  });

  it("keeps a fetch rejection that already carries an HTTP status out of the retry loop", async () => {
    // `fetch` is a public option, so a caller can supply a transport that
    // rejects with an error of ours that is already classified. Its httpStatus
    // is what keeps a 4xx from being retried, and rewrapping the rejection as a
    // bare transport failure would throw that status away and retry it.
    let heartbeatRequests = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      return Promise.reject(
        NETWORK_ERROR.create({
          detail: "upstream rejected the heartbeat",
          context: { httpStatus: 404 },
        }),
      );
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { logger: log.logger }),
    );

    const error = await assertRejects(() => lifecycle.heartbeat(), Error);
    lifecycle.stop();

    assertEquals(
      (error as { context?: { httpStatus?: unknown } }).context?.httpStatus,
      404,
      "the classification the caller's fetch supplied must survive",
    );
    assertEquals(
      heartbeatRequests,
      1,
      "a rejection that already carries a 4xx must not be retried",
    );
    assertEquals(
      log.warnings.length,
      0,
      `a classified client error must not log a retry notice, saw ` +
        `${log.warnings.map((entry) => entry.message).join(", ")}`,
    );
  });

  it("cancels a pending retry backoff when the lifecycle stops", async () => {
    let heartbeatAttempts = 0;
    const fetch: typeof globalThis.fetch = (input) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatAttempts++;
      return Promise.resolve(jsonResponse({ error: "boom" }, 500));
    };

    // Resolves the instant the retry logs its backoff, which happens on the
    // microtask right before the timer starts — so stop() always lands inside
    // the wait rather than racing it.
    let enterBackoff!: () => void;
    const enteredBackoff = new Promise<void>((resolve) => {
      enterBackoff = resolve;
    });
    const logger: AgentServiceRegistrationLogger = {
      info: () => {},
      warn: (message) => {
        if (message.includes("retrying")) enterBackoff();
      },
      error: () => {},
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: 60_000, logger }),
    );

    const inFlight = lifecycle.heartbeat();
    await enteredBackoff;
    lifecycle.stop();
    await inFlight;

    assertEquals(
      heartbeatAttempts,
      1,
      "stop() must cancel the pending backoff, not let it wake and retry after teardown",
    );
  });

  it("still escalates persistent 500s, in bounded time", async () => {
    const script = scriptedHeartbeatFetch([500]);
    const log = recordingLogger();
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(script.fetch, { heartbeatIntervalMs: 40, logger: log.logger }),
    );

    // Three ticks of 40ms plus their backoff. A retry sequence that failed to
    // terminate would hold the escalation off past this budget.
    const escalationBudgetMs = 1_000;
    const startedAt = Date.now();
    await waitFor(() => log.errors.length > 0, {
      timeout: escalationBudgetMs,
      interval: 10,
      message: "persistent 500s never reached the persistent-failure log",
    });
    const elapsedMs = Date.now() - startedAt;
    lifecycle.stop();

    assert(
      elapsedMs < escalationBudgetMs,
      `escalation took ${elapsedMs}ms, over the ${escalationBudgetMs}ms budget`,
    );
    assertEquals(
      log.errors[0]?.message,
      "Agent service heartbeat failing persistently",
      "the persistent-failure log must still be the escalation signal",
    );
    assertEquals(
      log.errors[0]?.metadata?.consecutiveFailures,
      3,
      "escalation must still trip on the third consecutive failed tick",
    );
  });
});

describe("agent/agent-service-registration heartbeat recovery", () => {
  // Sentry VERYFRONT-AGENT-E (issue-inbox#873): the control plane forgets a
  // registered service (row deleted, environment reset, registry wiped by a
  // redeploy) and answers every heartbeat for the stale id with HTTP 404. A
  // 404 is a non-retryable client error, so three ticks later the lifecycle
  // logs "Agent service heartbeat failing persistently" and then repeats that
  // forever: nothing ever registers the service again, and the control plane
  // considers it dead while it keeps running.
  it("re-registers a service the control plane no longer knows instead of failing persistently", async () => {
    let recoveredHeartbeats = 0;
    const recoveredServiceId = "33333333-3333-4333-a333-333333333333";
    const script = scriptedHeartbeatFetch([404], {
      heartbeatResponse: (input) => {
        if (!input.toString().includes(recoveredServiceId)) {
          return jsonResponse({ error: "Agent push runtime service not found" }, 404);
        }
        recoveredHeartbeats++;
        return jsonResponse(serviceResponse);
      },
      registrationResponse: (attempt) =>
        jsonResponse(
          attempt === 1 ? serviceResponse : {
            service: { ...serviceResponse.service, id: recoveredServiceId },
          },
        ),
    });
    const log = recordingLogger();
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(script.fetch, { heartbeatIntervalMs: 40, logger: log.logger }),
    );

    try {
      // Recovery and escalation race here: wait until the lifecycle either
      // heartbeats successfully again or emits the persistent-failure error.
      await waitFor(() => recoveredHeartbeats > 0 || log.errors.length > 0, {
        timeout: 2_000,
        interval: 10,
        message: "the lifecycle neither recovered nor escalated after heartbeat 404s",
      });
    } finally {
      lifecycle.stop();
    }

    assertEquals(
      log.errors.map((entry) => entry.message),
      [],
      "a lost registration must trigger re-registration, not the persistent-failure escalation",
    );
    assert(
      script.registrationAttempts() >= 2,
      "a heartbeat 404 must make the lifecycle register the service again",
    );
    assert(
      recoveredHeartbeats > 0,
      "heartbeats must succeed again once the service is re-registered",
    );
  });

  it("escalates when the control plane repeatedly loses successful re-registrations", async () => {
    const script = scriptedHeartbeatFetch([404]);
    const log = recordingLogger();
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(script.fetch, { heartbeatIntervalMs: 40, logger: log.logger }),
    );

    try {
      await waitFor(() => log.errors.length > 0, {
        timeout: 2_000,
        interval: 10,
        message: "repeatedly lost re-registrations never reached the persistent-failure log",
      });
    } finally {
      lifecycle.stop();
    }

    assert(
      script.registrationAttempts() >= 4,
      "each lost registration must still attempt recovery before escalation",
    );
    assertEquals(
      log.errors[0]?.metadata?.consecutiveFailures,
      3,
      "repeatedly lost registrations must escalate on the third failed tick",
    );
  });

  it("counts failed re-registration attempts toward persistent-failure escalation", async () => {
    const script = scriptedHeartbeatFetch([404], {
      registrationResponse: (attempt) =>
        attempt === 1
          ? jsonResponse(serviceResponse)
          : jsonResponse({ error: "registration unavailable" }, 500),
    });
    const log = recordingLogger();
    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(script.fetch, { heartbeatIntervalMs: 40, logger: log.logger }),
    );

    try {
      await waitFor(() => log.errors.length > 0, {
        timeout: 2_000,
        interval: 10,
        message: "failed re-registration never reached the persistent-failure log",
      });
    } finally {
      lifecycle.stop();
    }

    assertEquals(
      log.warnings.filter((entry) => entry.message === "Agent service re-registration failed")
        .length,
      3,
      "each failed re-registration must be reported before escalation",
    );
    assertEquals(
      log.errors[0]?.metadata?.consecutiveFailures,
      3,
      "failed re-registration must escalate on the third failed tick",
    );
  });
});
