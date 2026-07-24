import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { fetchProjectEnvVars, MAX_PROJECT_ENV_RESPONSE_BYTES } from "./fetcher.ts";
import { VeryfrontError } from "#veryfront/errors";
import { PROJECT_ENV_SNAPSHOT_LIMITS } from "./snapshot.ts";

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
      ),
  );
}

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

  it("handles missing data field in response", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({});
    });

    try {
      const result = await fetchFromMockApi(port);

      assertEquals(result, {});
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

  it("uses the internal endpoint when Basic auth credentials are configured", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);

      if (url.pathname === "/projects/my-project/environment-variables") {
        assertEquals(req.headers.get("authorization"), "Bearer test-token");
        return Response.json({ data: [{ key: "API_KEY", value: "********" }] });
      }

      assertEquals(url.pathname, "/internal/project-environment-variables");
      assertEquals(url.searchParams.get("environment_id"), "env-123");
      assertEquals(url.searchParams.get("project_slug"), "my-project");
      assertEquals(
        req.headers.get("authorization"),
        `Basic ${btoa("runtime-user:runtime-pass")}`,
      );
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

  it("falls back to the management endpoint when the internal endpoint is absent", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);
      paths.push(url.pathname);

      if (url.pathname === "/internal/project-environment-variables") {
        assertEquals(
          req.headers.get("authorization"),
          `Basic ${btoa("runtime-user:runtime-pass")}`,
        );
        return new Response(null, { status: 404 });
      }

      assertEquals(req.headers.get("authorization"), "Bearer test-token");
      return Response.json({ data: [{ key: "API_KEY", value: "legacy-plaintext" }] });
    });

    try {
      const result = await fetchFromMockApi(port, {
        username: "runtime-user",
        password: "runtime-pass",
      });

      assertEquals(paths, [
        "/projects/my-project/environment-variables",
        "/internal/project-environment-variables",
      ]);
      assertEquals(result, { API_KEY: "legacy-plaintext" });
    } finally {
      await server.shutdown();
    }
  });

  it("does not fall back when the internal endpoint rejects the request", async () => {
    let requestCount = 0;
    const { server, port } = createMockServer((req: Request) => {
      requestCount++;
      const pathname = new URL(req.url).pathname;
      if (pathname === "/projects/my-project/environment-variables") {
        assertEquals(req.headers.get("authorization"), "Bearer test-token");
        return Response.json({ data: [] });
      }
      assertEquals(pathname, "/internal/project-environment-variables");
      assertEquals(
        req.headers.get("authorization"),
        `Basic ${btoa("runtime-user:runtime-pass")}`,
      );
      return new Response(null, { status: 401 });
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );
      assertEquals(requestCount, 2);
    } finally {
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

  it("does not use privileged credentials until project/environment association succeeds", async () => {
    const paths: string[] = [];
    const { server, port } = createMockServer((req: Request) => {
      paths.push(new URL(req.url).pathname);
      return new Response(null, { status: 404 });
    });

    try {
      await assertRejects(() =>
        fetchFromMockApi(port, {
          username: "runtime-user",
          password: "runtime-pass",
        })
      );
      assertEquals(paths, ["/projects/my-project/environment-variables"]);
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

  it("rejects malformed, duplicate, and oversized responses", async () => {
    const responses = [
      () => Response.json({ data: {} }),
      () => Response.json({ data: [{ key: "VALID", value: 1 }] }),
      () =>
        Response.json({
          data: [
            { key: "DUPLICATE", value: "first" },
            { key: "DUPLICATE", value: "second" },
          ],
        }),
      () => new Response("x".repeat(MAX_PROJECT_ENV_RESPONSE_BYTES + 1)),
    ];

    for (const createResponse of responses) {
      const { server, port } = createMockServer(createResponse);
      try {
        await assertRejects(() => fetchFromMockApi(port));
      } finally {
        await server.shutdown();
      }
    }
  });

  it("normalizes invalid UTF-8 into a stable network boundary error", async () => {
    const { server, port } = createMockServer(() => new Response(new Uint8Array([0xc3, 0x28])));

    try {
      const error = await assertRejects(
        () => fetchFromMockApi(port),
        VeryfrontError,
        "Project environment response is not valid UTF-8",
      ) as VeryfrontError;
      assertEquals(error.slug, "network-error");
    } finally {
      await server.shutdown();
    }
  });

  it("normalizes transport and snapshot failures into network errors", async () => {
    const transportCause = new Error("socket failed");
    const transportError = await withInternalCredentials(
      undefined,
      undefined,
      async () =>
        await assertRejects(
          () =>
            fetchProjectEnvVars(
              "https://api.example",
              "project",
              "environment",
              "token",
              { fetch: () => Promise.reject(transportCause) },
            ),
          VeryfrontError,
          "Failed to fetch project environment variables",
        ) as VeryfrontError,
    );
    assertEquals(transportError.slug, "network-error");
    assertEquals(transportError.cause, transportCause);

    const validationError = await withInternalCredentials(
      undefined,
      undefined,
      async () =>
        await assertRejects(
          () =>
            fetchProjectEnvVars(
              "https://api.example",
              "project",
              "environment",
              "token",
              {
                fetch: () =>
                  Promise.resolve(
                    Response.json({ data: [{ key: "BAD=KEY", value: "value" }] }),
                  ),
              },
            ),
          VeryfrontError,
          "Project environment response failed validation",
        ) as VeryfrontError,
    );
    assertEquals(validationError.slug, "network-error");
  });

  it("uses a captured Uint8Array brand check for response chunks", async () => {
    const response = Response.json({
      data: [{ key: "SECRET", value: "sensitive-value" }],
    });
    const original = Object.getOwnPropertyDescriptor(globalThis, "Uint8Array");
    let poisonedBrandChecks = 0;
    const PoisonedUint8Array = function () {};
    Object.defineProperty(PoisonedUint8Array, Symbol.hasInstance, {
      value: () => {
        poisonedBrandChecks += 1;
        return true;
      },
    });

    let result: Record<string, string> | undefined;
    try {
      Object.defineProperty(globalThis, "Uint8Array", {
        configurable: true,
        writable: true,
        value: PoisonedUint8Array,
      });
      result = await withInternalCredentials(undefined, undefined, () =>
        fetchProjectEnvVars(
          "https://api.example",
          "project",
          "environment",
          "token",
          { fetch: () => Promise.resolve(response) },
        ));
    } finally {
      if (original) Object.defineProperty(globalThis, "Uint8Array", original);
    }

    assertEquals(result, { SECRET: "sensitive-value" });
    assertEquals(poisonedBrandChecks, 0);
  });

  it("accepts a snapshot-valid response at worst-case JSON escaping", async () => {
    const key = "KEY";
    const value = "\u0001".repeat(
      PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes - key.length,
    );
    const result = await withInternalCredentials(undefined, undefined, () =>
      fetchProjectEnvVars(
        "https://api.example",
        "project",
        "environment",
        "token",
        {
          fetch: () =>
            Promise.resolve(
              Response.json({ data: [{ key, value }] }),
            ),
        },
      ));

    assertEquals(result.KEY?.length, value.length);
  });

  it("returns a frozen null-prototype environment snapshot", async () => {
    const { server, port } = createMockServer(() =>
      Response.json({
        data: [
          { key: "__proto__", value: "inert" },
          { key: "API_KEY", value: "secret" },
        ],
      })
    );

    try {
      const result = await fetchFromMockApi(port);
      assertEquals(result.API_KEY, "secret");
      assertEquals(result.__proto__, "inert");
      assertEquals(Reflect.ownKeys(result), ["API_KEY", "__proto__"]);
      assertEquals(Object.getPrototypeOf(result), null);
      assertEquals(Object.isFrozen(result), true);
    } finally {
      await server.shutdown();
    }
  });
});
