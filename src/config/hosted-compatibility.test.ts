import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findHostedConfigIncompatibility,
  formatHostedConfigIncompatibility,
} from "./hosted-compatibility.ts";

const EXTENSION_CONFIG = `import { defineConfig } from "veryfront";
import extCssLightning from "@veryfront/ext-css-lightning";

export default defineConfig({
  extensions: [extCssLightning()],
});
`;

describe("hosted config compatibility", () => {
  it("names the extension import that makes a project undeployable", async () => {
    const incompatibility = await findHostedConfigIncompatibility(EXTENSION_CONFIG);

    assertEquals(incompatibility?.reason, "unsupported-import");
    assertEquals(incompatibility?.line, 2);
    assertEquals(
      incompatibility?.excerpt,
      `import extCssLightning from "@veryfront/ext-css-lightning";`,
    );
  });

  it("names an extension import that stands on its own", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `import extCssLightning from "@veryfront/ext-css-lightning";\n` +
        `export default { extensions: [extCssLightning()] };\n`,
    );

    assertEquals(incompatibility?.code, "unsupported-syntax");
    assertEquals(incompatibility?.reason, "unsupported-import");
    assertEquals(incompatibility?.line, 1);
  });

  it("formats a message that says where, what, and what to do", () => {
    const message = formatHostedConfigIncompatibility({
      code: "unsupported-syntax",
      reason: "unsupported-import",
      line: 2,
      excerpt: `import extCssLightning from "@veryfront/ext-css-lightning";`,
      summary: "Summary sentence.",
      remedy: "Remedy sentence.",
    }, "veryfront.config.ts");

    assertStringIncludes(message, "veryfront.config.ts:2");
    assertStringIncludes(message, "@veryfront/ext-css-lightning");
    assertStringIncludes(message, "Summary sentence.");
    assertStringIncludes(message, "Remedy sentence.");
  });

  it("accepts the configuration shapes the hosted evaluator supports", async () => {
    for (
      const source of [
        `export default { title: "Demo" };`,
        `import { defineConfig } from "veryfront";\nexport default defineConfig({ title: "Demo" });`,
        `import { getEnv } from "veryfront";\n` +
        `export default { title: getEnv("TITLE") ?? "Demo" };`,
        `export default { extensions: [{ name: "ext-css-lightning", enabled: false }] };`,
      ]
    ) {
      assertEquals(
        await findHostedConfigIncompatibility(source),
        null,
        `expected no incompatibility for: ${source}`,
      );
    }
  });

  it("stays silent about rejections that depend on evaluated values", async () => {
    // The hosted result policy also refuses this one, but only after
    // evaluating it. A caller checking without the deployment environment's
    // variables cannot reach that verdict honestly, so this reports nothing.
    assertEquals(
      await findHostedConfigIncompatibility(
        `export default { extensions: [{ name: "ext-css-lightning" }] };`,
      ),
      null,
    );
  });
});
