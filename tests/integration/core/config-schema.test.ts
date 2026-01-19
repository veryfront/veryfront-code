import { assertRejects } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { remove, writeTextFile } from "@veryfront/testing/deno-compat";
import { getAdapter } from "@veryfront/platform";
import { clearConfigCache, getConfig } from "@veryfront/config";
import { withTestContext } from "../../_helpers/context.ts";

describe("Config validation", () => {
  it("rejects invalid security.cors object", async () => {
    await withTestContext("config-invalid-cors", async (context) => {
      const adapter = await getAdapter();
      // Remove the default config created by TestContext
      await remove(join(context.projectDir, "veryfront.config.js"));

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
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

  it("warns for unknown top-level keys", async () => {
    await withTestContext("config-unknown-keys", async (context) => {
      const adapter = await getAdapter();
      // Remove the default config created by TestContext
      await remove(join(context.projectDir, "veryfront.config.js"));

      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
        router: "pages",
        notARealKey: true,
      } as const`,
      );

      // Capture console.warn temporarily
      const origWarn = console.warn;
      let warned = false;
      console.warn = (...args: unknown[]) => {
        warned = true;
        origWarn.apply(console, args as any);
      };

      const cfg = await getConfig(context.projectDir, adapter);
      console.warn = origWarn;
      if (!warned) throw new Error("expected unknown key warning");
      if (cfg.router !== "pages") {
        throw new Error("router should pass validation");
      }

      clearConfigCache();
    });
  });
});
