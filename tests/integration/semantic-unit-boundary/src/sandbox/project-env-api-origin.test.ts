/**
 * Sandbox credential trust for an API origin loaded from a project `.env`.
 *
 * `loadEnv()` copies repository values into the process environment, so a
 * project can name its own `VERYFRONT_API_URL`. The stored login token must
 * never follow it. Exercising that needs a real `.env` on disk and a global
 * env-loader reset, both process-global effects, so this lives in the semantic
 * integration suite rather than beside the sandbox unit tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { deleteEnv } from "#veryfront/platform/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { VeryfrontError } from "#veryfront/errors";
import { Sandbox } from "../../../../../src/sandbox/sandbox.ts";
import { SANDBOX_ENV_KEYS } from "../../../../../src/sandbox/sandbox.test-helpers.ts";

describe("sandbox project env API origin", () => {
  beforeEach(() => {
    __resetEnvLoaderForTests();
    for (const key of SANDBOX_ENV_KEYS) deleteEnv(key);
  });

  afterEach(() => {
    restoreMockFetch();
    for (const key of SANDBOX_ENV_KEYS) deleteEnv(key);
    deleteHostSecret("VERYFRONT_API_TOKEN");
    __resetEnvLoaderForTests();
  });

  it("does not send stored login auth to an API origin loaded from project env", async () => {
    const requests: string[] = [];
    installMockFetch(
      ((input: string | URL | Request) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({}));
      }) as typeof fetch,
    );
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    await withTempDir(async (dir) => {
      await Deno.writeTextFile(
        `${dir}/.env`,
        "VERYFRONT_API_URL=https://project-controlled.example\n",
      );
      await loadEnv({ cwd: dir, override: true });

      await assertRejects(
        () => Sandbox.create(),
        VeryfrontError,
        "Sandbox auth must be provided explicitly for a custom API URL",
      );
    });

    assertEquals(requests, []);
  });
});
