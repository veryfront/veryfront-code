import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";

/**
 * Keys the default build path puts on its `type: "result"` line.
 *
 * Pinned here so the embedded preset cannot answer the same command with a
 * second, differently shaped payload. Kept in sync with `buildCommand` in
 * command.ts.
 */
const RESULT_DATA_KEYS = [
  "assets",
  "chunks",
  "dryRun",
  "duration_ms",
  "outputDir",
  "pages",
  "totalSize",
];

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the real CLI in a child process.
 *
 * In-process is not an option here: `buildEmbeddedPreset` calls `esbuild.stop()`
 * when it finishes, and the bundler cannot be brought back up in the same
 * process, so only one embedded build per process can succeed — and
 * embedded-preset-flags.test.ts already spends it. A child process is also the
 * only way to see everything that reaches stdout, which is what `--json`
 * promises.
 */
async function runCli(projectDir: string, args: string[]): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--config",
      join(REPO_ROOT, "deno.json"),
      "--unstable-worker-options",
      "--unstable-net",
      join(REPO_ROOT, "cli/main.ts"),
      ...args,
    ],
    cwd: projectDir,
    env: {
      NO_COLOR: "1",
      DENO_TESTING: "1",
      VERYFRONT_NO_UPDATE_CHECK: "1",
    },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

async function makeProject(prefix: string): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(projectDir, "app"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "app/page.mdx"), "# Home\n");
  return projectDir;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe("commands/build embedded preset --json", () => {
  it("emits only NDJSON, ending in the default path's result line", async () => {
    const projectDir = await makeProject("vf-embedded-json-");
    // realPath because macOS temp dirs sit behind a symlink and the CLI reports
    // the directory it resolved from its own cwd.
    const expectedOutputDir = join(await Deno.realPath(projectDir), "dist");
    let result: CliResult;
    try {
      result = await runCli(projectDir, ["build", "--preset", "embedded", "--json"]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }

    assertEquals(result.code, 0, `build failed:\n${result.stdout}\n${result.stderr}`);

    const lines = result.stdout.split("\n").filter((line) => line.trim() !== "");
    const prose = lines.filter((line) => parseJsonLine(line) === undefined);
    assertEquals(
      prose,
      [],
      `--json must put nothing but NDJSON on stdout: ${JSON.stringify(prose)}`,
    );

    const events = lines.map((line) => parseJsonLine(line)!);
    const results = events.filter((event) => event.type === "result");
    assertEquals(
      results.length,
      1,
      `expected exactly one result line, got:\n${result.stdout}`,
    );

    const resultLine = results[0]!;
    assertEquals(resultLine.success, true, JSON.stringify(resultLine));
    const data = resultLine.data as Record<string, unknown>;
    assertEquals(
      Object.keys(data).sort(),
      RESULT_DATA_KEYS,
      "the embedded result payload must carry the same keys as the default build path",
    );
    assertEquals(data.dryRun, false);
    assertEquals(typeof data.duration_ms, "number");
    assertEquals(typeof data.totalSize, "number");
    assertEquals(
      data.outputDir,
      expectedOutputDir,
      "outputDir must be the directory the preset wrote",
    );
    // Exact, not `>= 1`. The fixture ships one page, and the preset unshifts a
    // synthetic `/` -> `embedded/app.js` shell route on top of the discovered
    // ones — so a `>= 1` assertion passes just as happily on the naive count
    // that reports 2 for a one-page project.
    assertEquals(
      data.pages,
      1,
      `one page in, one page reported: ${JSON.stringify(data)}`,
    );
    // The default path reports 0 chunks for a build with no splitting stage.
    assertEquals(data.chunks, 0, `embedded has no splitting stage: ${JSON.stringify(data)}`);
    assertEquals(
      (data.totalSize as number) > 0,
      true,
      `totalSize must reflect real artifacts: ${JSON.stringify(data)}`,
    );
  });
  it("keeps the failure path NDJSON too, ending in one error result", async () => {
    // Raised in review: streaming the error result and then rethrowing left the
    // router free to append its own multi-line envelope, so stdout carried two
    // result formats and the second was not NDJSON. The build must terminate
    // the stream itself, as the default path does.
    const projectDir = await Deno.makeTempDir({ prefix: "vf-embedded-json-fail-" });
    await Deno.mkdir(join(projectDir, "app"), { recursive: true });
    // Unclosed JSX expression: the bundler fails after `config` has already
    // been reported, which is precisely when a second envelope used to appear.
    await Deno.writeTextFile(join(projectDir, "app/page.mdx"), "# Broken\n\n<Foo\n");
    let result: CliResult;
    try {
      result = await runCli(projectDir, ["build", "--preset", "embedded", "--json"]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }

    assertEquals(result.code === 0, false, `expected a nonzero exit:\n${result.stdout}`);

    const lines = result.stdout.split("\n").filter((line) => line.trim() !== "");
    const prose = lines.filter((line) => parseJsonLine(line) === undefined);
    assertEquals(
      prose,
      [],
      `a failed --json build must still put nothing but NDJSON on stdout: ${JSON.stringify(prose)}`,
    );

    const results = lines
      .map(parseJsonLine)
      .filter((entry): entry is Record<string, unknown> => entry?.type === "result");
    assertEquals(results.length, 1, `exactly one result line: ${JSON.stringify(results)}`);
    assertEquals(results[0].success, false);
    assertEquals(typeof results[0].error, "string");
  });
});
