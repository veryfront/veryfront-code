import { assertEquals } from "@std/assert";
import { clearConnectorCache, fetchConnector } from "./connector-fetcher.ts";
import type { IntegrationConnector } from "./types.ts";

const mockConnector: IntegrationConnector = {
  name: "github",
  display_name: "GitHub",
  description: "GitHub integration",
  auth: { type: "oauth2", provider: "github" },
  tools: [
    {
      id: "list-repos",
      name: "List Repositories",
      description: "List repos",
      requires_write: false,
      endpoint: {
        method: "GET",
        url: "https://api.github.com/user/repos",
      },
    },
  ],
};

Deno.test("connector-fetcher", async (t) => {
  await t.step("fetches connector from API", async () => {
    clearConnectorCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      assertEquals(url, "https://api.example.com/integrations/github");
      return new Response(JSON.stringify(mockConnector), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const result = await fetchConnector("github", "https://api.example.com");
      assertEquals(result?.name, "github");
      assertEquals(result?.tools.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("returns cached connector on second call", async () => {
    clearConnectorCache();

    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify(mockConnector), {
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await fetchConnector("github", "https://api.example.com");
      await fetchConnector("github", "https://api.example.com");
      assertEquals(fetchCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("returns null for 404", async () => {
    clearConnectorCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });

    try {
      const result = await fetchConnector("nonexistent", "https://api.example.com");
      assertEquals(result, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("returns null on network error", async () => {
    clearConnectorCache();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Network error");
    };

    try {
      const result = await fetchConnector("github", "https://api.example.com");
      assertEquals(result, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("includes auth header when token provided", async () => {
    clearConnectorCache();

    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string> ?? {}),
      );
      return new Response(JSON.stringify(mockConnector));
    };

    try {
      await fetchConnector("github", "https://api.example.com", "my-token");
      assertEquals(capturedHeaders.Authorization, "Bearer my-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
