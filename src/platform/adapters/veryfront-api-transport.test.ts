import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import {
  createCanonicalVeryfrontApiTransport,
  createVeryfrontApiTransport,
  type TransportRetryConfig,
} from "./veryfront-api-transport.ts";

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
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let attempts = 0;
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    try {
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
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
      }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects pre-cancelled requests before reading credentials or fetching", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let tokenReads = 0;
    let fetchCalls = 0;

    try {
      globalThis.fetch = (() => {
        fetchCalls += 1;
        return Promise.resolve(new Response("{}"));
      }) as typeof fetch;
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
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Veryfront API transport authority and response boundaries", () => {
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
    const originalFetch = globalThis.fetch;
    let tokenReads = 0;
    let fetchCalls = 0;

    try {
      globalThis.fetch = (() => {
        fetchCalls += 1;
        return Promise.resolve(new Response("{}"));
      }) as typeof fetch;
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
      globalThis.fetch = originalFetch;
    }
  });

  it("allows same-origin absolute requests and normalizes relative base paths", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; authorization: string | null }> = [];

    try {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Promise.resolve(Response.json({ ok: true }));
      }) as typeof fetch;
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
      globalThis.fetch = originalFetch;
    }
  });

  it("bounds and cancels upstream error bodies while redacting diagnostic URLs", async () => {
    const originalFetch = globalThis.fetch;
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
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(body, {
            status: 500,
            statusText: "Upstream failure",
          }),
        )) as typeof fetch;
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
      globalThis.fetch = originalFetch;
    }
  });
});
