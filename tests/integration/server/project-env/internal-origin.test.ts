import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { fetchProjectEnvVars } from "#veryfront/server/project-env/fetcher.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";

describe("project environment internal origin", () => {
  it("uses the host internal origin for each fresh credential and ignores tenant overrides", async () => {
    const keys = [
      "VERYFRONT_API_INTERNAL_URL",
      "VERYFRONT_API_INTERNAL_USER",
      "VERYFRONT_API_INTERNAL_PASS",
    ];
    const previous = keys.map((key) => Deno.env.get(key));
    const requests: Array<{ origin: string; authorization: string | null }> = [];
    try {
      Deno.env.set(keys[0]!, "http://api.internal.test");
      Deno.env.set(keys[1]!, "test-user");
      Deno.env.set(keys[2]!, "test-pass");
      await withMockFetch(
        (async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : input);
          requests.push({
            origin: url.origin,
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return Response.json({ data: [] });
        }) as typeof fetch,
        async () => {
          await runWithProjectEnv(
            { VERYFRONT_API_INTERNAL_URL: "https://tenant.example.test" },
            async () => {
              for (const token of ["fresh-credential-1", "fresh-credential-2"]) {
                await fetchProjectEnvVars(
                  "https://public-api.example.test",
                  "my-project",
                  "env-1",
                  token,
                );
              }
            },
          );
        },
      );
      assertEquals(
        requests.map((request) => request.origin),
        Array(4).fill("http://api.internal.test"),
      );
      assertEquals(requests[0]?.authorization, "Bearer fresh-credential-1");
      assertEquals(requests[2]?.authorization, "Bearer fresh-credential-2");
      assertEquals(requests[1]?.authorization?.startsWith("Basic "), true);
    } finally {
      keys.forEach((key, index) => {
        const value = previous[index];
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      });
    }
  });

  it("treats a blank host internal origin as unset", async () => {
    const keys = [
      "VERYFRONT_API_INTERNAL_URL",
      "VERYFRONT_API_INTERNAL_USER",
      "VERYFRONT_API_INTERNAL_PASS",
    ];
    const previous = keys.map((key) => Deno.env.get(key));
    try {
      Deno.env.set(keys[1]!, "test-user");
      Deno.env.set(keys[2]!, "test-pass");
      for (const blank of ["", "   "]) {
        Deno.env.set(keys[0]!, blank);
        const urls: string[] = [];
        await withMockFetch(
          (async (input) => {
            urls.push(input instanceof Request ? input.url : String(input));
            return Response.json({ data: [] });
          }) as typeof fetch,
          () =>
            fetchProjectEnvVars(
              "https://public-api.example.test",
              "my-project",
              "env-1",
              "fresh-credential",
            ),
        );
        assertEquals(
          urls.map((url) => new URL(url).origin),
          ["https://public-api.example.test", "https://public-api.example.test"],
          `VERYFRONT_API_INTERNAL_URL=${JSON.stringify(blank)} must fall back to the API base URL`,
        );
      }
    } finally {
      keys.forEach((key, index) => {
        const value = previous[index];
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      });
    }
  });
});
