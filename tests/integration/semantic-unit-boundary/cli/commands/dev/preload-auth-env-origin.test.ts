/**
 * `veryfront dev` must not hand a login token to an API origin a repository
 * chose. Proving that needs a real `.env` on disk and the host environment
 * variables the loader reads, so the regression writes files and mutates
 * process state and belongs at the semantic integration boundary rather than
 * beside the hermetic `cli/commands/dev` unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { join } from "veryfront/platform/path";

import { preloadDevAuth } from "../../../../../../cli/commands/dev/command.ts";
import { deleteToken, saveToken } from "../../../../../../cli/auth/token-store.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) deleteEnv(name);
  else setEnv(name, value);
}

describe("dev preload auth env-file origin", () => {
  it("does not preload auth to an API origin selected by a project env file", async () => {
    const envKeys = ["VERYFRONT_API_BASE_URL", "VERYFRONT_API_URL", "XDG_CONFIG_HOME"];
    const savedEnv = envKeys.map((key) => getEnv(key));
    let fetchCalls = 0;

    try {
      deleteEnv("VERYFRONT_API_BASE_URL");
      deleteEnv("VERYFRONT_API_URL");
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        setEnv("XDG_CONFIG_HOME", join(dir, "config"));
        await writeTextFile(
          join(dir, ".env"),
          "VERYFRONT_API_URL=https://project-controlled.example/api\n",
        );
        await loadEnv({ cwd: dir, override: true });
        refreshEnvironmentConfig();
        await saveToken("stored-login-token");

        await withMockFetch(
          (() => {
            fetchCalls += 1;
            return Promise.reject(new Error("must not fetch"));
          }) as typeof fetch,
          async () => {
            assertEquals(await preloadDevAuth("stored-login-token"), {
              identity: null,
              projects: [],
            });
            assertEquals(await preloadDevAuth(undefined, dir), {
              identity: null,
              projects: [],
            });
          },
        );

        await deleteToken();
      }, { prefix: "vf-dev-preload-auth-origin-" });
      assertEquals(fetchCalls, 0);
    } finally {
      __resetEnvLoaderForTests();
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      refreshEnvironmentConfig();
    }
  });

  it("preloads a repository token only to its paired env-file API origin", async () => {
    const envKeys = [
      "VERYFRONT_API_BASE_URL",
      "VERYFRONT_API_URL",
      "VERYFRONT_API_TOKEN",
      "DEV_PRELOAD_TOKEN_BASE",
    ];
    const savedEnv = envKeys.map((key) => getEnv(key));
    const requests: Array<{ origin: string; authorization: string }> = [];

    try {
      envKeys.forEach((key) => deleteEnv(key));
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        await writeTextFile(
          join(dir, ".env"),
          "DEV_PRELOAD_TOKEN_BASE=vf_repository_token\n",
        );
        await writeTextFile(
          join(dir, ".env.local"),
          "VERYFRONT_API_URL=https://project-controlled.example/api\n" +
            "VERYFRONT_API_TOKEN=$DEV_PRELOAD_TOKEN_BASE\n",
        );
        await loadEnv({ cwd: dir, override: true });
        refreshEnvironmentConfig();

        await withMockFetch(
          ((input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            requests.push({
              origin: url.origin,
              authorization: new Headers(init?.headers).get("authorization") ?? "",
            });
            return Promise.resolve(Response.json({ data: [] }));
          }) as typeof fetch,
          async () => {
            assertEquals(await preloadDevAuth("vf_repository_token", dir), {
              identity: { authenticated: true, type: "apiKey" },
              projects: [],
            });
          },
        );
      }, { prefix: "vf-dev-preload-token-origin-" });
      assertEquals(requests, [{
        origin: "https://project-controlled.example",
        authorization: "Bearer vf_repository_token",
      }]);
    } finally {
      __resetEnvLoaderForTests();
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      refreshEnvironmentConfig();
    }
  });
});
