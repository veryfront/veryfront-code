import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("AG-UI generated type output", () => {
  it("writes formatted output and checks it without rewriting stale output", async () => {
    const directory = await Deno.makeTempDir();
    const outputPath = new URL(`file://${directory}/types.ts`);
    const scriptPath = `${directory}/generate.ts`;
    try {
      await Deno.writeTextFile(
        scriptPath,
        [
          `import { writeGeneratedTypes } from ${
            JSON.stringify(new URL("../../../src/events/ag-ui/generator.ts", import.meta.url).href)
          };`,
          `await writeGeneratedTypes({source: 'export type Value=string;', outputPath: new URL(${
            JSON.stringify(outputPath.href)
          }), tempPrefix: 'ag-ui-generator-test-', outdatedMessages: ['fixture is out of date', 'regenerate fixture']});`,
        ].join("\n"),
      );
      const run = (...args: string[]) =>
        new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--no-config",
            "--allow-read",
            "--allow-write",
            "--allow-run",
            scriptPath,
            ...args,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
      assertEquals((await run()).code, 0);
      assertEquals(await Deno.readTextFile(outputPath), "export type Value = string;\n");
      assertEquals((await run("--check")).code, 0);
      await Deno.writeTextFile(outputPath, "stale fixture\n");
      const stale = await run("--check");
      assertEquals(stale.code, 1);
      const diagnostics = new TextDecoder().decode(stale.stderr);
      assertEquals(diagnostics.endsWith("fixture is out of date\nregenerate fixture\n"), true);
      assertEquals(await Deno.readTextFile(outputPath), "stale fixture\n");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});
