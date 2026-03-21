import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { executeEndpoint, validateEndpointUrl } from "./endpoint-executor.ts";
import type { IntegrationEndpoint } from "./types.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

Deno.test("validateEndpointUrl", async (t) => {
  // Valid URLs
  await t.step("accepts valid HTTPS URL", () => {
    validateEndpointUrl("https://api.example.com/v1/data");
  });

  await t.step("accepts HTTPS URL with port", () => {
    validateEndpointUrl("https://api.example.com:8443/v1/data");
  });

  await t.step("accepts HTTPS URL with query params", () => {
    validateEndpointUrl("https://api.example.com/v1?key=value");
  });

  // Invalid schemes
  await t.step("rejects HTTP URLs", () => {
    assertThrows(
      () => validateEndpointUrl("http://api.example.com/v1"),
      VeryfrontError,
      "must use HTTPS",
    );
  });

  await t.step("rejects FTP URLs", () => {
    assertThrows(
      () => validateEndpointUrl("ftp://files.example.com/data"),
      VeryfrontError,
      "must use HTTPS",
    );
  });

  await t.step("rejects invalid URLs", () => {
    assertThrows(
      () => validateEndpointUrl("not-a-url"),
      VeryfrontError,
      "Invalid endpoint URL",
    );
  });

  // Localhost
  await t.step("rejects localhost", () => {
    assertThrows(
      () => validateEndpointUrl("https://localhost/api"),
      VeryfrontError,
      "must not target localhost",
    );
  });

  await t.step("rejects localhost with port", () => {
    assertThrows(
      () => validateEndpointUrl("https://localhost:3000/api"),
      VeryfrontError,
      "must not target localhost",
    );
  });

  // Private IPv4 ranges
  await t.step("rejects 127.0.0.1 (loopback)", () => {
    assertThrows(
      () => validateEndpointUrl("https://127.0.0.1/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects 10.x.x.x (class A private)", () => {
    assertThrows(
      () => validateEndpointUrl("https://10.0.0.1/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects 172.16.x.x (class B private)", () => {
    assertThrows(
      () => validateEndpointUrl("https://172.16.0.1/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects 172.31.x.x (class B upper bound)", () => {
    assertThrows(
      () => validateEndpointUrl("https://172.31.255.255/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("allows 172.32.x.x (outside private range)", () => {
    validateEndpointUrl("https://172.32.0.1/api");
  });

  await t.step("rejects 192.168.x.x (class C private)", () => {
    assertThrows(
      () => validateEndpointUrl("https://192.168.1.1/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects 169.254.x.x (link-local)", () => {
    assertThrows(
      () => validateEndpointUrl("https://169.254.169.254/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects 0.x.x.x", () => {
    assertThrows(
      () => validateEndpointUrl("https://0.0.0.0/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  // IPv6
  await t.step("rejects ::1 (IPv6 loopback)", () => {
    assertThrows(
      () => validateEndpointUrl("https://[::1]/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects fc00:: (IPv6 unique local)", () => {
    assertThrows(
      () => validateEndpointUrl("https://[fc00::1]/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects fd12:: (IPv6 unique local)", () => {
    assertThrows(
      () => validateEndpointUrl("https://[fd12::1]/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  await t.step("rejects fe80:: (IPv6 link-local)", () => {
    assertThrows(
      () => validateEndpointUrl("https://[fe80::1]/api"),
      VeryfrontError,
      "private/internal",
    );
  });

  // False positive avoidance
  await t.step("allows fdic.gov (legitimate domain starting with fd)", () => {
    validateEndpointUrl("https://fdic.gov/api");
  });

  await t.step("allows fdroid.org (legitimate domain starting with fd)", () => {
    validateEndpointUrl("https://fdroid.org/api");
  });

  await t.step("allows fc-example.com (legitimate domain starting with fc)", () => {
    validateEndpointUrl("https://fc-example.com/api");
  });
});

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
