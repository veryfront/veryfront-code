import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { fetchProjectEnvVars, PROJECT_ENV_RESPONSE_MAX_BYTES } from "./fetcher.ts";

const INTERNAL_USER_ENV = "VERYFRONT_API_INTERNAL_USER";
const INTERNAL_PASS_ENV = "VERYFRONT_API_INTERNAL_PASS";

async function withInternalCredentials<T>(
  username: string | undefined,
  password: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previousUser = Deno.env.get(INTERNAL_USER_ENV);
  const previousPass = Deno.env.get(INTERNAL_PASS_ENV);

  try {
    if (username === undefined) Deno.env.delete(INTERNAL_USER_ENV);
    else Deno.env.set(INTERNAL_USER_ENV, username);
    if (password === undefined) Deno.env.delete(INTERNAL_PASS_ENV);
    else Deno.env.set(INTERNAL_PASS_ENV, password);
    return await fn();
  } finally {
    if (previousUser === undefined) Deno.env.delete(INTERNAL_USER_ENV);
    else Deno.env.set(INTERNAL_USER_ENV, previousUser);
    if (previousPass === undefined) Deno.env.delete(INTERNAL_PASS_ENV);
    else Deno.env.set(INTERNAL_PASS_ENV, previousPass);
  }
}

function fetchFromMockApi(
  port: number,
  credentials?: { username: string; password: string },
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  return withInternalCredentials(
    credentials?.username,
    credentials?.password,
    () =>
      fetchProjectEnvVars(
        `http://127.0.0.1:${port}`,
        "my-project",
        "env-123",
        "test-token",
        signal,
      ),
  );
}

describe("project-env/fetcher", () => {
  it("maps unknown transport failures to typed 502 semantics", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;

    try {
      const error = await assertRejects(() =>
        fetchProjectEnvVars(
          "https://api.veryfront.test",
          "my-project",
          "env-123",
          "test-token",
        )
      );
      assertEquals((error as { slug?: string }).slug, "network-error");
      assertEquals((error as { status?: number }).status, 502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
      const result = await fetchFromMockApi(port);

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
      const result = await fetchFromMockApi(port);

      assertEquals(result, {});
    } finally {
      await server.shutdown();
    }
  });

  it("rejects a missing data field instead of substituting an empty environment", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({});
    });

    try {
      const error = await assertRejects(() => fetchFromMockApi(port));
      assertEquals((error as { slug?: string }).slug, "network-error");
    } finally {
      await server.shutdown();
    }
  });

  it("throws on non-200 response", async () => {
    const { server, port } = createMockServer(() => {
      return new Response("Unauthorized", { status: 401 });
    });

    try {
      await assertRejects(() => fetchFromMockApi(port));
    } finally {
      await server.shutdown();
    }
  });

  it("normalizes project authorization failures without exposing upstream status", async () => {
    const { server, port } = createMockServer(() => {
      return new Response("tenant-specific upstream detail", { status: 403 });
    });

    try {
      const error = await assertRejects(() => fetchFromMockApi(port));
      assertEquals((error as { slug?: string }).slug, "permission-denied");
      assertEquals(
        (error as Error).message,
        "Project credential is not authorized for the requested environment",
      );
    } finally {
      await server.shutdown();
    }
  });

  it("rejects management redirects without following them", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);
      if (url.pathname === "/redirect-target") {
        return Response.json({ data: [{ key: "LEAK", value: "followed" }] });
      }
      return new Response(null, {
        status: 302,
        headers: { location: `http://127.0.0.1:${port}/redirect-target` },
      });
    });

    try {
      await assertRejects(() => fetchFromMockApi(port));
      assertEquals(paths, ["/projects/my-project/environment-variables"]);
    } finally {
      await server.shutdown();
    }
  });

  it("authorizes the canonical project before using host-level internal credentials", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);

      if (url.pathname === "/projects/my-project/environment-variables") {
        assertEquals(url.searchParams.get("environment_id"), "env-123");
        assertEquals(req.headers.get("authorization"), "Bearer test-token");
        return Response.json({ data: [{ key: "API_KEY", value: "********" }] });
      }

      assertEquals(url.pathname, "/internal/project-environment-variables");
      assertEquals(url.searchParams.get("environment_id"), "env-123");
      assertEquals(url.searchParams.get("project_slug"), "my-project");
      assertEquals(req.headers.get("x-project-slug"), "my-project");
      assertEquals(req.headers.get("authorization"), `Basic ${btoa("runtime-user:runtime-pass")}`);

      return Response.json({ data: [{ key: "API_KEY", value: "plaintext-value" }] });
    });

    try {
      const result = await fetchFromMockApi(port, {
        username: "runtime-user",
        password: "runtime-pass",
      });

      assertEquals(result, { API_KEY: "plaintext-value" });
      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
    } finally {
      await server.shutdown();
    }
  });

  it("fails closed when the configured internal endpoint is absent", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);

      if (url.pathname === "/projects/my-project/environment-variables") {
        assertEquals(req.headers.get("authorization"), "Bearer test-token");
        return Response.json({ data: [] });
      }

      if (url.pathname === "/internal/project-environment-variables") {
        assertEquals(
          req.headers.get("authorization"),
          `Basic ${btoa("runtime-user:runtime-pass")}`,
        );
        return new Response(null, { status: 404 });
      }

      throw new Error(`Unexpected path: ${url.pathname}`);
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );

      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
    } finally {
      await server.shutdown();
    }
  });

  it("rejects internal redirects without following them or falling back", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);
      if (url.pathname === "/projects/my-project/environment-variables") {
        return Response.json({ data: [] });
      }
      if (url.pathname === "/internal/project-environment-variables") {
        return new Response(null, {
          status: 302,
          headers: { location: `http://127.0.0.1:${port}/redirect-target` },
        });
      }
      return Response.json({ data: [{ key: "LEAK", value: "followed" }] });
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );
      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
    } finally {
      await server.shutdown();
    }
  });

  it("does not use internal credentials when project authorization is denied", async () => {
    let requestCount = 0;
    const { server, port } = createMockServer((req: Request) => {
      requestCount++;
      assertEquals(new URL(req.url).pathname, "/projects/my-project/environment-variables");
      assertEquals(req.headers.get("authorization"), "Bearer test-token");
      return new Response(null, { status: 403 });
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );
      assertEquals(requestCount, 1);
    } finally {
      await server.shutdown();
    }
  });

  it("does not call the internal endpoint after management authorization times out", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer(async (req: Request) => {
      paths.push(new URL(req.url).pathname);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return Response.json({ data: [] });
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("management timeout")), 10);

    try {
      const error = await assertRejects(() =>
        fetchFromMockApi(
          port,
          { username: "runtime-user", password: "runtime-pass" },
          controller.signal,
        )
      );
      assertEquals(error.message, "management timeout");
      assertEquals(paths, ["/projects/my-project/environment-variables"]);
    } finally {
      clearTimeout(timeoutId);
      await server.shutdown();
    }
  });

  it("does not fall back after the internal request times out", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer(async (req: Request) => {
      const path = new URL(req.url).pathname;
      paths.push(path);
      if (path === "/projects/my-project/environment-variables") {
        return Response.json({ data: [] });
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
      return Response.json({ data: [{ key: "API_KEY", value: "late" }] });
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("internal timeout")), 10);

    try {
      await assertRejects(() =>
        fetchFromMockApi(
          port,
          { username: "runtime-user", password: "runtime-pass" },
          controller.signal,
        )
      );
      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
    } finally {
      clearTimeout(timeoutId);
      await server.shutdown();
    }
  });

  it("rejects masked values returned by the internal endpoint", async () => {
    const { server, port } = createMockServer((req: Request) => {
      if (new URL(req.url).pathname === "/projects/my-project/environment-variables") {
        return Response.json({ data: [] });
      }
      return Response.json({ data: [{ key: "API_KEY", value: "********" }] });
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );
    } finally {
      await server.shutdown();
    }
  });

  it("rejects masked values returned by the management endpoint", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({ data: [{ key: "API_KEY", value: "********" }] });
    });

    try {
      await assertRejects(() => fetchFromMockApi(port));
    } finally {
      await server.shutdown();
    }
  });

  it("rejects malformed and duplicate environment entries", async () => {
    const responses: unknown[] = [
      { data: "not-an-array" },
      { data: [null] },
      { data: [{ key: "VALID", value: 123 }] },
      { data: [{ key: "DUP", value: "one" }, { key: "DUP", value: "two" }] },
      { data: Array.from({ length: 101 }, (_, index) => ({ key: `KEY_${index}`, value: "x" })) },
    ];
    const { server, port } = createMockServer(() => Response.json(responses.shift()));

    try {
      for (let index = 0; index < 5; index += 1) {
        const error = await assertRejects(() => fetchFromMockApi(port));
        assertEquals((error as { slug?: string }).slug, "network-error");
      }
    } finally {
      await server.shutdown();
    }
  });

  it("bounds streamed environment responses before JSON parsing", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let emittedBytes = 0;
    const { server, port } = createMockServer(() => {
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (emittedBytes > PROJECT_ENV_RESPONSE_MAX_BYTES) {
              controller.close();
              return;
            }
            emittedBytes += chunk.byteLength;
            controller.enqueue(chunk);
          },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    });

    try {
      const error = await assertRejects(() => fetchFromMockApi(port));
      assertEquals((error as { slug?: string }).slug, "network-error");
      assertEquals(emittedBytes <= PROJECT_ENV_RESPONSE_MAX_BYTES + chunk.byteLength * 2, true);
    } finally {
      await server.shutdown();
    }
  });
});
