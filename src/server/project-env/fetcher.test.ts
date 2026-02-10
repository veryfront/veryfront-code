import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../../tests/_helpers/utils.ts";
import { fetchProjectEnvVars } from "./fetcher.ts";

describe("project-env/fetcher", () => {
  it("fetches and transforms env vars from API", async () => {
    const { server, port } = createMockServer((req: Request) => {
      const url = new URL(req.url);

      assertEquals(url.pathname, "/projects/my-project/env-vars");
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

  it("handles missing data field in response", async () => {
    const { server, port } = createMockServer(() => {
      return Response.json({});
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
});
