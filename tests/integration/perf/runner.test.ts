import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { resolve } from "node:path";

describe("framework profiling command", () => {
  it("distinguishes compatible baseline metadata, dependency changes, and read errors", async () => {
    await Deno.mkdir(".cache/perf", { recursive: true });
    const base = resolve(await makeTempDirWithOptions({ dir: ".cache/perf", prefix: "metadata-" }));
    const config = JSON.parse(
      await Deno.readTextFile(new URL("../../../deno.json", import.meta.url)),
    );
    const lock = await Deno.readTextFile(new URL("../../../deno.lock", import.meta.url));
    const stageMembers = async (directory: string) => {
      for (const member of config.workspace) {
        await Deno.mkdir(`${directory}/${member}`, { recursive: true });
        await Deno.writeTextFile(
          `${directory}/${member}/deno.json`,
          await Deno.readTextFile(new URL(`../../../${member}/deno.json`, import.meta.url)),
        );
      }
    };
    const check = async (cwd?: string) => {
      const result = await new Deno.Command("deno", {
        args: [
          "run",
          "--frozen",
          "--allow-read",
          new URL("../../../scripts/perf/baseline.ts", import.meta.url).href,
          base,
        ],
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return result.code;
    };
    try {
      await Deno.writeTextFile(`${base}/deno.json`, JSON.stringify({ ...config, tasks: {} }));
      await Deno.writeTextFile(`${base}/deno.lock`, lock);
      await stageMembers(base);
      assertEquals(await check(), 0);
      for (const member of ["react", "extensions/ext-css-tailwind"]) {
        const path = `${base}/${member}/deno.json`;
        const original = await Deno.readTextFile(path);
        const memberConfig = JSON.parse(original);
        await Deno.writeTextFile(path, JSON.stringify({ ...memberConfig, imports: {} }));
        assertEquals(await check(), 1);
        await Deno.writeTextFile(path, JSON.stringify({ ...memberConfig, exports: "./other.ts" }));
        assertEquals(await check(), 1);
        await Deno.writeTextFile(
          path,
          JSON.stringify({ ...memberConfig, tasks: { test: "changed" } }),
        );
        assertEquals(await check(), 0);
        await Deno.writeTextFile(path, original);
      }
      await Deno.writeTextFile(
        `${base}/deno.json`,
        JSON.stringify({ ...config, lock: "alternate.lock" }),
      );
      await Deno.writeTextFile(`${base}/alternate.lock`, lock);
      assertEquals(await check(), 1);
      const head = `${base}/head`;
      await Deno.mkdir(head);
      await stageMembers(head);
      await Deno.writeTextFile(`${head}/deno.lock`, lock);
      await Deno.writeTextFile(`${head}/alternate.lock`, lock);
      for (const directory of [head, base]) {
        await Deno.writeTextFile(`${directory}/deno.json`, JSON.stringify(config));
        await Deno.writeTextFile(
          `${directory}/package.json`,
          JSON.stringify({ dependencies: { fixture: "1.0.0" } }),
        );
      }
      assertEquals(await check(head), 0);
      await Deno.writeTextFile(
        `${base}/package.json`,
        JSON.stringify({ dependencies: { fixture: "2.0.0" } }),
      );
      assertEquals(await check(head), 1);
      const reactConfig = JSON.parse(await Deno.readTextFile(`${head}/react/deno.json`));
      const mappedConfig = { ...reactConfig, importMap: "import_map.json" };
      delete mappedConfig.imports;
      for (const directory of [head, base]) {
        await Deno.remove(`${directory}/package.json`);
        await Deno.writeTextFile(`${directory}/react/deno.json`, JSON.stringify(mappedConfig));
        await Deno.writeTextFile(
          `${directory}/react/import_map.json`,
          JSON.stringify({ imports: {} }),
        );
      }
      assertEquals(await check(head), 0);
      await Deno.writeTextFile(
        `${base}/react/import_map.json`,
        JSON.stringify({ imports: { fixture: "./fixture.ts" } }),
      );
      assertEquals(await check(head), 1);
      for (const directory of [head, base]) {
        await Deno.writeTextFile(`${directory}/react/deno.json`, JSON.stringify(reactConfig));
      }
      for (const setting of ["alternate.lock", { path: "alternate.lock", frozen: true }]) {
        const configured = JSON.stringify({ ...config, lock: setting });
        await Deno.writeTextFile(`${head}/deno.json`, configured);
        await Deno.writeTextFile(`${base}/deno.json`, configured);
        await Deno.writeTextFile(`${base}/alternate.lock`, lock);
        assertEquals(await check(head), 0);
        await Deno.writeTextFile(`${base}/alternate.lock`, "changed selected dependency graph");
        assertEquals(await check(head), 1);
      }
      for (const directory of [head, base]) {
        await Deno.writeTextFile(
          `${directory}/deno.json`,
          JSON.stringify({ ...config, lock: false }),
        );
      }
      assertEquals(await check(head), 1);
      await Deno.writeTextFile(`${base}/deno.json`, JSON.stringify({ ...config, imports: {} }));
      assertEquals(await check(), 1);
      await Deno.writeTextFile(`${base}/deno.json`, JSON.stringify(config));
      await Deno.writeTextFile(`${base}/deno.lock`, "changed dependency graph");
      assertEquals(await check(), 1);
      await Deno.remove(`${base}/deno.lock`);
      assertEquals(await check(), 2);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });

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
      const html = await Deno.readTextFile(`${directory}/index.html`);
      assertStringIncludes(html, "<svg");
      const viewer = await new Deno.Command("deno", {
        args: [
          "run",
          "--frozen",
          "--config=deno.json",
          "--allow-read",
          "--allow-env",
          "tests/integration/perf/viewer.test-helpers.ts",
          `${directory}/index.html`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        viewer.code,
        0,
        "Generated flamegraph controls must pass the browser DOM checks",
      );
      assertStringIncludes(await Deno.readTextFile(`${directory}/summary.md`), "request-timing");
      const profile = JSON.parse(await Deno.readTextFile(`${directory}/request-timing.cpuprofile`));
      assertEquals(profile.samples.length > 0, true);

      const savedBaseline = await Deno.readTextFile(`${directory}/results.json`);
      const invalidComparison = await new Deno.Command("deno", {
        args: [
          "task",
          "perf",
          ...args,
          "--scenario=ssr",
          "--no-profile",
          `--baseline=${directory}/results.json`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(invalidComparison.code, 2);
      assertEquals(await Deno.readTextFile(`${directory}/results.json`), savedBaseline);

      const invalidBaseline = JSON.parse(savedBaseline);
      invalidBaseline.scenarios[0].latencyMs.median = 0;
      const invalidBaselineText = JSON.stringify(invalidBaseline);
      await Deno.writeTextFile(`${directory}/results.json`, invalidBaselineText);
      const invalidLatency = await new Deno.Command("deno", {
        args: ["task", "perf", ...args, "--no-profile", `--baseline=${directory}/results.json`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(invalidLatency.code, 2);
      assertEquals(await Deno.readTextFile(`${directory}/results.json`), invalidBaselineText);
      await Deno.writeTextFile(`${directory}/results.json`, savedBaseline);

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
      const failure = JSON.parse(new TextDecoder().decode(failed.stdout));
      assertEquals(failure.success, false);
      assertEquals(failure.error.context.scenario, "request-timing");
      assertEquals(failure.error.context.trial, 1);
      assertEquals(failure.error.context.reason, "permission-denied");
      assertEquals(failure.error.context.exitCode, null);
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
