import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { writeRunResultIfConfigured } from "./write-run-result.ts";

const RUN_RESULT_PATH_ENV = "VERYFRONT_RUN_RESULT_PATH";

afterEach(() => {
  try {
    deleteEnv(RUN_RESULT_PATH_ENV);
  } catch {
    // env may already be unset
  }
});

describe("writeRunResultIfConfigured", () => {
  it("does nothing when no result path is configured", async () => {
    await writeRunResultIfConfigured({ ok: true });
  });

  it("writes sanitized structured run output to the configured path", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-run-result-" });
    const resultPath = `${tempDir}/run-result.json`;

    try {
      setEnv(RUN_RESULT_PATH_ENV, resultPath);

      await writeRunResultIfConfigured({
        ok: true,
        nested: {
          _tenant: { token: "secret" },
          count: 3,
        },
      });

      const raw = await Deno.readTextFile(resultPath);
      assertEquals(JSON.parse(raw), {
        ok: true,
        nested: {
          count: 3,
        },
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => undefined);
    }
  });
});
