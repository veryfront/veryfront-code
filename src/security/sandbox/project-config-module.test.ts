import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { stop as stopBundler } from "veryfront/extensions/bundler";
import type { ProjectSourceSnapshot } from "./project-source-snapshot.ts";
import {
  prepareProjectConfigModule,
  PROJECT_CONFIG_MAX_MODULE_BYTES,
} from "./project-config-module.ts";

const encoder = new TextEncoder();

function snapshot(
  files: Array<{ sourcePath: string; content: string | Uint8Array }>,
): ProjectSourceSnapshot {
  return {
    algorithm: "sha256",
    digest: "0".repeat(64),
    files: files.map((file) => ({
      sourcePath: file.sourcePath,
      content: typeof file.content === "string" ? encoder.encode(file.content) : file.content,
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  };
}

describe("security/sandbox/project-config-module", () => {
  afterAll(async () => {
    await stopBundler();
  });

  it("transforms TypeScript config without evaluating it in the host", async () => {
    delete (globalThis as Record<string, unknown>).__projectConfigWasEvaluated;
    const prepared = await prepareProjectConfigModule(snapshot([{
      sourcePath: "veryfront.config.ts",
      content: [
        "globalThis.__projectConfigWasEvaluated = true;",
        "const root: string = 'custom-agents';",
        "export default { ai: { agents: { discovery: { paths: [root] } } } };",
      ].join("\n"),
    }]));

    assertEquals(prepared?.sourcePath, "veryfront.config.ts");
    assertEquals(prepared?.moduleCode.includes('const root = "custom-agents"'), true);
    assertEquals((globalThis as Record<string, unknown>).__projectConfigWasEvaluated, undefined);
  });

  it("uses the same deterministic config filename precedence as the project loader", async () => {
    const prepared = await prepareProjectConfigModule(snapshot([
      { sourcePath: "veryfront.config.ts", content: "export default { title: 'ts' };" },
      { sourcePath: "veryfront.config.js", content: "export default { title: 'js' };" },
    ]));

    assertEquals(prepared?.sourcePath, "veryfront.config.js");
    assertEquals(prepared?.moduleCode.includes("title: 'js'"), true);
  });

  it("rejects invalid UTF-8 and oversized transformed config modules", async () => {
    await assertRejects(
      () =>
        prepareProjectConfigModule(snapshot([{
          sourcePath: "veryfront.config.js",
          content: new Uint8Array([0xff]),
        }])),
      TypeError,
      "UTF-8",
    );

    await assertRejects(
      () =>
        prepareProjectConfigModule(snapshot([{
          sourcePath: "veryfront.config.js",
          content: `export default "${"x".repeat(PROJECT_CONFIG_MAX_MODULE_BYTES)}";`,
        }])),
      RangeError,
      "byte limit",
    );
  });

  it("fails closed for project-relative and computed config imports", async () => {
    for (
      const content of [
        `import value from "./config-value.ts"; export default value;`,
        `export { default } from "./config-value.ts";`,
        `export default await import("./config-value.ts");`,
        `const target = "./config-value.ts"; export default await import(target);`,
      ]
    ) {
      await assertRejects(
        () =>
          prepareProjectConfigModule(snapshot([{
            sourcePath: "veryfront.config.js",
            content,
          }])),
        TypeError,
        "snapshot-bound config bundling",
      );
    }
  });

  it("embeds only the exact Veryfront config helper and rejects other imports", async () => {
    const prepared = await prepareProjectConfigModule(snapshot([{
      sourcePath: "veryfront.config.ts",
      content: `
        import { defineConfig } from "veryfront";
        export default defineConfig({ title: "isolated" });
      `,
    }]));
    assertEquals(prepared?.moduleCode.includes("data:text/javascript"), true);
    assertEquals(prepared?.moduleCode.includes('from "veryfront"'), false);

    await assertRejects(
      () =>
        prepareProjectConfigModule(snapshot([{
          sourcePath: "veryfront.config.js",
          content: `import value from "some-package"; export default value;`,
        }])),
      TypeError,
      "snapshot-bound config bundling",
    );
  });
});
