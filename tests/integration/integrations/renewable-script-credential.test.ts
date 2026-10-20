import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { getRemoteIntegrationToolDiscovery } from "../../../src/integrations/remote-tools.ts";

it("reads the renewable script credential file for each first-party API request", async () => {
  const directory = await Deno.makeTempDir({ prefix: "vf-sdk-renewable-token-" });
  const path = `${directory}/token`;
  const keys = [
    "VERYFRONT_API_BASE_URL",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_TOKEN_FILE",
    "PROXY_MODE",
  ];
  const previous = keys.map((key) => [key, getEnv(key)] as const);
  const authorizations: Array<string | null> = [];
  try {
    await Deno.writeTextFile(path, "child-invocation-1\n");
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");
    setEnv("VERYFRONT_API_TOKEN_FILE", path);
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("PROXY_MODE");
    refreshEnvironmentConfig();
    await withMockFetch((input, init) => {
      authorizations.push(new Request(input, init).headers.get("Authorization"));
      return Promise.resolve(Response.json({ tools: [] }));
    }, async () => {
      await getRemoteIntegrationToolDiscovery();
      await Deno.writeTextFile(path, "child-invocation-2\n");
      await getRemoteIntegrationToolDiscovery();
    });
    assertEquals(authorizations, ["Bearer child-invocation-1", "Bearer child-invocation-2"]);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
    refreshEnvironmentConfig();
    await Deno.remove(directory, { recursive: true });
  }
});
