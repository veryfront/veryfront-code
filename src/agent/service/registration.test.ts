import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing";
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

    assertEquals(firstReplica?.baseUrl, secondReplica?.baseUrl);
    assertEquals(firstReplica?.serviceKey.startsWith("veryfront-agent:"), true);
    assertEquals(secondReplica?.serviceKey.startsWith("veryfront-agent:"), true);
    assertEquals(firstReplica?.serviceKey !== secondReplica?.serviceKey, true);
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
    assertEquals(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer token-1");
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
function scriptedHeartbeatFetch(statuses: readonly number[]) {
  let heartbeatAttempts = 0;
  const fetch: typeof globalThis.fetch = (input) => {
    if (!input.toString().endsWith("/heartbeat")) {
      return Promise.resolve(jsonResponse(serviceResponse));
    }
    const status = statuses[Math.min(heartbeatAttempts, statuses.length - 1)] ?? 200;
    heartbeatAttempts++;
    return Promise.resolve(
      status === 200 ? jsonResponse(serviceResponse) : jsonResponse({ error: "boom" }, status),
    );
  };
  return { fetch, heartbeatAttempts: () => heartbeatAttempts };
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
    }
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

  it("times out a permanently hung heartbeat and escalates in bounded time", async () => {
    const intervalMs = 20;
    let heartbeatRequests = 0;
    let inFlight = 0;
    let maxConcurrent = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          inFlight--;
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    const escalationBudgetMs = 1_500;
    const startedAt = Date.now();
    try {
      await waitFor(() => log.errors.length > 0, {
        timeout: escalationBudgetMs,
        interval: 10,
        message: "hung heartbeat attempts never reached persistent-failure escalation",
      });
      assert(
        Date.now() - startedAt < escalationBudgetMs,
        "hung heartbeat escalation exceeded its bounded test budget",
      );
      assertEquals(
        log.errors[0]?.metadata?.consecutiveFailures,
        3,
        "a timeout must count as one failed tick after its retries are exhausted",
      );
      assert(
        heartbeatRequests >= 9,
        "three failed ticks must each exhaust the three-attempt retry policy",
      );
      assertEquals(maxConcurrent, 1, "timeouts must preserve the in-flight guard");
    } finally {
      lifecycle.stop();
      await waitFor(() => inFlight === 0, {
        timeout: 1_000,
        interval: 10,
        message: "stop() did not abort the hung heartbeat request",
      });
    }
  });

  it("leaves healthy and intermittently slow heartbeats alone", async () => {
    // The deadline is one interval, so a heartbeat that answers inside its own
    // interval must never be cut off. This is the false-positive guard: an
    // eager timeout would escalate a merely slow control plane.
    // The slow answer sits at 40% of the deadline, far enough inside it that a
    // loaded runner cannot push it over, and far enough outside a quarter of
    // the interval that an over-eager deadline would still be caught.
    const intervalMs = 500;
    const slowLatencyMs = 200;
    let heartbeatRequests = 0;
    let inFlight = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      // Alternate a fast answer with one that eats most of the interval.
      const latencyMs = heartbeatRequests % 2 === 0 ? slowLatencyMs : 5;
      const signal = init?.signal;
      inFlight++;
      return new Promise<Response>((resolve, reject) => {
        // Honour the abort the way a real fetch does, so a deadline that fires
        // early actually shows up here instead of being answered late anyway.
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          inFlight--;
          resolve(jsonResponse(serviceResponse));
        }, latencyMs);
        function onAbort() {
          clearTimeout(timer);
          inFlight--;
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        }
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    await waitFor(() => heartbeatRequests >= 4, {
      timeout: 10_000,
      interval: 10,
      message: "the heartbeat never issued enough requests to observe the deadline",
    });
    lifecycle.stop();
    await waitFor(() => inFlight === 0, {
      timeout: 10_000,
      interval: 10,
      message: "in-flight heartbeat requests never settled after stop()",
    });

    assertEquals(
      log.errors.length,
      0,
      "a heartbeat answering inside its interval must never escalate",
    );
    assertEquals(
      log.warnings.length,
      0,
      `a heartbeat answering inside its interval must not retry or skip, saw ` +
        `${log.warnings.map((entry) => entry.message).join(", ")}`,
    );
  });

  it("lets a slow-but-successful heartbeat finish at the production interval", async () => {
    // A heartbeat has been seen answering in about 2.7s while the control plane
    // was degraded. That is slow, not dead, and the deadline must not convert it
    // into a failure. The test above guards the same property against a deadline
    // set as a fraction of the interval; this one guards it against a deadline
    // pinned to a fixed number of milliseconds, which a short test interval
    // would never catch. Pinning the production interval is the point.
    const intervalMs = 30_000;
    const slowLatencyMs = 3_000;
    let heartbeatRequests = 0;
    const log = recordingLogger();

    const fetch: typeof globalThis.fetch = (input, init) => {
      if (!input.toString().endsWith("/heartbeat")) {
        return Promise.resolve(jsonResponse(serviceResponse));
      }
      heartbeatRequests++;
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        // Raw timer on purpose: this is the double's simulated latency, on the
        // same unscaled clock as the deadline it is being measured against.
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(jsonResponse(serviceResponse));
        }, slowLatencyMs);
        function onAbort() {
          clearTimeout(timer);
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        }
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    };

    const lifecycle = await createAgentServiceRegistrationLifecycle(
      lifecycleOptions(fetch, { heartbeatIntervalMs: intervalMs, logger: log.logger }),
    );

    // Driven directly rather than through the interval: this is about the
    // deadline on one attempt, not about scheduling.
    await lifecycle.heartbeat();
    lifecycle.stop();

    assertEquals(
      heartbeatRequests,
      1,
      "a slow success must be answered on the first attempt, with no retry",
    );
    assertEquals(log.warnings.length, 0, "a slow success must not log a retry notice");
    assertEquals(log.errors.length, 0, "a slow success must never escalate");
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
