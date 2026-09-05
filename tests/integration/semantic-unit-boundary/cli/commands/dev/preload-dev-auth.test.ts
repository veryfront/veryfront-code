/**
 * `preloadDevAuth()` credential and destination handling.
 *
 * These cases replace `String.prototype.trim`, mutate the process
 * environment, and write a project `.env` to disk to prove that the dev
 * preload keeps a stored login token off project-reachable readers and sends
 * it only to the host-owned API origin. Prototype and environment mutation are
 * process-global effects, so they live in the semantic integration suite
 * rather than beside the dev unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { saveToken } from "../../../../../../cli/auth/token-store.ts";

import { preloadDevAuth } from "../../../../../../cli/commands/dev/command.ts";

describe("cli/commands/dev preloadDevAuth credential boundary", () => {
  it("preloads project sync from a resolved environment API key", async () => {
    const requests: Array<{ authorization: string; limit: string | null }> = [];
    const originalTrim = String.prototype.trim;
    let tokenObservedByTrim = false;
    let ambientFetchCalled = false;

    try {
      installMockFetch(
        ((input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          requests.push({
            authorization: new Headers(init?.headers).get("authorization") ?? "",
            limit: url.searchParams.get("limit"),
          });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{ id: "project-env", slug: "env-project", name: "Env Project" }],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch,
      );
      String.prototype.trim = function () {
        if (String(this) === "vf_env_secret") tokenObservedByTrim = true;
        return Reflect.apply(originalTrim, this, []);
      };
      // Deliberately the opposite of stubbing: the ambient global is set to a
      // value the host transport does not share, so a call that reached for
      // `globalThis.fetch` instead of the transport is visible. `installMockFetch`
      // above owns the transport and restores this global in `restoreMockFetch`.
      Object.defineProperty(globalThis, "fetch", {
        value: () => {
          ambientFetchCalled = true;
          return Promise.reject(new Error("project fetch must not receive dev auth"));
        },
        configurable: true,
        writable: true,
      });

      const result = await preloadDevAuth("vf_env_secret");

      assertEquals(result.identity, { authenticated: true, type: "apiKey" });
      assertEquals(result.projects, [
        { id: "project-env", slug: "env-project", name: "Env Project" },
      ]);
      assertEquals(requests, [
        { authorization: "Bearer vf_env_secret", limit: null },
      ]);
      assertEquals(tokenObservedByTrim, false);
      assertEquals(ambientFetchCalled, false);
    } finally {
      String.prototype.trim = originalTrim;
      restoreMockFetch();
    }
  });

  it("uses the configured API origin for an environment token", async () => {
    const originalApiUrl = getEnv("VERYFRONT_API_URL");
    const originalApiToken = getEnv("VERYFRONT_API_TOKEN");
    const originalXdgConfigHome = getEnv("XDG_CONFIG_HOME");
    const origins: string[] = [];

    try {
      deleteEnv("VERYFRONT_API_URL");
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        await Deno.writeTextFile(
          `${dir}/.env`,
          "VERYFRONT_API_URL=https://self-hosted.example/api\n" +
            "VERYFRONT_API_TOKEN=vf_self_hosted\n",
        );
        await loadEnv({ cwd: dir, override: true });
        refreshEnvironmentConfig();
        installMockFetch(
          ((input: string | URL | Request) => {
            origins.push(new URL(String(input)).origin);
            return Promise.resolve(Response.json({ data: [] }));
          }) as typeof fetch,
        );

        const result = await preloadDevAuth(undefined, dir);

        // Move to a clean host-only environment and put the second credential
        // in the real token-store path. The current preload API accepts a
        // project directory, not a caller-asserted provenance label.
        deleteEnv("VERYFRONT_API_URL");
        deleteEnv("VERYFRONT_API_TOKEN");
        __resetEnvLoaderForTests();
        setEnv("XDG_CONFIG_HOME", dir);
        refreshEnvironmentConfig();
        await saveToken("vf_stored");
        const storedResult = await preloadDevAuth(undefined, dir);

        assertEquals(result.identity, { authenticated: true, type: "apiKey" });
        assertEquals(storedResult.identity, { authenticated: true, type: "apiKey" });
      });
      assertEquals(origins, [
        "https://self-hosted.example",
        "https://api.veryfront.com",
      ]);
    } finally {
      restoreMockFetch();
      __resetEnvLoaderForTests();
      if (originalApiUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiToken === undefined) deleteEnv("VERYFRONT_API_TOKEN");
      else setEnv("VERYFRONT_API_TOKEN", originalApiToken);
      if (originalXdgConfigHome === undefined) deleteEnv("XDG_CONFIG_HOME");
      else setEnv("XDG_CONFIG_HOME", originalXdgConfigHome);
      refreshEnvironmentConfig();
    }
  });

  it("keeps VERYFRONT_API_URL ahead of VERYFRONT_API_BASE_URL for a stored token", async () => {
    const originalApiUrl = getEnv("VERYFRONT_API_URL");
    const originalApiBaseUrl = getEnv("VERYFRONT_API_BASE_URL");
    const origins: string[] = [];

    try {
      // Both exported by the host, as a self-hosted or staging setup does.
      // resolveCliApiUrl() gives VERYFRONT_API_URL precedence, so the
      // host-owned preload has to send /projects to the same server the CLI
      // would otherwise have used.
      setEnv("VERYFRONT_API_URL", "https://api-url.example.com");
      setEnv("VERYFRONT_API_BASE_URL", "https://base-url.example.com");
      __resetEnvLoaderForTests();
      refreshEnvironmentConfig();
      installMockFetch(
        ((input: string | URL | Request) => {
          origins.push(new URL(String(input)).origin);
          return Promise.resolve(Response.json({ data: [] }));
        }) as typeof fetch,
      );

      await preloadDevAuth("vf_stored", "token-store");

      assertEquals(origins, ["https://api-url.example.com"]);
    } finally {
      restoreMockFetch();
      if (originalApiUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalApiUrl);
      if (originalApiBaseUrl === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      __resetEnvLoaderForTests();
      refreshEnvironmentConfig();
    }
  });
});
