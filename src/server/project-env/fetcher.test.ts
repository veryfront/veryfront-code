import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { fetchProjectEnvVars } from "./fetcher.ts";

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
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);

      assertEquals(url.pathname, "/internal/project-environment-variables");
      assertEquals(url.searchParams.get("environment_id"), "env-123");
      assertEquals(req.headers.get("authorization"), `Basic ${btoa("runtime-user:runtime-pass")}`);

      return Response.json({ data: [{ key: "API_KEY", value: "plaintext-value" }] });
    });

    try {
      const result = await fetchFromMockApi(port, {
        username: "runtime-user",
        password: "runtime-pass",
      });

      assertEquals(result, { API_KEY: "plaintext-value" });
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
        "/internal/project-environment-variables",
        "/projects/my-project/environment-variables",
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
      assertEquals(new URL(req.url).pathname, "/internal/project-environment-variables");
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
      assertEquals(requestCount, 1);
    } finally {
      await server.shutdown();
    }
  });

  it("rejects masked values returned by the internal endpoint", async () => {
    const { server, port } = createMockServer(() => {
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
});
