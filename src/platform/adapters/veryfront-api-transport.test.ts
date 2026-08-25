import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import {
  createCanonicalVeryfrontApiTransport,
  createVeryfrontApiTransport,
  MAX_VERYFRONT_API_SUCCESS_BODY_BYTES,
  type TransportRetryConfig,
} from "./veryfront-api-transport.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

const baseConfig = {
  baseUrl: "https://api.example.com",
  getToken: () => "token",
};

describe("Veryfront API transport retry boundaries", () => {
  it("rejects retry policies that exceed ten total attempts", () => {
    assertThrows(
      () =>
        createVeryfrontApiTransport({
          ...baseConfig,
          retry: { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
        }),
      RangeError,
      "maxRetries",
    );

    assertThrows(
      () =>
        createCanonicalVeryfrontApiTransport(
          "https://api.example.com",
          () => "token",
          { maxRetries: 10, initialDelay: 0, maxDelay: 0 },
        ),
      RangeError,
      "maxRetries",
    );
  });

  it("rejects a missing retry policy at direct JavaScript boundaries", () => {
    assertThrows(
      () =>
        createVeryfrontApiTransport({
          ...baseConfig,
          retry: undefined as unknown as TransportRetryConfig,
        }),
      RangeError,
      "retry config is required",
    );
  });

  it("rejects unsafe delays and inverted delay ranges", () => {
    for (
      const retry of [
        { maxRetries: 0, initialDelay: Number.NaN, maxDelay: 0 },
        { maxRetries: 0, initialDelay: 0, maxDelay: Number.POSITIVE_INFINITY },
        { maxRetries: 0, initialDelay: 2, maxDelay: 1 },
      ]
    ) {
      assertThrows(
        () => createVeryfrontApiTransport({ ...baseConfig, retry }),
        RangeError,
      );
    }
  });

  it("accepts nine retries as the ten-total-attempt boundary", () => {
    createVeryfrontApiTransport({
      ...baseConfig,
      retry: {
        maxRetries: MAX_VERYFRONT_API_RETRIES,
        initialDelay: 0,
        maxDelay: 0,
      },
    });
    createCanonicalVeryfrontApiTransport(
      baseConfig.baseUrl,
      baseConfig.getToken,
      {
        maxRetries: MAX_VERYFRONT_API_RETRIES,
        initialDelay: 0,
        maxDelay: 0,
      },
    );
  });

  it("composes caller cancellation with request timeout without retrying", async () => {
    const controller = new AbortController();
    let attempts = 0;
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    try {
      installMockFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) => {
          attempts += 1;
          const signal = init?.signal;
          requestStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            if (!signal) {
              reject(new Error("request did not receive an AbortSignal"));
              return;
            }
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        }) as typeof fetch,
      );

      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 9, initialDelay: 0, maxDelay: 0 },
      });
      const pending = transport.request("/files", {
        signal: controller.signal,
      });
      await started;
      controller.abort(new DOMException("cancelled", "AbortError"));

      const error = await assertRejects(() => pending);
      assertInstanceOf(error, DOMException);
      assertEquals(error.name, "AbortError");
      assertEquals(attempts, 1);
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects pre-cancelled requests before reading credentials or fetching", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let tokenReads = 0;
    let fetchCalls = 0;

    try {
      installMockFetch(
        (() => {
          fetchCalls += 1;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        baseUrl: baseConfig.baseUrl,
        getToken: () => {
          tokenReads += 1;
          return "token";
        },
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const error = await assertRejects(() =>
        transport.request("/files", { signal: controller.signal })
      );
      assertInstanceOf(error, DOMException);
      assertEquals(error.name, "AbortError");
      assertEquals(tokenReads, 0);
      assertEquals(fetchCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("captures the request token once so retries cannot observe a mid-flight token change", async () => {
    let tokenReads = 0;
    const authorizations: Array<string | null> = [];

    try {
      installMockFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) => {
          authorizations.push(new Headers(init?.headers).get("authorization"));
          return Promise.resolve(
            authorizations.length === 1
              ? new Response(null, { status: 500, statusText: "Upstream failure" })
              : Response.json({ ok: true }),
          );
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        baseUrl: baseConfig.baseUrl,
        getToken: () => `token-${++tokenReads}`,
        retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
      });

      assertEquals(
        await transport.request("/files"),
        { ok: true },
        "the retried request must resolve with the successful attempt",
      );
      assertEquals(
        tokenReads,
        1,
        "the token provider must be read exactly once per request, not once per attempt",
      );
      assertEquals(
        authorizations,
        ["Bearer token-1", "Bearer token-1"],
        "every retry attempt must reuse the token captured for the request",
      );
    } finally {
      restoreMockFetch();
    }
  });
});

describe("Veryfront API transport authority and response boundaries", () => {
  it("rejects invalid success-body limits before reading credentials or fetching", async () => {
    let tokenReads = 0;
    let fetchCalls = 0;

    try {
      installMockFetch(
        (() => {
          fetchCalls += 1;
          return Promise.resolve(Response.json({ ok: true }));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        baseUrl: baseConfig.baseUrl,
        getToken: () => {
          tokenReads += 1;
          return "secret";
        },
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      for (
        const maxResponseBytes of [
          0,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          MAX_VERYFRONT_API_SUCCESS_BODY_BYTES + 1,
        ]
      ) {
        await assertRejects(
          () => transport.request("/files", { maxResponseBytes }),
          RangeError,
          "maxResponseBytes",
        );
      }
      assertEquals(tokenReads, 0);
      assertEquals(fetchCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("bounds and cancels successful response bodies before parsing", async () => {
    let cancellations = 0;
    let fetchCalls = 0;

    try {
      installMockFetch(
        (() => {
          fetchCalls += 1;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":true}'));
            },
            cancel() {
              cancellations += 1;
            },
          });
          return Promise.resolve(new Response(body));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 3, initialDelay: 0, maxDelay: 0 },
        wrapFinalError: (error) => error,
      });

      await assertRejects(
        () => transport.request("/files", { maxResponseBytes: 4 }),
        Error,
        "successful response exceeded 4 bytes",
      );
      assertEquals(fetchCalls, 1);
      assertEquals(cancellations, 1);
    } finally {
      restoreMockFetch();
    }
  });

  it("accepts a successful JSON body exactly at the configured byte limit", async () => {
    try {
      installMockFetch((() => Promise.resolve(new Response("null"))) as typeof fetch);
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      assertEquals(
        await transport.request("/files", { maxResponseBytes: 4 }),
        null,
      );
    } finally {
      restoreMockFetch();
    }
  });

  it("snapshots the success-body limit before asynchronous fetch work", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    try {
      installMockFetch(
        (async () => {
          await fetchGate;
          return new Response('{"ok":true}');
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        wrapFinalError: (error) => error,
      });
      const init = { maxResponseBytes: 4 };

      const pending = transport.request("/files", init);
      init.maxResponseBytes = 1_024;
      releaseFetch();

      await assertRejects(
        () => pending,
        Error,
        "successful response exceeded 4 bytes",
      );
    } finally {
      restoreMockFetch();
    }
  });

  it("snapshots nested bounded-field options before asynchronous fetch work", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    try {
      installMockFetch(
        (async () => {
          await fetchGate;
          return new Response('{"content":"abcdef"}');
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        wrapFinalError: (error) => error,
      });
      const boundedField = { fieldName: "content", maximumBytes: 5 };
      const init = {
        maxResponseBytes: 14,
        jsonStringFieldWithinLimit: boundedField,
      };

      const pending = transport.request("/files", init);
      boundedField.maximumBytes = 6;
      init.maxResponseBytes = 1_024;
      releaseFetch();

      await assertRejects(() => pending, RangeError, "exceeds 5 UTF-8 bytes");
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects invalid UTF-8 success bodies without retrying", async () => {
    let fetchCalls = 0;
    try {
      installMockFetch(
        (() => {
          fetchCalls += 1;
          return Promise.resolve(new Response(new Uint8Array([0xff])));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 3, initialDelay: 0, maxDelay: 0 },
        wrapFinalError: (error) => error,
      });

      await assertRejects(
        () => transport.request("/files", { maxResponseBytes: 1 }),
        Error,
        "not valid UTF-8",
      );
      assertEquals(fetchCalls, 1);
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects and cancels oversized declared success bodies", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    });

    try {
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(body, { headers: { "content-length": "100" } }),
          )) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        shouldRetry: () => false,
        wrapFinalError: (error) => error,
      });

      await assertRejects(
        () => transport.request("/files", { maxResponseBytes: 4 }),
        Error,
        "successful response exceeded 4 bytes",
      );
      assertEquals(cancelled, true);
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects invalid or credential-bearing API base URLs at construction", () => {
    for (
      const baseUrl of [
        "not a URL",
        "ftp://api.example.com",
        "https://user:secret@api.example.com",
        "https://api.example.com?token=secret",
        "https://api.example.com#fragment",
      ]
    ) {
      assertThrows(
        () =>
          createVeryfrontApiTransport({
            ...baseConfig,
            baseUrl,
            retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
          }),
        TypeError,
      );
    }
  });

  it("rejects cross-origin absolute requests before reading credentials or fetching", async () => {
    let tokenReads = 0;
    let fetchCalls = 0;

    try {
      installMockFetch(
        (() => {
          fetchCalls += 1;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        baseUrl: baseConfig.baseUrl,
        getToken: () => {
          tokenReads += 1;
          return "secret";
        },
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      await assertRejects(
        () => transport.request("https://attacker.example/files"),
        TypeError,
        "origin",
      );
      assertEquals(tokenReads, 0);
      assertEquals(fetchCalls, 0);
    } finally {
      restoreMockFetch();
    }
  });

  it("allows same-origin absolute requests and normalizes relative base paths", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];

    try {
      installMockFetch(
        ((input: RequestInfo | URL, init?: RequestInit) => {
          requests.push({
            url: String(input),
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return Promise.resolve(Response.json({ ok: true }));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        baseUrl: "https://api.example.com/root/",
        getToken: () => "secret",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      await transport.request("/v1/files");
      await transport.request("https://api.example.com/v1/projects");

      assertEquals(requests, [
        {
          url: "https://api.example.com/root/v1/files",
          authorization: "Bearer secret",
        },
        {
          url: "https://api.example.com/v1/projects",
          authorization: "Bearer secret",
        },
      ]);
    } finally {
      restoreMockFetch();
    }
  });

  it("rejects redirects by default for credentialed API requests", async () => {
    const redirectPolicies: Array<RequestRedirect | undefined> = [];

    try {
      installMockFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) => {
          redirectPolicies.push(init?.redirect);
          return Promise.resolve(Response.json({ ok: true }));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      await transport.request("/files");

      assertEquals(redirectPolicies, ["error"]);
    } finally {
      restoreMockFetch();
    }
  });

  it("uses explicit redirect policies when callers opt in", async () => {
    const redirectPolicies: Array<RequestRedirect | undefined> = [];

    try {
      installMockFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) => {
          redirectPolicies.push(init?.redirect);
          return Promise.resolve(Response.json({ ok: true }));
        }) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      await transport.request("/explicit-follow", { redirect: "follow" });
      await transport.request("/explicit-manual", { redirect: "manual" });

      assertEquals(redirectPolicies, ["follow", "manual"]);
    } finally {
      restoreMockFetch();
    }
  });

  it("bounds and cancels upstream error bodies while redacting diagnostic URLs", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(16 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });

    try {
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(body, {
              status: 500,
              statusText: "Upstream failure",
            }),
          )) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        shouldRetry: () => false,
        wrapFinalError: (error) => error,
      });

      const error = await assertRejects(() =>
        transport.request(
          "https://api.example.com/files?access_token=secret&cursor=public",
        )
      );
      assertInstanceOf(error, Error);
      const context = (error as {
        context?: {
          details?: {
            url?: string;
            responseText?: string;
            responseTruncated?: boolean;
          };
        };
      }).context;
      assertEquals(
        context?.details?.url,
        "https://api.example.com/files?access_token=[REDACTED]&cursor=public",
      );
      assertEquals(context?.details?.responseText?.length, 8 * 1024);
      assertEquals(context?.details?.responseTruncated, true);
      assertEquals(cancelled, true);
    } finally {
      restoreMockFetch();
    }
  });

  it("omits the upstream error body when diagnostics opt out", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(16 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });

    try {
      installMockFetch(
        (() =>
          Promise.resolve(
            new Response(body, {
              status: 500,
              statusText: "Upstream failure",
            }),
          )) as typeof fetch,
      );
      const transport = createVeryfrontApiTransport({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        shouldRetry: () => false,
        wrapFinalError: (error) => error,
      });

      const error = await assertRejects(() =>
        transport.request(
          "https://api.example.com/files?access_token=secret&cursor=public",
          { includeErrorBodyInDiagnostics: false },
        )
      );
      assertInstanceOf(error, Error);
      const context = (error as {
        context?: {
          details?: {
            url?: string;
            responseText?: string;
            responseTruncated?: boolean;
          };
        };
      }).context;
      assertEquals(
        context?.details?.responseText,
        undefined,
        "opting out must keep the upstream body out of the error context",
      );
      assertEquals(
        context?.details?.url,
        "https://api.example.com/files?access_token=[REDACTED]&cursor=public",
        "the redacted URL must still be reported",
      );
      assertEquals(
        context?.details?.responseTruncated,
        true,
        "truncation must still be reported when the body is withheld",
      );
      assertEquals(cancelled, true, "the upstream body stream must still be cancelled");
    } finally {
      restoreMockFetch();
    }
  });

  it("authorizes every egress hop when an outbound policy is configured", async () => {
    const authorizedOrigin = "https://93.184.216.34";
    const retry = { maxRetries: 0, initialDelay: 0, maxDelay: 0 };
    const outboundPolicy = {
      authorizeUrl(url: URL) {
        if (url.origin !== authorizedOrigin) {
          throw new Error(`blocked: ${url.origin}`);
        }
      },
    };

    const authorized: Request[] = [];
    await withMockFetch(
      (input: URL | Request | string, init?: RequestInit) => {
        authorized.push(new Request(input, init));
        return Promise.resolve(Response.json({ ok: true }));
      },
      async () => {
        const transport = createVeryfrontApiTransport({
          baseUrl: authorizedOrigin,
          getToken: () => "secret",
          retry,
          outboundPolicy,
          wrapFinalError: (error) => error,
        });
        assertEquals(
          await transport.request("/files"),
          { ok: true },
          "an authorized origin must complete through the guarded transport",
        );
      },
    );
    assertEquals(
      authorized.length,
      1,
      "the authorized request must reach the outbound transport exactly once",
    );
    assertEquals(
      authorized[0]?.headers.get("authorization"),
      "Bearer secret",
      "the guarded path must forward the bearer credential",
    );

    await withMockFetch(
      () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: `${authorizedOrigin}/elsewhere` },
          }),
        ),
      async () => {
        const transport = createVeryfrontApiTransport({
          baseUrl: authorizedOrigin,
          getToken: () => "secret",
          retry,
          outboundPolicy,
          wrapFinalError: (error) => error,
        });
        await assertRejects(
          () => transport.request("/files"),
          Error,
          "redirect",
          "the guarded path must refuse redirects for credentialed requests",
        );
      },
    );

    const blocked: Request[] = [];
    await withMockFetch(
      (input: URL | Request | string, init?: RequestInit) => {
        blocked.push(new Request(input, init));
        return Promise.resolve(Response.json({ ok: true }));
      },
      async () => {
        const transport = createVeryfrontApiTransport({
          baseUrl: "https://93.184.216.35",
          getToken: () => "secret",
          retry,
          outboundPolicy,
          wrapFinalError: (error) => error,
        });
        await assertRejects(
          () => transport.request("/files"),
          Error,
          "blocked",
          "an unauthorized origin must be refused by the outbound policy",
        );
      },
    );
    assertEquals(
      blocked.length,
      0,
      "the bearer credential must never leave the process for an unauthorized origin",
    );
  });
});
