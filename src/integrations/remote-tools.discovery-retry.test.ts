/**
 * Regression tests for Sentry VERYFRONT-AGENT-C (veryfront-issue-inbox#874).
 *
 * Signature: `Error: Failed to fetch remote integration tool definitions`,
 * emitted through `logger.error` in remote-tools discovery.
 *
 * The tool-list request is a read-only, idempotent POST, yet a single
 * transient failure (a dropped connection or a 5xx from the API) abandons
 * discovery immediately: the run loses its integration tools and the
 * error-level log fires on the first blip. Discovery must retry transient
 * failures a bounded number of times before degrading, and must not emit
 * the error-level signature when a retry recovers.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { getRemoteIntegrationToolDiscovery } from "./remote-tools.ts";

const DISCOVERY_FAILURE_MESSAGE = "Failed to fetch remote integration tool definitions";

/** Upper bound on total attempts so a hard outage cannot hot-loop. */
const MAX_EXPECTED_DISCOVERY_ATTEMPTS = 4;

const ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

function setRemoteToolEnv(overrides: Record<string, string>): void {
  for (const key of ENV_KEYS) {
    deleteEnv(key);
  }
  for (const [key, value] of Object.entries(overrides)) {
    setEnv(key, value);
  }
  refreshEnvironmentConfig();
}

function restoreRemoteToolEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
      continue;
    }
    setEnv(key, value);
  }
  refreshEnvironmentConfig();
}

/** Collect error-level discovery-failure log entries emitted while `run` executes. */
async function captureDiscoveryFailureLogs(
  run: () => Promise<unknown>,
): Promise<LogEntry[]> {
  const records: LogEntry[] = [];
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.level === "error" && entry.message === DISCOVERY_FAILURE_MESSAGE) {
      records.push(entry);
    }
  });

  try {
    await run();
  } finally {
    unsubscribe();
  }

  return records;
}

function toolListResponse(): Response {
  return Response.json({
    tools: [{
      name: "github__list_issues",
      description: "List issues",
      inputSchema: { type: "object", properties: {} },
    }],
  });
}

afterEach(() => {
  restoreRemoteToolEnv();
});

describe("integrations/remote-tools discovery retry (issue-inbox#874)", () => {
  it("retries a transient network failure and recovers the tool catalog without an error log", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: Awaited<ReturnType<typeof getRemoteIntegrationToolDiscovery>> | undefined;
    const errorLogs = await captureDiscoveryFailureLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          throw new TypeError("error trying to connect: connection reset");
        }
        return toolListResponse();
      }, async () => await getRemoteIntegrationToolDiscovery());
    });

    assertEquals(
      fetchCalls,
      2,
      "discovery must retry the idempotent tool-list request after a transient network failure",
    );
    assertEquals(
      result?.status,
      "ok",
      "discovery must recover the catalog when a retry succeeds",
    );
    assert(
      result !== undefined && result.status === "ok" && result.tools.length === 1,
      "the recovered catalog must contain the tool definitions from the retried response",
    );
    assertEquals(
      errorLogs.length,
      0,
      "a recovered transient failure must not emit the error-level Sentry signature",
    );
  });

  it("retries a 5xx tool-list response and recovers the tool catalog without an error log", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: Awaited<ReturnType<typeof getRemoteIntegrationToolDiscovery>> | undefined;
    const errorLogs = await captureDiscoveryFailureLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return new Response("upstream unavailable", {
            status: 503,
            statusText: "Service Unavailable",
          });
        }
        return toolListResponse();
      }, async () => await getRemoteIntegrationToolDiscovery());
    });

    assertEquals(
      fetchCalls,
      2,
      "discovery must retry the idempotent tool-list request after a 5xx response",
    );
    assertEquals(
      result?.status,
      "ok",
      "discovery must recover the catalog when a retry succeeds",
    );
    assertEquals(
      errorLogs.length,
      0,
      "a recovered 5xx must not emit the error-level Sentry signature",
    );
  });

  it("bounds retries on a persistent failure and degrades with a single error log", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    let result: Awaited<ReturnType<typeof getRemoteIntegrationToolDiscovery>> | undefined;
    const errorLogs = await captureDiscoveryFailureLogs(async () => {
      result = await withMockFetch(async () => {
        fetchCalls++;
        return new Response("upstream unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }, async () => await getRemoteIntegrationToolDiscovery());
    });

    assert(
      fetchCalls >= 2,
      `discovery must attempt at least one retry before degrading (saw ${fetchCalls} attempt(s))`,
    );
    assert(
      fetchCalls <= MAX_EXPECTED_DISCOVERY_ATTEMPTS,
      `discovery retries must stay bounded (saw ${fetchCalls} attempts)`,
    );
    assertEquals(
      result?.status,
      "unavailable",
      "a persistent failure must still degrade to an unavailable catalog, not throw",
    );
    assertEquals(
      errorLogs.length,
      1,
      "a persistent failure must emit the error-level signature exactly once",
    );
  });
});
