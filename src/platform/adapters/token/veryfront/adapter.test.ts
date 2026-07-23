import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontTokenAdapter } from "./adapter.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

describe("platform/adapters/token/veryfront/adapter", () => {
  function createConfig(overrides: Record<string, unknown> = {}) {
    return {
      type: "veryfront-api" as const,
      veryfront: {
        apiToken: "test-token",
        projectSlug: "test-project",
        apiBaseUrl: "https://api.example.com",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        timeoutMs: 1_000,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
  });

  afterEach(() => {
    Deno.env.delete("LOG_LEVEL");
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
  });

  it("coalesces concurrent initialization into one connectivity check", async () => {
    let resolvePing: ((response: Response) => void) | undefined;
    let calls = 0;
    const adapter = new VeryfrontTokenAdapter(createConfig(), {
      fetch: () => {
        calls++;
        return new Promise<Response>((resolve) => {
          resolvePing = resolve;
        });
      },
    });

    const first = adapter.initialize();
    const second = adapter.initialize();
    const third = adapter.initialize();
    await Promise.resolve();

    assertEquals(calls, 1);
    resolvePing?.(Response.json({ keys: [] }));
    await Promise.all([first, second, third]);
    assertEquals(calls, 1);
  });

  it("allows a failed initialization to be retried", async () => {
    let calls = 0;
    const adapter = new VeryfrontTokenAdapter(createConfig(), {
      fetch: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("offline"));
        return Promise.resolve(Response.json({ keys: [] }));
      },
    });

    await assertRejects(() => adapter.initialize(), VeryfrontError);
    await adapter.initialize();

    assertEquals(calls, 2);
  });

  it("does not let stale initialization complete after dispose", async () => {
    let resolveFirstPing: ((response: Response) => void) | undefined;
    let calls = 0;
    const adapter = new VeryfrontTokenAdapter(createConfig(), {
      fetch: (_input, init) => {
        calls++;
        if (calls > 1) return Promise.resolve(Response.json({ keys: [] }));
        return new Promise<Response>((resolve, reject) => {
          resolveFirstPing = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    });

    const staleInitialization = adapter.initialize();
    await Promise.resolve();
    adapter.dispose();
    resolveFirstPing?.(Response.json({ keys: [] }));

    await assertRejects(() => staleInitialization, VeryfrontError);
    await adapter.initialize();
    assertEquals(calls, 2);
  });

  it("lets a caller cancel while shared initialization continues", async () => {
    let resolvePing: ((response: Response) => void) | undefined;
    let calls = 0;
    const adapter = new VeryfrontTokenAdapter(createConfig(), {
      fetch: () => {
        calls++;
        return new Promise<Response>((resolve) => {
          resolvePing = resolve;
        });
      },
    });
    const controller = new AbortController();
    const operation = adapter.get("key", { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    const error = await operation.then(
      () => undefined,
      (reason) => reason as VeryfrontError,
    );
    assertEquals(error?.status, 499);

    resolvePing?.(Response.json({ keys: [] }));
    await adapter.initialize();
    assertEquals(calls, 1);
  });

  it("does not emit token configuration, keys, or prefixes", async () => {
    const secret = "PRIVATE_ADAPTER_CANARY";
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const adapter = new VeryfrontTokenAdapter(
      createConfig({
        apiBaseUrl: `https://api.example.com/${secret}`,
        apiToken: secret,
        projectSlug: secret,
      }),
      {
        fetch: (input, init) => {
          const url = new URL(String(input));
          if (init?.method === "PUT" || init?.method === "DELETE") {
            return Promise.resolve(new Response("ok"));
          }
          if (url.pathname.endsWith("/tokens")) {
            return Promise.resolve(Response.json({ keys: [] }));
          }
          return Promise.resolve(Response.json({ value: "encrypted" }));
        },
      },
    );

    await adapter.initialize();
    await adapter.get(secret);
    await adapter.set(secret, "encrypted");
    await adapter.delete(secret);
    await adapter.list(secret);

    assertEquals(JSON.stringify(entries).includes(secret), false);
  });

  it("keeps the existing unreachable API error contract", async () => {
    const adapter = new VeryfrontTokenAdapter(
      createConfig({ apiBaseUrl: "http://127.0.0.1:19999" }),
    );
    await assertRejects(() => adapter.initialize(), VeryfrontError);
    adapter.dispose();
  });
});
