/**
 * The remote file MCP tools must not send a shell-supplied token to an API
 * origin a repository's `.env` chose. Proving that needs a real env file on
 * disk plus host environment variables, so the regression writes files and
 * mutates process state and belongs at the semantic integration boundary
 * rather than beside the hermetic `cli/mcp` unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  _resetEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { join } from "veryfront/platform/path";

import { vfRemoteListFiles } from "../../../../../cli/mcp/remote-file-tools.ts";
import { deleteToken, saveToken } from "../../../../../cli/auth/token-store.ts";

describe("remote file tools env-file API origin", () => {
  it("does not send a shell token to a project env API origin", async () => {
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"];
    const savedEnv = envKeys.map((key) => getEnv(key));
    let fetchCalls = 0;

    try {
      setEnv("VERYFRONT_API_TOKEN", "shell-token");
      deleteEnv("VERYFRONT_API_URL");
      deleteEnv("VERYFRONT_API_BASE_URL");
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        await writeTextFile(
          join(dir, ".env"),
          "VERYFRONT_API_URL=https://api.veryfront.com\n" +
            "VERYFRONT_API_BASE_URL=https://project-controlled.example\n",
        );
        await loadEnv({ cwd: dir, override: false });
        refreshEnvironmentConfig();

        const result = await withMockFetch(
          (() => {
            fetchCalls += 1;
            return Promise.resolve(Response.json({ data: [] }));
          }) as typeof fetch,
          () => vfRemoteListFiles.execute({ project: "project", limit: 50 }),
        );

        assertEquals(result.success, false);
      }, { prefix: "vf-remote-file-tools-origin-" });
      assertEquals(fetchCalls, 0);
    } finally {
      __resetEnvLoaderForTests();
      envKeys.forEach((key, index) => {
        const value = savedEnv[index];
        if (value === undefined) deleteEnv(key);
        else setEnv(key, value);
      });
      _resetEnvironmentConfig();
    }
  });

  it("keeps the project env token ahead of the stored login token", async () => {
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_API_BASE_URL",
      "XDG_CONFIG_HOME",
    ];
    const savedEnv = envKeys.map((key) => getEnv(key));
    const authorizations: string[] = [];

    try {
      envKeys.forEach((key) => deleteEnv(key));
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        setEnv("XDG_CONFIG_HOME", join(dir, "config"));
        await writeTextFile(
          join(dir, ".env"),
          "VERYFRONT_API_TOKEN=project-env-token\n",
        );
        await loadEnv({ cwd: dir, override: true });
        refreshEnvironmentConfig();
        await saveToken("stored-login-token");

        try {
          // These tools used to read the environment token directly, so a
          // project `.env` VERYFRONT_API_TOKEN outranked a stored
          // `veryfront login`. Resolving them in interactive precedence swaps
          // that pair and silently changes which identity file operations use.
          const result = await withMockFetch(
            ((_input: string | URL | Request, init?: RequestInit) => {
              authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
              return Promise.resolve(Response.json({ data: [] }));
            }) as typeof fetch,
            () => vfRemoteListFiles.execute({ project: "project", limit: 50 }),
          );

          assertEquals(result.success, true);
        } finally {
          await deleteToken();
        }
      }, { prefix: "vf-remote-file-tools-precedence-" });

      assertEquals(authorizations, ["Bearer project-env-token"]);
    } finally {
      __resetEnvLoaderForTests();
      envKeys.forEach((key, index) => {
        const value = savedEnv[index];
        if (value === undefined) deleteEnv(key);
        else setEnv(key, value);
      });
      _resetEnvironmentConfig();
    }
  });
});
