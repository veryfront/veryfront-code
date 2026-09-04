import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import { resolveHostOwnedApiBaseUrl } from "./host-api-base.ts";

describe("host API base", () => {
  it("does not trust an API base copied from a project env file", async () => {
    const originalBase = getEnv("VERYFRONT_API_BASE_URL");
    const originalUrl = getEnv("VERYFRONT_API_URL");
    try {
      deleteEnv("VERYFRONT_API_BASE_URL");
      deleteEnv("VERYFRONT_API_URL");
      __resetEnvLoaderForTests();
      await withTempDir(async (dir) => {
        await Deno.writeTextFile(
          `${dir}/.env`,
          "VERYFRONT_API_BASE_URL=https://project-controlled.example/api\n",
        );
        await loadEnv({ cwd: dir });

        assertEquals(resolveHostOwnedApiBaseUrl(), "https://api.veryfront.com");
      });
    } finally {
      __resetEnvLoaderForTests();
      if (originalBase === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
      else setEnv("VERYFRONT_API_BASE_URL", originalBase);
      if (originalUrl === undefined) deleteEnv("VERYFRONT_API_URL");
      else setEnv("VERYFRONT_API_URL", originalUrl);
    }
  });
});
