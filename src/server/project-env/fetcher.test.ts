import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { VeryfrontError } from "#veryfront/errors";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { fetchProjectEnvVars } from "./fetcher.ts";

describe("project-env/fetcher", () => {
  it("fetches and transforms env vars from API", async () => {
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);

      assertEquals(url.pathname, "/projects/my-project/environment-variables");
      assertEquals(url.searchParams.get("environment_id"), "env-123");
      assertEquals(url.searchParams.get("limit"), "100");
      assertEquals(req.headers.get("authorization"), "Bearer test-token");

      return Response.json({
        data: [
          { key: "API_KEY", value: "sk-123" },
          { key: "DATABASE_URL", value: "postgres://localhost/db" },
        ],
      });
    });

    try {
      const result = await fetchProjectEnvVars(
        `http://127.0.0.1:${port}`,
        "my-project",
        "env-123",
        "test-token",
      );

      assertEquals(result, {
        API_KEY: "sk-123",
        DATABASE_URL: "postgres://localhost/db",
      });
    } finally {
      await server.shutdown();
    }
  });

  it("handles empty response data", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({ data: [] });
    });

    try {
      const result = await fetchProjectEnvVars(
        `http://127.0.0.1:${port}`,
        "my-project",
        "env-123",
        "test-token",
      );

      assertEquals(result, {});
    } finally {
      await server.shutdown();
    }
  });

  it("rejects a response with a missing data field", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({});
    });

    try {
      await assertRejects(
        () =>
          fetchProjectEnvVars(
            `http://127.0.0.1:${port}`,
            "my-project",
            "env-123",
            "test-token",
          ),
        VeryfrontError,
      );
    } finally {
      await server.shutdown();
    }
  });

  it("throws on non-200 response", async () => {
    const { server, port } = createMockServer(() => {
      return new Response("Unauthorized", { status: 401 });
    });

    try {
      let threw = false;
      try {
        await fetchProjectEnvVars(
          `http://127.0.0.1:${port}`,
          "my-project",
          "env-123",
          "test-token",
        );
      } catch {
        threw = true;
      }
      assertEquals(threw, true);
    } finally {
      await server.shutdown();
    }
  });

  it("rejects malformed entries and unsafe environment variable names", async () => {
    for (
      const data of [
        [{ key: "VALID", value: 42 }],
        [{ key: "__proto__", value: "unsafe" }],
        [{ key: "DUPLICATE", value: "first" }, { key: "DUPLICATE", value: "second" }],
        Array.from({ length: 101 }, (_, index) => ({ key: `KEY_${index}`, value: "value" })),
      ]
    ) {
      await assertRejects(
        () =>
          fetchProjectEnvVars(
            "https://api.veryfront.invalid/api",
            "my-project",
            "env-123",
            "test-token",
            {
              fetchImpl: () => Promise.resolve(Response.json({ data })),
            },
          ),
        VeryfrontError,
      );
    }
  });

  it("rejects oversized response bodies before parsing", async () => {
    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "https://api.veryfront.invalid/api",
          "my-project",
          "env-123",
          "test-token",
          {
            maxResponseBytes: 64,
            fetchImpl: () =>
              Promise.resolve(
                new Response(JSON.stringify({ data: [{ key: "KEY", value: "x".repeat(128) }] }), {
                  headers: { "content-type": "application/json" },
                }),
              ),
          },
        ),
      VeryfrontError,
    );

    assertEquals(error.slug, "network-error");
  });

  it("times out while waiting for response headers", async () => {
    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "https://api.veryfront.invalid/api",
          "my-project",
          "env-123",
          "test-token",
          {
            timeoutMs: 5,
            fetchImpl: (_input, init) =>
              new Promise((_resolve, reject) => {
                const signal = init?.signal;
                if (!(signal instanceof AbortSignal)) {
                  reject(new Error("Missing abort signal"));
                  return;
                }
                signal.addEventListener("abort", () => reject(signal.reason), { once: true });
              }),
          },
        ),
      VeryfrontError,
    );

    assertEquals(error.slug, "timeout-error");
  });

  it("times out and cancels a stalled response body", async () => {
    let bodyCancelled = false;
    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "https://api.veryfront.invalid/api",
          "my-project",
          "env-123",
          "test-token",
          {
            timeoutMs: 5,
            fetchImpl: () =>
              Promise.resolve(
                new Response(
                  new ReadableStream<Uint8Array>({
                    cancel() {
                      bodyCancelled = true;
                    },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              ),
          },
        ),
      VeryfrontError,
    );

    assertEquals(error.slug, "timeout-error");
    assertEquals(bodyCancelled, true);
  });

  it("rejects and cancels response bodies that make no progress", async () => {
    let bodyCancelled = false;
    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "https://api.veryfront.invalid/api",
          "my-project",
          "env-123",
          "test-token",
          {
            fetchImpl: () =>
              Promise.resolve(
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      for (let index = 0; index < 100; index++) {
                        controller.enqueue(new Uint8Array());
                      }
                    },
                    cancel() {
                      bodyCancelled = true;
                    },
                  }),
                  { headers: { "content-type": "application/json" } },
                ),
              ),
          },
        ),
      VeryfrontError,
    );

    assertEquals(error.slug, "network-error");
    assertEquals(bodyCancelled, true);
  });

  it("does not expose a malformed API base URL in validation errors", async () => {
    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "not a URL <REDACTED>",
          "my-project",
          "env-123",
          "test-token",
        ),
      TypeError,
    );

    assertEquals(error.message.includes("<REDACTED>"), false);
  });

  it("honors caller cancellation before starting the request", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    const error = await assertRejects(
      () =>
        fetchProjectEnvVars(
          "https://api.veryfront.invalid/api",
          "my-project",
          "env-123",
          "test-token",
          {
            signal: controller.signal,
            fetchImpl: () => {
              called = true;
              return Promise.resolve(Response.json({ data: [] }));
            },
          },
        ),
      VeryfrontError,
    );

    assertEquals(error.slug, "network-error");
    assertEquals(called, false);
  });
});
