import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";

const repoRoot = new URL("../../../", import.meta.url);
const ANSWER_BYTES = 200_000;

/**
 * Run `script` under Node the way the npm CLI runs, with stdout on a pipe that
 * is not read until the script has had time to exit, and return what reaches
 * the reader.
 */
async function readPipedNodeOutput(script: string): Promise<{ code: number; stdout: string }> {
  const child = new Deno.Command("node", {
    args: ["--import", "./tests/node/resolver.mjs", "--input-type=module", "--eval", script],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  // A slow reader: the pipe fills (64 KiB) before anything drains it.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const stdout = await new Response(child.stdout).text();
  const { code } = await child.status;
  return { code, stdout };
}

describe("CLI output on a pipe under Node", () => {
  it("keeps every byte of an answer larger than the pipe buffer when the CLI exits", async () => {
    const { code, stdout } = await readPipedNodeOutput(`
      import { exit, makeStdioWritesBlocking } from "./src/platform/compat/process/lifecycle.ts";
      makeStdioWritesBlocking();
      console.log("x".repeat(${ANSWER_BYTES}));
      exit(0);
    `);

    assertEquals(code, 0);
    assertEquals(stdout.length, ANSWER_BYTES + 1);
  });
});
