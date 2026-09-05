/**
 * Host-credential API base resolution for the Veryfront Cloud bootstrap.
 *
 * `loadEnv()` copies repository values into the process environment, so a
 * project can name its own `VERYFRONT_API_BASE_URL`. A host-private stored
 * login token must not be paired with it. Proving that needs a real `.env` on
 * disk plus a global env-loader reset, both process-global effects, so this
 * lives in the semantic integration suite rather than beside the resolver unit
 * tests.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { getVeryfrontCloudBootstrap } from "../../../../../../src/platform/cloud/resolver.ts";

describe("platform/cloud/resolver host credential API base", () => {
  afterEach(() => {
    deleteHostSecret("VERYFRONT_API_TOKEN");
    __resetEnvLoaderForTests();
  });

  it("does not pair stored login auth with an API origin loaded from project env", async () => {
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    await withTempDir(async (dir) => {
      await writeTextFile(
        `${dir}/.env`,
        "VERYFRONT_API_BASE_URL=https://project-controlled.example/api\n",
      );
      await loadEnv({ cwd: dir });

      const bootstrap = getVeryfrontCloudBootstrap();
      assertEquals(bootstrap.apiBaseUrl, "https://api.veryfront.com");
      assertEquals(bootstrap.apiToken, "stored-login-token");
    });
  });
});
