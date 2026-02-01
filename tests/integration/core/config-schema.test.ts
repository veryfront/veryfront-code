import { assertRejects } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { remove, writeTextFile } from "#veryfront/testing/deno-compat";
import { getAdapter } from "#veryfront/platform";
import { clearConfigCache, getConfig } from "#veryfront/config";
import { withTestContext } from "../../_helpers/context.ts";

async function setupConfig(
  context: { projectDir: string },
  contents: string,
): Promise<void> {
  await remove(join(context.projectDir, "veryfront.config.js"));
  await writeTextFile(join(context.projectDir, "veryfront.config.ts"), contents);
}

describe("Config validation", () => {
  it("rejects invalid security.cors object", async () => {
    await withTestContext("config-invalid-cors", async (context) => {
      const adapter = await getAdapter();

      await setupConfig(
        context,
        `export default {
        security: { cors: { origin: 123 } }
      } as const`,
      );

      await assertRejects(
        () => getConfig(context.projectDir, adapter),
        Error,
        "security.cors.origin must be a string",
      );

      clearConfigCache();
    });
  });

  it("rejects unknown top-level keys", async () => {
    await withTestContext("config-unknown-keys", async (context) => {
      const adapter = await getAdapter();

      await setupConfig(
        context,
        `export default {
        router: "pages",
        notARealKey: true,
      } as const`,
      );

      await assertRejects(
        () => getConfig(context.projectDir, adapter),
        Error,
        "Unknown config keys: notARealKey",
      );

      clearConfigCache();
    });
  });
});
