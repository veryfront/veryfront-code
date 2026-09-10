import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("framework profiling command", () => {
  it("launches workers with task permissions and writes usable reports", async () => {
    const label = `test-${crypto.randomUUID()}`;
    const directory = `.cache/perf/${label}`;
    try {
      const result = await new Deno.Command("deno", {
        args: [
          "task",
          "perf",
          `--label=${label}`,
          "--scenario=request-timing",
          "--trials=3",
          "--duration-ms=250",
          "--json",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const response = JSON.parse(new TextDecoder().decode(result.stdout));
      assertEquals(result.code, 0, response.error?.message);
      assertEquals(response.success, true);
      assertEquals(response.command, "perf");
      assertEquals(response.data.directory, directory);
      const results = JSON.parse(await Deno.readTextFile(`${directory}/results.json`));
      assertEquals(response.data.results, results);
      assertEquals(results.scenarios.length, 1);
      assertEquals(results.scenarios[0].runs.length, 3);
      assertEquals(results.scenarios[0].latencyMs.median > 0, true);
      assertStringIncludes(await Deno.readTextFile(`${directory}/index.html`), "<svg");
      assertStringIncludes(await Deno.readTextFile(`${directory}/summary.md`), "request-timing");
      const profile = JSON.parse(await Deno.readTextFile(`${directory}/request-timing.cpuprofile`));
      assertEquals(profile.samples.length > 0, true);
    } finally {
      await Deno.remove(directory, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  });
});
