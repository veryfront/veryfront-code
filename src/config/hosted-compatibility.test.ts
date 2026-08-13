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

  it("keeps a credential out of the excerpt it prints", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `const client = connect("postgres://admin:hunter2@db.internal.test/app");\n` +
        `export default { title: "Demo" };\n`,
    );

    assertEquals(incompatibility?.line, 1);
    assertEquals(incompatibility?.excerpt?.includes("hunter2"), false);
    assertStringIncludes(incompatibility?.excerpt ?? "", "connect(");
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

  it("refuses a literal config the hosted result policy always rejects", async () => {
    // Nothing here reads the deployment environment, so this evaluation and
    // the hosted one see the same record: the deploy would ship a release that
    // answers 500 to every request.
    for (
      const [source, reason] of [
        [`export default { cache: { dir: ".tenant-cache" } };`, "hosted-cache-directory"],
        [
          `export default { extensions: [{ name: "ext-css-lightning" }] };`,
          "hosted-extensions",
        ],
        [
          `export default { cache: { render: { type: "filesystem" } } };`,
          "hosted-render-cache-backend",
        ],
      ] as const
    ) {
      const incompatibility = await findHostedConfigIncompatibility(source);

      assertEquals(incompatibility?.code, "unsupported-hosted-feature", source);
      assertEquals(incompatibility?.reason, reason, source);
      // The evaluator reports a result rejection against the program, not the
      // key, so no line is claimed for one.
      assertEquals(incompatibility?.line, undefined, source);
      assertEquals(incompatibility?.excerpt, undefined, source);
    }
  });

  it("names the hosted limit rather than the generic literal remedy", async () => {
    const incompatibility = await findHostedConfigIncompatibility(
      `export default { cache: { dir: ".tenant-cache" } };`,
    );

    assertStringIncludes(incompatibility?.summary ?? "", "cache.dir");
    assertStringIncludes(incompatibility?.remedy ?? "", "cache.dir");
  });

  it("stays silent about rejections that depend on evaluated values", async () => {
    // The hosted result policy refuses an origin this evaluation cannot
    // produce: ORIGINS is set in the deployment environment, not this one. A
    // caller cannot reach that verdict honestly, so it reports nothing.
    assertEquals(
      await findHostedConfigIncompatibility(
        `import { getEnv } from "veryfront";\n` +
          `export default { security: { cors: { origin: getEnv("ORIGINS") } } };\n`,
      ),
      null,
    );
  });
});
