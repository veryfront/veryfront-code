import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { parseCliArgs } from "#cli/shared/args";
import { __resetEnvLoaderForTests } from "#veryfront/utils/env-loader.ts";
import { loadDevProjectEnv, parseDevArgs } from "../../../../cli/commands/dev/handler.ts";

it("loads --project env files before PORT supplies the default port", async () => {
  const saved = { PORT: getEnv("PORT"), VERYFRONT_PORT: getEnv("VERYFRONT_PORT") };
  deleteEnv("PORT");
  deleteEnv("VERYFRONT_PORT");
  const projectDir = await makeTempDir({ prefix: "dev-project-env-" });
  try {
    await writeTextFile(`${projectDir}/.env`, "PORT=4317\n");
    const args = parseCliArgs(["dev", "--project", projectDir]);

    assertEquals(await loadDevProjectEnv(args), projectDir);
    const result = parseDevArgs(args);
    assertEquals(result.success && result.data.port, 4317);
  } finally {
    deleteEnv("PORT");
    for (const [key, value] of Object.entries(saved)) if (value) setEnv(key, value);
    __resetEnvLoaderForTests();
    await remove(projectDir, { recursive: true });
  }
});
