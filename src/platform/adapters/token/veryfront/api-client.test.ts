import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { TokenStorageApiClient } from "./api-client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import type { VeryfrontTokenConfig } from "./types.ts";

function createConfig(overrides: Partial<VeryfrontTokenConfig> = {}): VeryfrontTokenConfig {
  return {
    apiBaseUrl: "https://api.example.com/token-root",
    apiToken: "<TOKEN>",
    projectSlug: "test-project",
    retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    timeoutMs: 1_000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

async function captureVeryfrontError(fn: () => Promise<unknown>): Promise<VeryfrontError> {
  try {
    await fn();
  } catch (error) {
    assertEquals(error instanceof VeryfrontError, true);
    return error as VeryfrontError;
  }
  throw new Error("Expected operation to reject");
}

describe("platform/adapters/token/veryfront/api-client", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

  it("rejects unreadable transport dependencies without exposing their errors", () => {
    const secret = "PRIVATE_DEPENDENCY_CANARY";
    const dependencies = Object.defineProperty({}, "fetch", {
      get() {
        throw new Error(secret);
      },
    });

    let error: VeryfrontError | undefined;
    try {
      new TokenStorageApiClient(createConfig(), dependencies);
    } catch (reason) {
      error = reason as VeryfrontError;
    }

    assertExists(error);
    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("accepts the legacy client configuration shape without an explicit timeout", () => {
    const config: VeryfrontTokenConfig = {
      apiBaseUrl: "https://api.example.com",
      apiToken: "<TOKEN>",
      projectSlug: "test-project",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    };

    assertExists(new TokenStorageApiClient(config));
  });

  it("snapshots configuration and builds encoded URLs under the configured base path", async () => {
    const config = createConfig({
      apiBaseUrl: "https://api.example.com/token-root",
      apiToken: "initial-token",
      projectSlug: "project/one",
    });
    let requestedUrl: string | undefined;
    let authorization: string | null = null;
    const client = new TokenStorageApiClient(config, {
      fetch: (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get("Authorization");
        return Promise.resolve(jsonResponse({ value: "encrypted" }));
      },
    });

    (config as { apiBaseUrl: string }).apiBaseUrl = "https://changed.example.com";
    (config as { apiToken: string }).apiToken = "changed-token";
    (config as { projectSlug: string }).projectSlug = "changed-project";

    assertEquals(await client.get("user/one:service"), "encrypted");
    assertEquals(
      requestedUrl,
      "https://api.example.com/token-root/v1/projects/project%2Fone/tokens/user%2Fone%3Aservice",
    );
    assertEquals(authorization, "Bearer initial-token");
  });

  it("rejects invalid token inputs before sending a request", async () => {
    let calls = 0;
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => {
        calls++;
        return Promise.resolve(jsonResponse({ value: "unexpected" }));
      },
    });

    for (
      const operation of [
        () => client.get("   "),
        () => client.set("", "encrypted"),
        () => client.delete("\t"),
        () => client.set("key", 42 as never),
        () => client.list(42 as never),
      ]
    ) {
      const error = await captureVeryfrontError(operation);
      assertEquals(error.status, 400);
    }
    assertEquals(calls, 0);
  });

  it("consumes or cancels bodies for 404 and bodyless operations", async () => {
    const responses = [
      new Response("missing", { status: 404 }),
      new Response("stored", { status: 200 }),
      new Response("already absent", { status: 404 }),
    ];
    let call = 0;
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.resolve(responses[call++]!),
    });

    assertEquals(await client.get("missing"), null);
    await client.set("key", "encrypted");
    await client.delete("key");

    assertEquals(responses.map((response) => response.bodyUsed), [true, true, true]);
  });

  it("cancels a retryable response before waiting and uses bounded Retry-After", async () => {
    const retryResponse = new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120" },
    });
    const delays: number[] = [];
    let calls = 0;
    const client = new TokenStorageApiClient(
      createConfig({
        retry: { maxRetries: 1, initialDelay: 5, maxDelay: 25 },
      }),
      {
        fetch: () => {
          calls++;
          return Promise.resolve(
            calls === 1 ? retryResponse : jsonResponse({ value: "encrypted" }),
          );
        },
        sleep: (delay) => {
          assertEquals(retryResponse.bodyUsed, true);
          delays.push(delay);
          return Promise.resolve();
        },
      },
    );

    assertEquals(await client.get("key"), "encrypted");
    assertEquals(calls, 2);
    assertEquals(delays, [25]);
  });

  it("ignores malformed Retry-After values", async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = new TokenStorageApiClient(
      createConfig({ retry: { maxRetries: 1, initialDelay: 7, maxDelay: 25 } }),
      {
        fetch: () => {
          calls++;
          return Promise.resolve(
            calls === 1
              ? new Response("rate limited", {
                status: 429,
                headers: { "Retry-After": "-1" },
              })
              : jsonResponse({ value: "encrypted" }),
          );
        },
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      },
    );

    assertEquals(await client.get("key"), "encrypted");
    assertEquals(delays, [7]);
  });

  it("retries request timeouts and retryable HTTP statuses deterministically", async () => {
    for (const status of [408, 429, 500]) {
      let calls = 0;
      const client = new TokenStorageApiClient(
        createConfig({ retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 } }),
        {
          fetch: () => {
            calls++;
            return Promise.resolve(
              calls === 1
                ? new Response("retry", { status })
                : jsonResponse({ value: "encrypted" }),
            );
          },
          sleep: () => Promise.resolve(),
        },
      );

      assertEquals(await client.get("key"), "encrypted");
      assertEquals(calls, 2);
    }
  });

  it("does not retry non-retryable client errors and consumes their bodies", async () => {
    const response = new Response("PRIVATE_RESPONSE_CANARY", {
      status: 400,
      statusText: "PRIVATE_STATUS_CANARY",
    });
    let calls = 0;
    const client = new TokenStorageApiClient(
      createConfig({ retry: { maxRetries: 3, initialDelay: 0, maxDelay: 0 } }),
      {
        fetch: () => {
          calls++;
          return Promise.resolve(response);
        },
      },
    );

    const error = await captureVeryfrontError(() => client.get("PRIVATE_KEY_CANARY"));

    assertEquals(calls, 1);
    assertEquals(response.bodyUsed, true);
    assertEquals(error.status, 400);
    assertEquals(JSON.stringify(error).includes("PRIVATE_"), false);
  });

  it("validates get and list response shapes without exposing response content", async () => {
    const invalidResponses = [
      new Response("PRIVATE_INVALID_JSON_CANARY"),
      jsonResponse({ value: 42 }),
      jsonResponse({ keys: ["valid", 42] }),
    ];
    let call = 0;
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.resolve(invalidResponses[call++]!),
    });

    const invalidJsonError = await captureVeryfrontError(() => client.get("key"));
    const invalidGetError = await captureVeryfrontError(() => client.get("key"));
    const invalidListError = await captureVeryfrontError(() => client.list("PRIVATE_PREFIX"));

    for (const error of [invalidJsonError, invalidGetError, invalidListError]) {
      assertEquals(error.status, 502);
      assertEquals(JSON.stringify(error).includes("PRIVATE_"), false);
    }
    assertEquals(invalidResponses.map((response) => response.bodyUsed), [true, true, true]);
  });

  it("cancels the body when response decoding fails before consuming it", async () => {
    const secret = "PRIVATE_DECODE_CANARY";
    const response = new Response(secret);
    Object.defineProperty(response, "text", {
      value: () => Promise.reject(new Error(secret)),
    });
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.resolve(response),
    });

    const error = await captureVeryfrontError(() => client.get("key"));

    assertEquals(response.bodyUsed, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("accepts an omitted keys field as an empty list", async () => {
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.resolve(jsonResponse({})),
    });

    assertEquals(await client.list(), []);
  });

  it("does not start or retry a request after caller cancellation", async () => {
    let calls = 0;
    const client = new TokenStorageApiClient(
      createConfig({ retry: { maxRetries: 3, initialDelay: 0, maxDelay: 0 } }),
      {
        fetch: (_input, init) => {
          calls++;
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("PRIVATE_ABORT_CANARY", "AbortError")),
              { once: true },
            );
          });
        },
      },
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    const earlyError = await captureVeryfrontError(() =>
      client.get("PRIVATE_KEY_CANARY", { signal: alreadyAborted.signal })
    );
    assertEquals(calls, 0);
    assertEquals(earlyError.status, 499);

    const inFlight = new AbortController();
    const pendingError = captureVeryfrontError(() =>
      client.get("PRIVATE_KEY_CANARY", { signal: inFlight.signal })
    );
    await Promise.resolve();
    inFlight.abort();
    const error = await pendingError;

    assertEquals(calls, 1);
    assertEquals(error.status, 499);
    assertEquals(JSON.stringify(error).includes("PRIVATE_"), false);
  });

  it("interrupts retry waiting when the caller cancels", async () => {
    let notifySleeping: (() => void) | undefined;
    const sleeping = new Promise<void>((resolve) => {
      notifySleeping = resolve;
    });
    const client = new TokenStorageApiClient(
      createConfig({ retry: { maxRetries: 2, initialDelay: 100, maxDelay: 100 } }),
      {
        fetch: () => Promise.resolve(new Response("retry", { status: 503 })),
        sleep: () => {
          notifySleeping?.();
          return new Promise<void>(() => {});
        },
      },
    );
    const controller = new AbortController();
    const pending = captureVeryfrontError(() => client.get("key", { signal: controller.signal }));

    await sleeping;
    controller.abort();
    const error = await pending;

    assertEquals(error.status, 499);
  });

  it("clears the default retry timer when the caller cancels", async () => {
    const controller = new AbortController();
    __registerLogRecordEmitter((entry) => {
      if (entry.message === "Token storage request failed; retrying") {
        queueMicrotask(() => controller.abort());
      }
    });
    const client = new TokenStorageApiClient(
      createConfig({ retry: { maxRetries: 1, initialDelay: 10_000, maxDelay: 10_000 } }),
      { fetch: () => Promise.resolve(new Response(null, { status: 503 })) },
    );

    const error = await captureVeryfrontError(() =>
      client.get("key", {
        signal: controller.signal,
      })
    );

    assertEquals(error.status, 499);
  });

  it("classifies exhausted internal timeouts without exposing provider errors", async () => {
    let calls = 0;
    const client = new TokenStorageApiClient(
      createConfig({
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        timeoutMs: 1,
      }),
      {
        fetch: (_input, init) => {
          calls++;
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("PRIVATE_TIMEOUT_CANARY", "AbortError")),
              { once: true },
            );
          });
        },
        sleep: () => Promise.resolve(),
      },
    );

    const error = await captureVeryfrontError(() => client.get("key"));

    assertEquals(calls, 2);
    assertEquals(error.status, 504);
    assertEquals(JSON.stringify(error).includes("PRIVATE_"), false);
  });

  it("enforces timeouts when a transport ignores abort and cleans up its late response", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const lateFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const client = new TokenStorageApiClient(
      createConfig({ timeoutMs: 1 }),
      { fetch: () => lateFetch },
    );
    const request = client.get("key").then(
      () => ({ outcome: "value" as const }),
      (error) => ({ outcome: "error" as const, error: error as VeryfrontError }),
    );

    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    const pendingMarker = new Promise<{ outcome: "pending" }>((resolve) => {
      pendingTimer = setTimeout(() => resolve({ outcome: "pending" }), 20);
    });
    const firstOutcome = await Promise.race([request, pendingMarker]);
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    const lateResponse = jsonResponse({ value: "too late" });
    resolveFetch?.(lateResponse);
    await request;
    await Promise.resolve();

    assertEquals(firstOutcome.outcome, "error");
    if (firstOutcome.outcome === "error") assertEquals(firstOutcome.error.status, 504);
    assertEquals(lateResponse.bodyUsed, true);
  });

  it("keeps keys, prefixes, URLs, credentials, and provider messages out of logs and errors", async () => {
    const secret = "PRIVATE_PROVIDER_CANARY";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const config = createConfig({
      apiBaseUrl: `https://api.example.com/${secret}`,
      apiToken: secret,
      projectSlug: secret,
    });
    const plainErrorClient = new TokenStorageApiClient(config, {
      fetch: () =>
        Promise.reject(
          new Error(`${secret} https://user:${secret}@example.com/?token=${secret}`),
        ),
    });
    const typedErrorClient = new TokenStorageApiClient(config, {
      fetch: () => Promise.reject(TOKEN_STORAGE_ERROR.create({ detail: secret })),
    });
    const typedSleepErrorClient = new TokenStorageApiClient(
      createConfig({
        ...config,
        retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
      }),
      {
        fetch: () => Promise.resolve(new Response(null, { status: 503 })),
        sleep: () => Promise.reject(TOKEN_STORAGE_ERROR.create({ detail: secret })),
      },
    );

    const plainError = await captureVeryfrontError(() => plainErrorClient.list(secret));
    const typedError = await captureVeryfrontError(() => typedErrorClient.list(secret));
    const typedSleepError = await captureVeryfrontError(() => typedSleepErrorClient.list(secret));
    const serialized = JSON.stringify({ entries, plainError, typedError, typedSleepError });

    assertEquals(serialized.includes(secret), false);
  });

  it("handles response body cancellation failures without leaking their messages", async () => {
    const secret = "PRIVATE_CANCEL_CANARY";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("missing"));
        },
        cancel() {
          throw new Error(secret);
        },
      }),
      { status: 404 },
    );
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.resolve(response),
    });

    assertEquals(await client.get("key"), null);
    assertEquals(response.bodyUsed, true);
    assertEquals(JSON.stringify(entries).includes(secret), false);
  });

  it("ping returns false for request failures", async () => {
    const client = new TokenStorageApiClient(createConfig(), {
      fetch: () => Promise.reject(new Error("offline")),
    });

    assertEquals(await client.ping(), false);
  });

  it("keeps the existing unreachable API error contract", async () => {
    const client = new TokenStorageApiClient(createConfig({
      apiBaseUrl: "http://127.0.0.1:19999",
    }));

    await assertRejects(() => client.get("test-key"), VeryfrontError);
    assertExists(client);
  });
});
