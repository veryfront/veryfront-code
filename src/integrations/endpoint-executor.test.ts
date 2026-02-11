import { assertEquals, assertRejects } from "@std/assert";
import { executeEndpoint } from "./endpoint-executor.ts";
import type { IntegrationEndpoint } from "./types.ts";

Deno.test("endpoint-executor", async (t) => {
  await t.step("REST: builds URL with path params", async () => {
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: "https://api.example.com/repos/{owner}/{repo}/issues",
      params: {
        owner: { type: "string", in: "path", description: "Owner", required: true },
        repo: { type: "string", in: "path", description: "Repo", required: true },
      },
    };

    // Mock fetch
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ items: [] }), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await executeEndpoint(
        endpoint,
        { owner: "octocat", repo: "hello-world" },
        "test-token",
        { integration: "github", toolId: "list-issues" },
      );

      assertEquals(capturedUrl, "https://api.example.com/repos/octocat/hello-world/issues");
      assertEquals(result.status, 200);
      assertEquals(result.result, { items: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("REST: adds query params", async () => {
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: "https://api.example.com/search",
      params: {
        q: { type: "string", in: "query", description: "Query" },
        per_page: { type: "number", in: "query", description: "Per page" },
      },
    };

    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await executeEndpoint(
        endpoint,
        { q: "test", per_page: 10 },
        "test-token",
        { integration: "github", toolId: "search" },
      );

      const url = new URL(capturedUrl);
      assertEquals(url.searchParams.get("q"), "test");
      assertEquals(url.searchParams.get("per_page"), "10");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("REST: sends body for POST", async () => {
    const endpoint: IntegrationEndpoint = {
      method: "POST",
      url: "https://api.example.com/issues",
      body: {
        title: { type: "string", description: "Title", required: true },
        body: { type: "string", description: "Body" },
      },
    };

    const originalFetch = globalThis.fetch;
    let capturedBody = "";
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: 1 }), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await executeEndpoint(
        endpoint,
        { title: "Bug", body: "Fix needed" },
        "test-token",
        { integration: "github", toolId: "create-issue" },
      );

      assertEquals(JSON.parse(capturedBody), { title: "Bug", body: "Fix needed" });
      assertEquals(result.result, { id: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("REST: applies response transform", async () => {
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: "https://slack.com/api/conversations.list",
      response: { transform: "channels" },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: true, channels: [{ id: "C1" }] }), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await executeEndpoint(
        endpoint,
        {},
        "test-token",
        { integration: "slack", toolId: "list-channels" },
      );

      assertEquals(result.result, [{ id: "C1" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("REST: throws on missing path param", async () => {
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: "https://api.example.com/repos/{owner}",
      params: {
        owner: { type: "string", in: "path", description: "Owner", required: true },
      },
    };

    await assertRejects(
      () => executeEndpoint(endpoint, {}, "test-token", { integration: "test", toolId: "test" }),
      Error,
      "Missing required path parameter: owner",
    );
  });

  await t.step("GraphQL: sends query with variables", async () => {
    const endpoint: IntegrationEndpoint = {
      type: "graphql",
      method: "POST",
      url: "https://api.github.com/graphql",
      query: "query($owner: String!) { repository(owner: $owner) { name } }",
      params: {
        owner: { type: "string", in: "body", description: "Owner" },
      },
    };

    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ data: { repository: { name: "test" } } }), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await executeEndpoint(
        endpoint,
        { owner: "octocat" },
        "test-token",
        { integration: "github", toolId: "get-repo" },
      );

      assertEquals(capturedBody.query, endpoint.query);
      assertEquals(capturedBody.variables, { owner: "octocat" });
      assertEquals(result.result, { repository: { name: "test" } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("GraphQL: throws on missing query", async () => {
    const endpoint: IntegrationEndpoint = {
      type: "graphql",
      method: "POST",
      url: "https://api.github.com/graphql",
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}");

    try {
      await assertRejects(
        () => executeEndpoint(endpoint, {}, "token", { integration: "github", toolId: "test" }),
        Error,
        "missing query",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
