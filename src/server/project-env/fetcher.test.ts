import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import {
  fetchProjectEnvVars,
  PROJECT_ENV_RESPONSE_MAX_BYTES,
  projectEnvFetcherInternals,
} from "#veryfront/server/project-env/fetcher.ts";

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

function responseWithBodyCleanup(
  status: number,
  cancel: () => void | Promise<void>,
): Response {
  const response = new Response("discard me", { status });
  if (!response.body) throw new Error("Expected response body");
  Object.defineProperty(response.body, "cancel", {
    configurable: true,
    value: cancel,
  });
  return response;
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

  it("names missing internal credentials in hosted proxy mode", async () => {
    const previousProxyMode = Deno.env.get("PROXY_MODE");
    const previousLocalProxyMode = Deno.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      paths.push(new URL(req.url).pathname);
      return Response.json({ data: [{ key: "API_KEY", value: "********" }] });
    });

    try {
      Deno.env.set("PROXY_MODE", "1");
      Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
      const error = await assertRejects(() => fetchFromMockApi(port));

      assertEquals((error as { slug?: string }).slug, "config-invalid");
      assertEquals(
        error.message,
        "VERYFRONT_API_INTERNAL_USER and VERYFRONT_API_INTERNAL_PASS must be set in hosted proxy mode",
      );
      assertEquals(paths, ["/projects/my-project/environment-variables"]);
    } finally {
      if (previousProxyMode === undefined) Deno.env.delete("PROXY_MODE");
      else Deno.env.set("PROXY_MODE", previousProxyMode);
      if (previousLocalProxyMode === undefined) {
        Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
      } else {
        Deno.env.set("VERYFRONT_CLI_LOCAL_PROXY_MODE", previousLocalProxyMode);
      }
      await server.shutdown();
    }
  });

  it("keeps local CLI proxy mode on the project-authorized response path", async () => {
    const previousProxyMode = Deno.env.get("PROXY_MODE");
    const previousLocalProxyMode = Deno.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    const { server, port } = createMockServer(() =>
      Response.json({ data: [{ key: "API_KEY", value: "local-value" }] })
    );

    try {
      Deno.env.set("PROXY_MODE", "1");
      Deno.env.set("VERYFRONT_CLI_LOCAL_PROXY_MODE", "1");

      assertEquals(await fetchFromMockApi(port), { API_KEY: "local-value" });
    } finally {
      if (previousProxyMode === undefined) Deno.env.delete("PROXY_MODE");
      else Deno.env.set("PROXY_MODE", previousProxyMode);
      if (previousLocalProxyMode === undefined) {
        Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
      } else {
        Deno.env.set("VERYFRONT_CLI_LOCAL_PROXY_MODE", previousLocalProxyMode);
      }
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

  it("preserves the authorization error when response cleanup throws synchronously", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        responseWithBodyCleanup(403, () => {
          throw new Error("cleanup failed synchronously");
        }),
      )) as typeof fetch;

    try {
      const error = await assertRejects(() =>
        fetchProjectEnvVars(
          "https://api.veryfront.test",
          "my-project",
          "env-123",
          "test-token",
        )
      );
      assertEquals((error as { slug?: string }).slug, "permission-denied");
      assertEquals((error as { status?: number }).status, 403);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the internal request error when response cleanup rejects", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        fetchCount === 1
          ? responseWithBodyCleanup(200, () => Promise.resolve())
          : responseWithBodyCleanup(500, () => Promise.reject(new Error("cleanup rejected"))),
      );
    }) as typeof fetch;

    try {
      const error = await assertRejects(() =>
        withInternalCredentials("runtime-user", "runtime-pass", () =>
          fetchProjectEnvVars(
            "https://api.veryfront.test",
            "my-project",
            "env-123",
            "test-token",
          ))
      );
      assertEquals((error as { slug?: string }).slug, "network-error");
      assertEquals((error as { status?: number }).status, 502);
      assertEquals(fetchCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not wait for response cleanup before the privileged fetch", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    let timeoutId: number | undefined;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        fetchCount === 1
          ? responseWithBodyCleanup(200, () => new Promise<void>(() => {}))
          : Response.json({ data: [{ key: "API_KEY", value: "plaintext-value" }] }),
      );
    }) as typeof fetch;

    try {
      const timeout = Symbol("timeout");
      const deadline = new Promise<typeof timeout>((resolve) => {
        timeoutId = setTimeout(() => resolve(timeout), 100);
      });
      const result = await Promise.race([
        withInternalCredentials("runtime-user", "runtime-pass", () =>
          fetchProjectEnvVars(
            "https://api.veryfront.test",
            "my-project",
            "env-123",
            "test-token",
          )),
        deadline,
      ]);
      assertEquals(result, { API_KEY: "plaintext-value" });
      assertEquals(fetchCount, 2);
    } finally {
      clearTimeout(timeoutId);
      globalThis.fetch = originalFetch;
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

  it("keeps required env fetch headers authoritative over optional Headers input", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ data: [] }));
    }) as typeof fetch;

    try {
      await projectEnvFetcherInternals.fetchEnvironmentVariables(
        "https://api.veryfront.test/internal/project-environment-variables",
        "Basic runtime-secret",
        "my-project",
        "env-123",
        undefined,
        new Headers({
          accept: "text/plain",
          authorization: "Bearer attacker",
          "x-project-slug": "my-project",
        }),
      );
      assertEquals(capturedHeaders?.get("authorization"), "Basic runtime-secret");
      assertEquals(capturedHeaders?.get("accept"), "application/json");
      assertEquals(capturedHeaders?.get("x-project-slug"), "my-project");
    } finally {
      globalThis.fetch = originalFetch;
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
    const originalFetch = globalThis.fetch;
    const paths: string[] = [];
    const controller = new AbortController();
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;

    try {
      const assertion = assertRejects(() =>
        withInternalCredentials("runtime-user", "runtime-pass", () =>
          fetchProjectEnvVars(
            "https://api.veryfront.test",
            "my-project",
            "env-123",
            "test-token",
            controller.signal,
          ))
      );
      controller.abort(new Error("management timeout"));
      const error = await assertion;
      assertInstanceOf(error, Error);
      assertEquals(error.message, "management timeout");
      assertEquals(paths, ["/projects/my-project/environment-variables"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not fall back after the internal request times out", async () => {
    const originalFetch = globalThis.fetch;
    const paths: string[] = [];
    const internalRequestStarted = Promise.withResolvers<void>();
    const controller = new AbortController();
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      paths.push(path);
      if (path === "/projects/my-project/environment-variables") {
        return Promise.resolve(Response.json({ data: [] }));
      }
      internalRequestStarted.resolve();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;

    try {
      const assertion = assertRejects(() =>
        withInternalCredentials("runtime-user", "runtime-pass", () =>
          fetchProjectEnvVars(
            "https://api.veryfront.test",
            "my-project",
            "env-123",
            "test-token",
            controller.signal,
          ))
      );
      await internalRequestStarted.promise;
      controller.abort(new Error("internal timeout"));
      await assertion;
      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
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
