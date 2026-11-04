import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";

describe("integration Studio advice origin", () => {
  for (const operatorOrigin of ["https://operator.example", ""]) {
    it(`ignores project env files and later process writes with ${operatorOrigin ? "an operator override" : "the known API default"}`, async () => {
      await withTempDir(async (directory) => {
        const moduleUrl = (path: string) =>
          JSON.stringify(new URL(`../../../${path}`, import.meta.url).href);
        const script = `
          import { getRemoteIntegrationProjectTarget } from ${
          moduleUrl("src/integrations/remote-tools.ts")
        };
          import { markEnvFileValue, clearEnvFileValueSource } from ${
          moduleUrl("src/platform/compat/process/env.ts")
        };
          import { assertEquals } from ${moduleUrl("src/testing/assert.ts")};
          const expected = ${JSON.stringify(operatorOrigin || "https://veryfront.com")};
          Deno.env.set("STUDIO_URL", "https://project-file.example");
          markEnvFileValue("STUDIO_URL");
          assertEquals(getRemoteIntegrationProjectTarget()?.studioOrigin, expected);
          clearEnvFileValueSource("STUDIO_URL");
          Deno.env.set("STUDIO_URL", "https://agent-mutated.example");
          assertEquals(getRemoteIntegrationProjectTarget()?.studioOrigin, expected);
        `;
        const path = `${directory}/studio-origin.ts`;
        await Deno.writeTextFile(path, script);
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--quiet",
            "--no-check",
            "--allow-env",
            "--allow-read",
            "--deny-net",
            "--config",
            new URL("../../../deno.json", import.meta.url).pathname,
            path,
          ],
          env: {
            DENO_TESTING: "0",
            STUDIO_URL: operatorOrigin,
            VERYFRONT_API_URL: "https://api.veryfront.com",
            VERYFRONT_API_BASE_URL: "https://api.veryfront.com",
            VERYFRONT_API_TOKEN: "test-token",
            VERYFRONT_PROJECT_SLUG: "case-demo",
            PROXY_MODE: "false",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      });
    });
  }
});
