import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import { fetchProjectEnvVars } from "./fetcher.ts";

const ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_CLI_LOCAL_PROXY_MODE",
  "VERYFRONT_API_INTERNAL_USER",
  "VERYFRONT_API_INTERNAL_PASS",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));
const originalFetch = globalThis.fetch;

function restoreEnvironment(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
}

describe("hosted project environment authorization", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  });

  it("fails with a configuration error when hosted credentials are missing", async () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    deleteEnv("VERYFRONT_API_INTERNAL_USER");
    deleteEnv("VERYFRONT_API_INTERNAL_PASS");
    const urls: string[] = [];
    globalThis.fetch = ((input) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(
        Response.json({ data: [{ key: "API_KEY", value: "********" }] }),
      );
    }) as typeof fetch;

    const error = await assertRejects(() =>
      fetchProjectEnvVars(
        "https://api.veryfront.test",
        "my-project",
        "env-123",
        "test-token",
      )
    );

    assertEquals((error as { slug?: string }).slug, "config-invalid");
    assertEquals(
      (error as Error).message,
      "VERYFRONT_API_INTERNAL_USER and VERYFRONT_API_INTERNAL_PASS must be set in hosted proxy mode",
    );
    assertEquals(urls.length, 1);
    assertEquals(new URL(urls[0]!).pathname, "/projects/my-project/environment-variables");
  });

  it("uses the internal endpoint after project authorization", async () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    setEnv("VERYFRONT_API_INTERNAL_USER", "test-internal-user");
    setEnv("VERYFRONT_API_INTERNAL_PASS", "test-internal-pass");
    const requests: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = ((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      const data = requests.length === 1
        ? [{ key: "API_KEY", value: "********" }]
        : [{ key: "API_KEY", value: "hosted-value" }];
      return Promise.resolve(Response.json({ data }));
    }) as typeof fetch;

    assertEquals(
      await fetchProjectEnvVars(
        "https://api.veryfront.test",
        "my-project",
        "env-123",
        "test-token",
      ),
      { API_KEY: "hosted-value" },
    );
    assertEquals(requests.length, 2);
    assertEquals(
      new URL(requests[1]!.url).pathname,
      "/internal/project-environment-variables",
    );
    assertEquals(requests[0]!.authorization, "Bearer test-token");
    assertEquals(requests[1]!.authorization?.startsWith("Basic "), true);
  });

  it("keeps local CLI proxy mode on the project-authorized response path", async () => {
    setEnv("PROXY_MODE", "1");
    setEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE", "1");
    deleteEnv("VERYFRONT_API_INTERNAL_USER");
    deleteEnv("VERYFRONT_API_INTERNAL_PASS");
    let requestCount = 0;
    globalThis.fetch = (() => {
      requestCount++;
      return Promise.resolve(
        Response.json({ data: [{ key: "API_KEY", value: "local-value" }] }),
      );
    }) as typeof fetch;

    assertEquals(
      await fetchProjectEnvVars(
        "https://api.veryfront.test",
        "my-project",
        "env-123",
        "test-token",
      ),
      { API_KEY: "local-value" },
    );
    assertEquals(requestCount, 1);
  });
});
