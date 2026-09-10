import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("framework profiling command", () => {
  it("launches workers with task permissions and writes usable reports", async () => {
    const label = `test-${crypto.randomUUID()}`;
    const directory = `.cache/perf/${label}`;
    const args = [
      `--label=${label}`,
      "--scenario=request-timing",
      "--trials=3",
      "--duration-ms=250",
      "--json",
    ];
    try {
      const result = await new Deno.Command("deno", {
        args: ["task", "perf", ...args],
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

      const rerun = await new Deno.Command("deno", {
        args: ["task", "perf", ...args, "--no-profile", `--baseline=${directory}/results.json`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(rerun.code, 0);
      const rerunResponse = JSON.parse(new TextDecoder().decode(rerun.stdout));
      assertEquals(
        typeof rerunResponse.data.results.scenarios[0].comparison.changePercent,
        "number",
      );
      await assertRejects(
        () => Deno.stat(`${directory}/request-timing.cpuprofile`),
        Deno.errors.NotFound,
      );

      // Deny worker launch to reproduce a capture failure after setup succeeds.
      const failed = await new Deno.Command("deno", {
        args: [
          "run",
          "--frozen",
          "--no-prompt",
          "--allow-read",
          "--allow-write=.cache",
          "--allow-env",
          "--allow-sys",
          "--allow-run=git",
          "scripts/perf/run.ts",
          ...args,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(failed.code, 1);
      assertEquals(JSON.parse(new TextDecoder().decode(failed.stdout)).success, false);
      for (const name of ["results.json", "index.html", "summary.md"]) {
        await assertRejects(() => Deno.stat(`${directory}/${name}`), Deno.errors.NotFound);
      }
    } finally {
      await Deno.remove(directory, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  });
});
