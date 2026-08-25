/**
 * Token storage cloud wiring integration tests.
 *
 * These cases read process environment variables and observe the outbound
 * request the cloud adapter issues during initialization. Both are host
 * effects, so they live here rather than beside the token adapter modules.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createTokenStorageAdapter } from "#veryfront/platform/adapters/token/factory.ts";
import {
  getTokenStorageAdapter,
  resetTokenStorageAdapter,
} from "#veryfront/platform/adapters/token/integration.ts";

interface CapturedRequest {
  readonly urls: string[];
  readonly authorizations: (string | null)[];
}

async function withCapturedFetch(
  action: (captured: CapturedRequest) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const captured: CapturedRequest = { urls: [], authorizations: [] };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    captured.urls.push(String(input));
    captured.authorizations.push(new Headers(init?.headers).get("authorization"));
    return Promise.resolve(Response.json({ keys: [] }));
  }) as typeof fetch;

  try {
    await action(captured);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function deleteEnv(name: string): void {
  try {
    Deno.env.delete(name);
  } catch { /* the host may not allow deleting this variable */ }
}

describe("token storage cloud wiring", () => {
  afterEach(() => {
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    deleteEnv("VERYFRONT_API_URL");
    resetTokenStorageAdapter();
  });

  it("snapshots veryfront options before the async factory body runs", async () => {
    await withCapturedFetch(async (captured) => {
      const options = {
        apiToken: "original-token",
        projectSlug: "test-project",
        apiBaseUrl: "https://original.example.com",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      };

      const pending = createTokenStorageAdapter({ type: "veryfront-api", veryfront: options });
      options.apiToken = "mutated-token";
      options.apiBaseUrl = "https://mutated.example.com";
      const adapter = await pending;
      adapter.dispose?.();

      assertEquals(captured.urls.length, 1, "initialization must issue exactly one ping request");
      assertEquals(
        captured.urls[0]?.startsWith("https://original.example.com") ?? false,
        true,
        "the adapter must use the base URL captured at call time",
      );
      assertEquals(
        captured.authorizations[0],
        "Bearer original-token",
        "the adapter must use the token captured at call time",
      );
    });
  });

  it("wires the cloud adapter to the environment credentials and API base URL", async () => {
    await withCapturedFetch(async (captured) => {
      Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "env-project");
      Deno.env.set("VERYFRONT_API_URL", "https://tokens.example.test");

      await getTokenStorageAdapter();

      assertEquals(
        captured.urls[0],
        "https://tokens.example.test/v1/projects/env-project/tokens",
        "the project slug and API base URL must come from the environment",
      );
      assertEquals(
        captured.authorizations[0],
        "Bearer env-token",
        "the API token must come from VERYFRONT_API_TOKEN",
      );
    });
  });
});
