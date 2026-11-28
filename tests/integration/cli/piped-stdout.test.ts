import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor, withTempDir } from "#veryfront/testing/deno-compat.ts";

const repoRoot = new URL("../../../", import.meta.url);
const ANSWER_BYTES = 200_000;
// 64 KiB is the pipe buffer on macOS and Linux. Every answer below is larger.
const PIPE_BUFFER_BYTES = 65_536;
const LIFECYCLE = "./src/platform/compat/process/lifecycle.ts";
// Windows writes to pipes synchronously, so the unfixed Node never loses bytes there.
const asyncPipes = Deno.build.os !== "windows";

interface NodeRun {
  code: number;
  stdout: string;
  stderr: string;
}

// Once the script is ready to write, a writer that does not block on a full
// pipe writes and exits within milliseconds. The reader waits this long for
// that exit before it drains a writer that blocks.
const WRITE_WINDOW_MS = 1_000;
// Upper bound for Node startup (resolver plus TypeScript transform).
const STARTUP_TIMEOUT_MS = 60_000;
const READY_ENV = "VF_TEST_PIPE_READY_FILE";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/**
 * Run Node the way the npm CLI runs, with stdout and stderr on pipes that no
 * one reads until the process exits or blocks, and return what reaches the
 * reader.
 *
 * The script creates the file named by READY_ENV just before it writes. From
 * then, a writer that does not block on a full pipe exits within
 * WRITE_WINDOW_MS, so the reader sees only what survived the exit. A writer
 * that blocks does not exit, so the reader drains it after WRITE_WINDOW_MS.
 * Waiting for the file keeps slow startup from shortening that window.
 */
function runNodeWithSlowReader(nodeArgs: string[]): Promise<NodeRun> {
  return withTempDir(async (dir) => {
    const readyFile = `${dir}/ready`;
    const child = new Deno.Command("node", {
      args: ["--import", "./tests/node/resolver.mjs", ...nodeArgs],
      cwd: repoRoot,
      env: { [READY_ENV]: readyFile },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let exited = false;
    const status = child.status.then((result) => {
      exited = true;
      return result;
    });
    try {
      await waitFor(async () => exited || await exists(readyFile), {
        timeout: STARTUP_TIMEOUT_MS,
        interval: 20,
        message: "Node did not start the script",
      });
    } catch (error) {
      child.kill();
      await Promise.all([child.stdout.cancel(), child.stderr.cancel(), status]);
      throw error;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      status,
      new Promise((resolve) => {
        timer = setTimeout(resolve, WRITE_WINDOW_MS);
      }),
    ]);
    clearTimeout(timer);
    const [stdout, stderr, { code }] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      status,
    ]);
    return { code, stdout, stderr };
  }, { prefix: "vf-piped-stdout-" });
}

/**
 * Run `body` as a Node module with `exit` and `makeStdioWritesBlocking` in
 * scope, after it signals that it is ready to write.
 *
 * Loading TypeScript through the test resolver starts esbuild, whose child
 * process shares stderr and can leave that pipe blocking. The prelude puts both
 * pipes back to Node's default (asynchronous) so every case starts where the npm
 * CLI starts, and a case without the change can lose output.
 */
function runScript(body: string): Promise<NodeRun> {
  const script = `
    import { writeFileSync } from "node:fs";
    import { exit, makeStdioWritesBlocking } from "${LIFECYCLE}";
    for (const stream of [process.stdout, process.stderr]) stream._handle?.setBlocking?.(false);
    writeFileSync(process.env.${READY_ENV}, "");
    ${body}
  `;
  return runNodeWithSlowReader(["--input-type=module", "--eval", script]);
}

describe("CLI output on a pipe under Node", () => {
  it("keeps every byte of an answer larger than the pipe buffer when the CLI exits", async () => {
    const { code, stdout } = await runScript(`
      makeStdioWritesBlocking();
      console.log("x".repeat(${ANSWER_BYTES}));
      exit(0);
    `);

    assertEquals(code, 0);
    assertEquals(stdout.length, ANSWER_BYTES + 1);
  });

  it("keeps every NDJSON line a reader such as jq parses", async () => {
    const lines = 5_000;
    const { code, stdout } = await runScript(`
      makeStdioWritesBlocking();
      for (let i = 0; i < ${lines}; i++) {
        console.log(JSON.stringify({ seq: i, type: "run.event", data: "e".repeat(40) }));
      }
      exit(0);
    `);

    assertEquals(code, 0);
    const received = stdout.split("\n").filter((line) => line !== "");
    assertEquals(received.length, lines, "every line must reach the reader");
    assert(stdout.length > PIPE_BUFFER_BYTES, "the stream must outgrow the pipe buffer");
    const events = received.map((line) => JSON.parse(line) as { seq: number });
    assertEquals(events.map((event) => event.seq), Array.from({ length: lines }, (_, i) => i));
  });

  it("keeps every byte of stderr when the CLI exits with an error code", async () => {
    const { code, stderr } = await runScript(`
      makeStdioWritesBlocking();
      console.error("e".repeat(${ANSWER_BYTES}));
      exit(1);
    `);

    assertEquals(code, 1);
    assertEquals(stderr.length, ANSWER_BYTES + 1);
  });

  it("keeps a short answer that fits in the pipe buffer", async () => {
    const { code, stdout } = await runScript(`
      makeStdioWritesBlocking();
      console.log(JSON.stringify({ ok: true }));
      exit(0);
    `);

    assertEquals(code, 0);
    assertEquals(JSON.parse(stdout), { ok: true });
  });

  // The same answers without makeStdioWritesBlocking. If one of these ever
  // keeps every byte, the slow reader no longer reproduces the bug and the
  // matching case above proves nothing.
  it("loses stdout without the change, so the stdout cases can fail", async () => {
    if (!asyncPipes) return;
    const { code, stdout } = await runScript(`
      console.log("x".repeat(${ANSWER_BYTES}));
      exit(0);
    `);

    assertEquals(code, 0);
    assert(
      stdout.length < ANSWER_BYTES + 1,
      `expected a cut answer without blocking writes, got ${stdout.length} bytes`,
    );
  });

  it("loses stderr without the change, so the stderr case can fail", async () => {
    if (!asyncPipes) return;
    const { code, stderr } = await runScript(`
      console.error("e".repeat(${ANSWER_BYTES}));
      exit(1);
    `);

    assertEquals(code, 1);
    assert(
      stderr.length < ANSWER_BYTES + 1,
      `expected a cut error without blocking writes, got ${stderr.length} bytes`,
    );
  });

  it("makes stdout and stderr blocking at the CLI entry before any output", async () => {
    // Record every setBlocking call and write on the two stdio streams, and
    // report them on exit. The source CLI stops at its first Deno API call
    // under plain Node (the npm build supplies a Deno shim), which is after
    // the call this case checks, so the report covers the entry's first steps.
    const recorder = `
      import { writeSync } from "node:fs";
      const events = [];
      for (const name of ["stdout", "stderr"]) {
        const stream = process[name];
        const handle = stream._handle;
        if (typeof handle?.setBlocking === "function") {
          const setBlocking = handle.setBlocking.bind(handle);
          handle.setBlocking = (blocking) => {
            events.push(name + ":setBlocking:" + blocking);
            return setBlocking(blocking);
          };
        }
        const write = stream.write.bind(stream);
        stream.write = (...args) => {
          events.push(name + ":write");
          return write(...args);
        };
      }
      process.on("exit", () => writeSync(2, "\\nSTDIO_EVENTS " + JSON.stringify(events) + "\\n"));
    `;
    const { stderr } = await runNodeWithSlowReader([
      "--import",
      `data:text/javascript,${encodeURIComponent(recorder)}`,
      "./cli/main.ts",
      "--version",
    ]);

    const report = stderr.split("\n").find((line) => line.startsWith("STDIO_EVENTS "));
    assert(report, `the recorder did not report; stderr was:\n${stderr}`);
    const events = JSON.parse(report.slice("STDIO_EVENTS ".length)) as string[];
    assertEquals(
      events.slice(0, 2).sort(),
      ["stderr:setBlocking:true", "stdout:setBlocking:true"],
      `cli/main.ts must make both pipes blocking before anything else; saw ${
        JSON.stringify(events)
      }`,
    );
  });
});
