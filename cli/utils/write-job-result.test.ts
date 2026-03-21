import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { writeJobResultIfConfigured } from "./write-job-result.ts";

const JOB_RESULT_PATH_ENV = "VERYFRONT_JOB_RESULT_PATH";

afterEach(() => {
  try {
    deleteEnv(JOB_RESULT_PATH_ENV);
  } catch {
    // env may already be unset
  }
});

describe("writeJobResultIfConfigured", () => {
  it("does nothing when no result path is configured", async () => {
    await writeJobResultIfConfigured({ ok: true });
  });

  it("writes sanitized structured job output to the configured path", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "veryfront-job-result-" });
    const resultPath = `${tempDir}/job-result.json`;

    try {
      setEnv(JOB_RESULT_PATH_ENV, resultPath);

      await writeJobResultIfConfigured({
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
